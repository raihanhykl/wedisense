import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import * as roleRepo from './repository.js';
import type {
  CloneRoleInput,
  CreateRoleInput,
  UpdateRoleInput,
  SetPermissionsInput,
} from './schema.js';
import { tourSyncQueue } from '../../lib/queue.js';

export async function listRoles() {
  // Reshape the Prisma `_count` payload into explicit `userCount` +
  // `permissionCount` so the frontend can render them in dedicated
  // columns. Earlier the response carried `_count.userRoles` and the
  // frontend's Role type expected `permissionCount` — a silent mismatch
  // that left the "Permissions" column blank (undefined). Audit-flagged.
  const rows = await roleRepo.findMany();
  return rows.map((r) => {
    const { _count, ...rest } = r;
    return {
      ...rest,
      userCount: _count.userRoles,
      permissionCount: _count.rolePermissions,
    };
  });
}

export async function getRole(id: string) {
  const role = await roleRepo.findById(id);
  if (!role) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }
  return role;
}

export async function createRole(input: CreateRoleInput, actorId: string) {
  // Check unique name
  const existing = await roleRepo.findByName(input.name);
  if (existing) {
    throw new AppError(409, 'DUPLICATE_ROLE_NAME', `Role name "${input.name}" already exists`);
  }

  return prisma.$transaction(async (tx) => {
    const role = await roleRepo.create(
      {
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'CREATE',
        resourceType: 'Role',
        resourceId: role.id,
        newValues: role as unknown as Prisma.InputJsonValue,
      },
    });
    return role;
  });
}

