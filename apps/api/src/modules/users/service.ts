import bcrypt from 'bcrypt';
import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import * as userRepo from './repository.js';
import type { UserListFilters } from './types.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  BulkCreateUsersInput,
  CreateUserAccountInput,
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

/** Active employees for pickers — see repository.findOptions(). */
export async function listUserOptions() {
  return userRepo.findOptions();
}

function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

/**
 * Create an employee record, optionally with a login account. Without a
 * password the row is a plain employee (asset holder / handover party)
 * who never signs in; `hasAccount` on the response tells the UI which.
 */
export async function createUser(input: CreateUserInput, actorId: string) {
  const email = normaliseEmail(input.email);

  // Check unique email (only when one was given — NULL emails don't collide)
  if (email) {
    const existingEmail = await userRepo.findByEmail(email);
    if (existingEmail) {
      throw new AppError(409, 'DUPLICATE_EMAIL', `Email "${email}" already exists`);
    }
  }

  // Check unique employeeId
  const existingEmpId = await userRepo.findByEmployeeId(input.employeeId);
  if (existingEmpId) {
    throw new AppError(409, 'DUPLICATE_EMPLOYEE_ID', `Employee ID "${input.employeeId}" already exists`);
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null;

  return prisma.$transaction(async (tx) => {
    const user = await userRepo.create(
      {
        name: input.name,
        email,
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
        // The repository already strips passwordHash (it only exposes the
        // derived `hasAccount` flag), so spreading the row is hash-safe.
        newValues: user as unknown as Prisma.InputJsonValue,
      },
    });
    return user;
  });
}

interface BulkRowError {
  index: number;
  field: 'employeeId' | 'email';
  message: string;
}

/**
 * Bulk employee creation. All-or-nothing: every row is validated against
 * the payload itself AND the database before a single INSERT runs, and
 * the inserts share one transaction, so a duplicate in row 37 never
 * leaves rows 1–36 half-created. Duplicates come back as a 409 with a
 * per-row `details` array the UI can render inline.
 */
export async function bulkCreateUsers(input: BulkCreateUsersInput, actorId: string) {
  const rows = input.users.map((row) => ({
    ...row,
    email: normaliseEmail(row.email),
    phone: row.phone?.trim() || null,
  }));

  // 1. Duplicates inside the payload.
  const errors: BulkRowError[] = [];
  const seenEmployeeIds = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  rows.forEach((row, index) => {
    const empKey = row.employeeId.toLowerCase();
    const firstEmp = seenEmployeeIds.get(empKey);
    if (firstEmp !== undefined) {
      errors.push({
        index,
        field: 'employeeId',
        message: `Employee ID "${row.employeeId}" is repeated (also on row ${firstEmp + 1})`,
      });
    } else {
      seenEmployeeIds.set(empKey, index);
    }
    if (row.email) {
      const firstEmail = seenEmails.get(row.email);
      if (firstEmail !== undefined) {
        errors.push({
          index,
          field: 'email',
          message: `Email "${row.email}" is repeated (also on row ${firstEmail + 1})`,
        });
      } else {
        seenEmails.set(row.email, index);
      }
    }
  });

  // 2. Duplicates against existing employees.
  const conflicts = await userRepo.findConflicts(
    rows.map((r) => r.employeeId),
    rows.flatMap((r) => (r.email ? [r.email] : [])),
  );
  if (conflicts.length > 0) {
    const takenEmployeeIds = new Set(conflicts.map((c) => c.employeeId.toLowerCase()));
    const takenEmails = new Set(
      conflicts.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])),
    );
    rows.forEach((row, index) => {
      if (takenEmployeeIds.has(row.employeeId.toLowerCase())) {
        errors.push({
          index,
          field: 'employeeId',
          message: `Employee ID "${row.employeeId}" already exists`,
        });
      }
      if (row.email && takenEmails.has(row.email)) {
        errors.push({ index, field: 'email', message: `Email "${row.email}" already exists` });
      }
    });
  }

  if (errors.length > 0) {
    errors.sort((a, b) => a.index - b.index);
    throw new AppError(
      409,
      'BULK_USERS_CONFLICT',
      `${errors.length} row(s) conflict with existing or repeated employees`,
      errors,
    );
  }

  // 3. Insert everything in one transaction; one audit row per employee
  //    so each user's own audit trail starts with its CREATE.
  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const row of rows) {
      const user = await userRepo.create(
        {
          name: row.name,
          email: row.email,
          passwordHash: null,
          employeeId: row.employeeId,
          phone: row.phone,
          preferredLanguage: 'id',
          status: row.status ?? 'ACTIVE',
        },
        tx,
      );
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'CREATE',
          resourceType: 'User',
          resourceId: user.id,
          newValues: { ...user, bulk: true } as unknown as Prisma.InputJsonValue,
        },
      });
      created.push(user);
    }
    return created;
  });
}

/**
 * Grant a login account to an existing employee. Idempotency guard: an
 * employee who already has an account gets a 409 — password changes go
 * through /reset-password (audited distinctly, actor re-auth).
 */
export async function createUserAccount(
  id: string,
  input: CreateUserAccountInput,
  actorId: string,
) {
  const existing = await userRepo.findSecretById(id);
  if (!existing) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }
  if (existing.passwordHash !== null) {
    throw new AppError(
      409,
      'USER_ALREADY_HAS_ACCOUNT',
      'This employee already has a login account. Use reset password instead.',
    );
  }

  const email = normaliseEmail(input.email) ?? existing.email;
  if (!email) {
    throw new AppError(422, 'EMAIL_REQUIRED', 'An email address is required for a login account');
  }
  if (email !== existing.email) {
    const duplicate = await userRepo.findByEmail(email, id);
    if (duplicate) {
      throw new AppError(409, 'DUPLICATE_EMAIL', `Email "${email}" already exists`);
    }
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const updated = await userRepo.update(id, { email, passwordHash }, tx);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE',
        resourceType: 'User',
        resourceId: id,
        oldValues: { hasAccount: false, email: existing.email },
        // Only the FACT of account creation — never the hash.
        newValues: { hasAccount: true, email },
      },
    });
    return updated;
  });
}

export async function updateUser(id: string, input: UpdateUserInput, actorId: string) {
  const existing = await userRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const email = input.email === undefined ? undefined : normaliseEmail(input.email);

  // An account logs in by email, so it cannot be cleared while the
  // account exists. Plain employees may drop their email freely.
  if (email === null && existing.hasAccount) {
    throw new AppError(
      409,
      'ACCOUNT_REQUIRES_EMAIL',
      'This employee has a login account; the email cannot be removed',
    );
  }

  // Check unique email if changing
  if (email && email !== existing.email) {
    const duplicate = await userRepo.findByEmail(email, id);
    if (duplicate) {
      throw new AppError(409, 'DUPLICATE_EMAIL', `Email "${email}" already exists`);
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
        ...(email !== undefined && { email }),
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
  if (!actor || actor.status !== 'ACTIVE' || !actor.passwordHash) {
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

  const target = await userRepo.findSecretById(targetUserId);
  if (!target) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target user not found');
  }
  if (target.passwordHash === null) {
    throw new AppError(
      409,
      'USER_HAS_NO_ACCOUNT',
      'This employee has no login account yet. Create the account first.',
    );
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
