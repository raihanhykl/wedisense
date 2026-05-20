import bcrypt from 'bcrypt';
import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import * as userRepo from './repository.js';
import type { UserListFilters } from './types.js';
import type { CreateUserInput, UpdateUserInput, AssignRolesInput } from './schema.js';

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

export async function assignRoles(userId: string, input: AssignRolesInput, actorId: string) {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const oldRoles = user.userRoles;
  const newRoles = await userRepo.replaceUserRoles(userId, input.roles);

  // Audit log
  await prisma.auditLog.create({
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
}
