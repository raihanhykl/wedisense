import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { UserListFilters } from './types.js';

// Tx-client subset for service-layer atomic writes (Phase 16 Tier 6).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const userSelectFields = {
  id: true,
  name: true,
  email: true,
  employeeId: true,
  phone: true,
  avatarUrl: true,
  preferredLanguage: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function buildWhereClause(filters: UserListFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.roleId) {
    where.userRoles = {
      some: { roleId: filters.roleId },
    };
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export async function findMany(
  filters: UserListFilters,
  skip: number,
  take: number,
) {
  const where = buildWhereClause(filters);

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take,
      select: {
        ...userSelectFields,
        userRoles: {
          include: {
            role: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.user.count({ where }),
  ]);

  return { data, total };
}

export async function findById(id: string) {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      ...userSelectFields,
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: { permission: true },
              },
            },
          },
          location: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function findByEmail(email: string, excludeId?: string) {
  const where: Prisma.UserWhereInput = { email, deletedAt: null };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return prisma.user.findFirst({ where });
}

export async function findByEmployeeId(employeeId: string, excludeId?: string) {
  const where: Prisma.UserWhereInput = { employeeId, deletedAt: null };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return prisma.user.findFirst({ where });
}

export async function create(
  data: Prisma.UserCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).user.create({
    data,
    select: userSelectFields,
  });
}

export async function update(
  id: string,
  data: Prisma.UserUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).user.update({
    where: { id },
    data,
    select: userSelectFields,
  });
}

export async function softDelete(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).user.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'RESIGNED' },
  });
}

export async function replaceUserRoles(
  userId: string,
  roles: Array<{ roleId: string; locationId?: string | null }>,
) {
  return prisma.$transaction(async (tx) => {
    // Delete existing roles
    await tx.userRole.deleteMany({ where: { userId } });

    // Create new roles
    if (roles.length > 0) {
      await tx.userRole.createMany({
        data: roles.map((r) => ({
          userId,
          roleId: r.roleId,
          locationId: r.locationId ?? null,
        })),
      });
    }

    return tx.userRole.findMany({
      where: { userId },
      include: {
        role: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });
  });
}