export async function updateRole(id: string, input: UpdateRoleInput, actorId: string) {
  const existing = await roleRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }

  // Block system role name changes
  if (existing.isSystem && input.name && input.name !== existing.name) {
    throw new AppError(403, 'SYSTEM_ROLE_PROTECTED', 'Cannot change the name of a system role');
  }

  // Check unique name if changing
  if (input.name && input.name !== existing.name) {
    const duplicate = await roleRepo.findByName(input.name, id);
    if (duplicate) {
      throw new AppError(409, 'DUPLICATE_ROLE_NAME', `Role name "${input.name}" already exists`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await roleRepo.update(
      id,
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
      },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE',
        resourceType: 'Role',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
        newValues: updated as unknown as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

export async function deleteRole(id: string, actorId: string) {
  const existing = await roleRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }

  if (existing.isSystem) {
    throw new AppError(403, 'SYSTEM_ROLE_PROTECTED', 'Cannot delete a system role');
  }

  const hasUsers = await roleRepo.hasUsers(id);
  if (hasUsers) {
    throw new AppError(409, 'ROLE_HAS_USERS', 'Cannot delete a role that is assigned to users');
  }

  await prisma.$transaction(async (tx) => {
    await roleRepo.deleteRole(id, tx);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'DELETE',
        resourceType: 'Role',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

export async function getRolePermissions(id: string) {
  const role = await roleRepo.findById(id);
  if (!role) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }

  return roleRepo.getPermissions(id);
}

/**
 * Clone a role — create a new custom role with the same permissions as
 * the source. Always non-system (isSystem=false), even when cloning a
 * system role. Lets admins use "MANAGER but without reports:generate"
 * as a starting point without re-picking 14 permissions manually.
 *
 * The clone + audit runs in a single transaction so a crash mid-clone
 * leaves no orphaned permission rows. Tour-sync isn't queued — the new
 * role has no users assigned, so there's no tour to re-sync yet.
 */
export async function cloneRole(
  sourceRoleId: string,
  input: CloneRoleInput,
  actorId: string,
) {
  const source = await roleRepo.findById(sourceRoleId);
  if (!source) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Source role not found');
  }
  // Check unique name
  const duplicate = await roleRepo.findByName(input.name);
  if (duplicate) {
    throw new AppError(
      409,
      'DUPLICATE_ROLE_NAME',
      `Role name "${input.name}" already exists`,
    );
  }

  const sourcePermissionIds = source.rolePermissions.map(
    (rp) => rp.permissionId,
  );

  return prisma.$transaction(async (tx) => {
    const cloned = await roleRepo.create(
      {
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      },
      tx,
    );
    if (sourcePermissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: sourcePermissionIds.map((permissionId) => ({
          roleId: cloned.id,
          permissionId,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'CREATE',
        resourceType: 'Role',
        resourceId: cloned.id,
        newValues: {
          ...cloned,
          clonedFromRoleId: sourceRoleId,
          clonedFromRoleName: source.name,
          inheritedPermissionCount: sourcePermissionIds.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return cloned;
  });
}

/**
 * Return audit_log entries scoped to a single role. Used by the role
 * detail "History" view to show "who changed what when". Joined with
 * the actor user's name for display; falls back to the user id if the
 * actor has been soft-deleted since.
 *
 * Both `Role` (CREATE / UPDATE / DELETE) and `RolePermission` (UPDATE)
 * resource types are surfaced because they're both intrinsic to "what
 * happened to this role".
 */
export async function getRoleAuditHistory(
  roleId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const role = await roleRepo.findById(roleId);
  if (!role) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }
  const limit = Math.min(options.limit ?? 20, 100);
  const offset = options.offset ?? 0;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        OR: [
          { resourceType: 'Role', resourceId: roleId },
          { resourceType: 'RolePermission', resourceId: roleId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditLog.count({
      where: {
        OR: [
          { resourceType: 'Role', resourceId: roleId },
          { resourceType: 'RolePermission', resourceId: roleId },
        ],
      },
    }),
  ]);
  return { rows, total, limit, offset };
}

/**
 * List users currently assigned this role. Used by the permission editor's
 * diff modal to surface "who is affected" — count alone is insufficient
 * for an informed decision. Returns up to 100 users (paginated client-side
 * by the modal); admins managing roles with more users than that should
 * be reviewing access via the user list instead, not the role editor.
 *
 * Soft-deleted users are excluded — they can't act on the system anyway.
 */
export async function getRoleUsers(roleId: string) {
  const role = await roleRepo.findById(roleId);
  if (!role) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }
  const rows = await prisma.userRole.findMany({
    where: {
      roleId,
      user: { deletedAt: null },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, employeeId: true },
      },
      location: { select: { id: true, name: true, code: true } },
    },
    take: 100,
    orderBy: { user: { name: 'asc' } },
  });
  return rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    employeeId: r.user.employeeId,
    locationScope: r.location
      ? { id: r.location.id, name: r.location.name, code: r.location.code }
      : null,
  }));
}

export async function setRolePermissions(
  roleId: string,
  input: SetPermissionsInput,
  actorId: string,
  /** Sentinel header value the client sends after the user typed
   *  "CONFIRM" on the self-demotion warning. Server validates the header
   *  exists; client-side check alone is bypassable via direct API call. */
  selfDemoteConfirmation: string | undefined,
) {
  const role = await roleRepo.findById(roleId);
  if (!role) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }

  // System role guard — extend the existing "block name/delete" pattern
  // to permission changes too. Without this, an admin could neuter
  // SUPER_ADMIN by clearing its permissions and lock everyone out of
  // role management. The UI already paints system rows differently;
  // this is the server-side enforcement of the same intent.
  if (role.isSystem) {
    throw new AppError(
      403,
      'SYSTEM_ROLE_PROTECTED',
      'Cannot modify permissions of a system role. Clone it as a custom role to customize.',
    );
  }

  const oldPermissions = role.rolePermissions;

  // ── Safety guards ────────────────────────────────────────────────────
  // Compute "is roles:manage being removed" — the only permission whose
  // removal can lock the entire system out of role management. Other
  // permission changes don't carry this systemic risk.
  const oldHasRolesManage = oldPermissions.some(
    (rp) => rp.permission.resource === 'roles' && rp.permission.action === 'manage',
  );
  const newPermsCatalog = await prisma.permission.findMany({
    where: { id: { in: input.permissionIds } },
  });
  const newHasRolesManage = newPermsCatalog.some(
    (p) => p.resource === 'roles' && p.action === 'manage',
  );
  const isRemovingRolesManage = oldHasRolesManage && !newHasRolesManage;

  // Guard 1: Last-admin lockout. If removing roles:manage from this role
  // leaves zero OTHER roles (with at least one active user) holding the
  // permission, the system would have no admin who can manage roles —
  // a non-recoverable state without server-side intervention.
  if (isRemovingRolesManage) {
    const otherAdminRoleCount = await prisma.role.count({
      where: {
        id: { not: roleId },
        rolePermissions: {
          some: {
            permission: { resource: 'roles', action: 'manage' },
          },
        },
        userRoles: {
          some: { user: { deletedAt: null } },
        },
      },
    });
    if (otherAdminRoleCount === 0) {
      throw new AppError(
        422,
        'LAST_ADMIN_ROLE',
        'Cannot remove roles:manage — this is the only role granting admin access to active users. Assign roles:manage to another role first.',
      );
    }
  }

  // Guard 2: Self-demotion confirmation. Editing your own role's
  // permissions is fine in general (e.g. adding assets:export to a role
  // you happen to hold). What's dangerous is *removing* roles:manage
  // from a role you hold — that demotes yourself. We require the client
  // to send an explicit `x-self-demote-confirm: CONFIRMED` header, set
  // only after the user typed "CONFIRM" in the warning modal.
  if (isRemovingRolesManage) {
    const actorHoldsThisRole =
      (await prisma.userRole.count({
        where: { userId: actorId, roleId },
      })) > 0;
    if (actorHoldsThisRole && selfDemoteConfirmation !== 'CONFIRMED') {
      throw new AppError(
        422,
        'SELF_DEMOTE_UNCONFIRMED',
        'Removing admin access from a role you currently hold requires explicit confirmation. Type CONFIRM and retry.',
      );
    }
  }

  // Permission replace + audit must commit atomically — Phase 16 Tier 8
  // review caught the previous version writing the audit log AFTER
  // replacePermissions's internal transaction had already committed, so
  // a crash between the two left permission changes with no audit trail.
  // The repo accepts an optional `tx` now so we can stitch them together.
  const newPermissions = await prisma.$transaction(async (tx) => {
    const next = await roleRepo.replacePermissions(roleId, input.permissionIds, tx);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE',
        resourceType: 'RolePermission',
        resourceId: roleId,
        oldValues: oldPermissions as unknown as Prisma.InputJsonValue,
        newValues: next as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });

  // Tour-sync queue add stays OUTSIDE the transaction. BullMQ writes to
  // Redis (a separate system), so it can't share our Postgres tx anyway.
  // A failed enqueue is recoverable by manually re-running tour-sync from
  // /admin/tours; it's not worth rolling back the permission change.
  await tourSyncQueue.add(
    'sync',
    { roleId },
    // BullMQ rejects ':' inside custom job IDs (reserved as redis key separator).
    { jobId: `tour-sync-${roleId}`, removeOnComplete: { count: 10 } },
  );

  return newPermissions;
}
