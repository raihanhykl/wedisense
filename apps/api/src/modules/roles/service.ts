import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import * as roleRepo from './repository.js';
import type { CreateRoleInput, UpdateRoleInput, SetPermissionsInput } from './schema.js';
import { tourSyncQueue } from '../../lib/queue.js';

export async function listRoles() {
  return roleRepo.findMany();
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

export async function setRolePermissions(
  roleId: string,
  input: SetPermissionsInput,
  actorId: string,
) {
  const role = await roleRepo.findById(roleId);
  if (!role) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
  }

  const oldPermissions = role.rolePermissions;
  const newPermissions = await roleRepo.replacePermissions(roleId, input.permissionIds);

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: 'UPDATE',
      resourceType: 'RolePermission',
      resourceId: roleId,
      oldValues: oldPermissions as unknown as Prisma.InputJsonValue,
      newValues: newPermissions as unknown as Prisma.InputJsonValue,
    },
  });

  // Queue tour_sync job to update onboarding tour steps for this role
  await tourSyncQueue.add(
    'sync',
    { roleId },
    // BullMQ rejects ':' inside custom job IDs (reserved as redis key separator).
    { jobId: `tour-sync-${roleId}`, removeOnComplete: { count: 10 } },
  );

  return newPermissions;
}
