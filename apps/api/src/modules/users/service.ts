import bcrypt from 'bcrypt';
import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import * as userRepo from './repository.js';
import type { UserListFilters } from './types.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  AssignRolesInput,
  ResetUserPasswordInput,
} from './schema.js';
import type { AuthContext } from '../auth/service.js';

const BCRYPT_ROUNDS = 12;

export async function listUsers(
  filters: UserListFilters,
  skip: number,
  take: number,
) {
  return userRepo.findMany(filters, skip, take);
}

export async function getUser(id: string) {
  const user = await userRepo.findById(id);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return user;
}

export async function createUser(input: CreateUserInput, actorId: string) {
  // Check unique email
  const existingEmail = await userRepo.findByEmail(input.email);
  if (existingEmail) {
    throw new AppError(409, 'DUPLICATE_EMAIL', `Email "${input.email}" already exists`);
  }

  // Check unique employeeId
  const existingEmpId = await userRepo.findByEmployeeId(input.employeeId);
  if (existingEmpId) {
    throw new AppError(409, 'DUPLICATE_EMPLOYEE_ID', `Employee ID "${input.employeeId}" already exists`);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const user = await userRepo.create(
      {
        name: input.name,
        email: input.email,
        passwordHash,
        employeeId: input.employeeId,
        phone: input.phone ?? null,
        avatarUrl: input.avatarUrl ?? null,
        preferredLanguage: input.preferredLanguage ?? 'id',
        status: input.status ?? 'ACTIVE',
      },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'CREATE',
        resourceType: 'User',
        resourceId: user.id,
        // Defensive: passwordHash is in the select set; spreading would
        // leak the hash into the audit JSON. The bcrypt cost makes this
        // a slow-but-feasible offline crack target; never log it.
        newValues: { ...user, passwordHash: '[REDACTED]' } as unknown as Prisma.InputJsonValue,
      },
    });
    return user;
  });
}

export async function updateUser(id: string, input: UpdateUserInput, actorId: string) {
  const existing = await userRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  // Check unique email if changing
  if (input.email && input.email !== existing.email) {
    const duplicate = await userRepo.findByEmail(input.email, id);
    if (duplicate) {
      throw new AppError(409, 'DUPLICATE_EMAIL', `Email "${input.email}" already exists`);
    }
  }

  // Check unique employeeId if changing
  if (input.employeeId && input.employeeId !== existing.employeeId) {
    const duplicate = await userRepo.findByEmployeeId(input.employeeId, id);
    if (duplicate) {
      throw new AppError(409, 'DUPLICATE_EMPLOYEE_ID', `Employee ID "${input.employeeId}" already exists`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await userRepo.update(
      id,
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.employeeId !== undefined && { employeeId: input.employeeId }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.preferredLanguage !== undefined && {
          preferredLanguage: input.preferredLanguage,
        }),
        ...(input.status !== undefined && { status: input.status }),
      },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE',
        resourceType: 'User',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
        newValues: updated as unknown as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

export async function deleteUser(id: string, actorId: string) {
  const existing = await userRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  await prisma.$transaction(async (tx) => {
    await userRepo.softDelete(id, tx);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'DELETE',
        resourceType: 'User',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Phase 17 v2 — admin-driven password reset.
 *
 * Distinct from auth.changePassword (which is self-service, verifies the
 * USER's current password). Here the actor proves their own identity by
 * re-entering their password — defence against hijacked sessions —
 * before being allowed to set an arbitrary password on another account.
 *
 * Routing-level gate: `users:reset-password` permission (SUPER_ADMIN
 * only by default).
 *
 * Explicit blocks:
 *   - actor cannot reset their OWN password via this endpoint; that
 *     flow lives at /auth/change-password and requires the actor's
 *     CURRENT password as the "old password" check, which is the
 *     correct invariant for self-service
 *   - never log the new password (just record `passwordReset: true`);
 *     the audit table is itself a credential-theft target
 */
export async function resetUserPassword(
  targetUserId: string,
  input: ResetUserPasswordInput,
  actorId: string,
  ctx: AuthContext = {},
) {
  if (targetUserId === actorId) {
    throw new AppError(
      400,
      'CANNOT_RESET_OWN_PASSWORD',
      'Use /auth/change-password to change your own password',
    );
  }

  // Load the actor's password hash. req.user (AuthenticatedUser) does
  // NOT carry passwordHash on purpose — we re-fetch from DB so a stale
  // token can't bypass the check after the actor's password rotated.
  const actor = await prisma.user.findUnique({
    where: { id: actorId, deletedAt: null },
    select: { id: true, passwordHash: true, status: true },
  });
  if (!actor || actor.status !== 'ACTIVE') {
    throw new AppError(401, 'ACTOR_NOT_FOUND', 'Your session is no longer valid');
  }

  const actorOk = await bcrypt.compare(input.actorPassword, actor.passwordHash);
  if (!actorOk) {
    throw new AppError(
      400,
      'INVALID_ACTOR_PASSWORD',
      'Your password is incorrect',
    );
  }

  const target = await userRepo.findById(targetUserId);
  if (!target) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target user not found');
  }

  const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { passwordHash: newHash },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE',
        resourceType: 'User',
        resourceId: targetUserId,
        // No hash in the audit body — only the fact of reset + which
        // admin did it (carried by userId) and from where (ctx).
        newValues: {
          passwordReset: true,
          resetBy: actorId,
        } as unknown as Prisma.InputJsonValue,
        ...(ctx.ipAddress !== undefined && { ipAddress: ctx.ipAddress }),
        ...(ctx.userAgent !== undefined && { userAgent: ctx.userAgent }),
      },
    });
  });
}

export async function assignRoles(userId: string, input: AssignRolesInput, actorId: string) {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  // Defensive guard. The Zod schema already enforces min(1) but services
  // are sometimes called outside the router (jobs, scripts). Surface a
  // clean 422 with a stable error code so the frontend can localise the
  // message without parsing Zod's nested error structure.
  if (input.roles.length === 0) {
    throw new AppError(
      422,
      'USER_MUST_HAVE_ROLE',
      'A user must have at least one role assigned.',
    );
  }

  // Verify every submitted roleId exists. Without this, an invalid UUID
  // hits the FK constraint and surfaces as a generic 500 to the client —
  // poor UX and leaks DB internals. Single batched query keeps cost flat
  // regardless of payload size.
  const submittedRoleIds = Array.from(
    new Set(input.roles.map((r) => r.roleId)),
  );
  const existing = await prisma.role.findMany({
    where: { id: { in: submittedRoleIds } },
    select: { id: true },
  });
  if (existing.length !== submittedRoleIds.length) {
    const found = new Set(existing.map((r) => r.id));
    const missing = submittedRoleIds.filter((id) => !found.has(id));
    throw new AppError(
      422,
      'ROLE_NOT_FOUND',
      `One or more roles do not exist: ${missing.join(', ')}`,
    );
  }

  const oldRoles = user.userRoles;

  // Role replace + audit must commit atomically. The repo's
  // replaceUserRoles now accepts an optional `tx` so we can stitch the
  // two writes into one transaction (Phase 16 Tier 8 review fix).
  return prisma.$transaction(async (tx) => {
    const newRoles = await userRepo.replaceUserRoles(userId, input.roles, tx);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE',
        resourceType: 'UserRole',
        resourceId: userId,
        oldValues: oldRoles as unknown as Prisma.InputJsonValue,
        newValues: newRoles as unknown as Prisma.InputJsonValue,
      },
    });
    return newRoles;
  });
}
