import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { UserListFilters } from './types.js';

// Tx-client subset for service-layer atomic writes (Phase 16 Tier 6).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// `passwordHash` is selected ONLY so `withHasAccount()` can derive the
// boolean; every public function in this module strips it before
// returning, so callers (and the audit rows that spread these objects)
// never see the hash.
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
  passwordHash: true,
} as const;

/** Replace the raw hash with the `hasAccount` flag the API exposes. */
function withHasAccount<T extends { passwordHash: string | null }>(
  row: T,
): Omit<T, 'passwordHash'> & { hasAccount: boolean } {
  const { passwordHash, ...rest } = row;
  return { ...rest, hasAccount: passwordHash !== null };
}

function buildWhereClause(filters: UserListFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.hasAccount !== undefined) {
    where.passwordHash = filters.hasAccount ? { not: null } : null;
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
      { employeeId: { contains: filters.search, mode: 'insensitive' } },
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

  return { data: data.map(withHasAccount), total };
}

/**
 * Lightweight, unpaginated picker feed: every active employee, with or
 * without a login. Used by assignee / handover / signatory dropdowns,
 * which previously hit the paginated list and silently saw only the
 * first page (20–100 rows) once the employee directory grew.
 */
export async function findOptions() {
  const rows = await prisma.user.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      employeeId: true,
      email: true,
      status: true,
      passwordHash: true,
    },
    orderBy: { name: 'asc' },
    take: 2000,
  });
  return rows.map(withHasAccount);
}

/**
 * Duplicate probe for bulk creation: one query for every employeeId /
 * email in the payload. Email match is case-insensitive because the
 * column is case-sensitive but humans aren't.
 */
export async function findConflicts(employeeIds: string[], emails: string[]) {
  if (employeeIds.length === 0 && emails.length === 0) return [];
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(employeeIds.length > 0 ? [{ employeeId: { in: employeeIds } }] : []),
        ...(emails.length > 0
          ? [{ email: { in: emails, mode: 'insensitive' as const } }]
          : []),
      ],
    },
    select: { id: true, employeeId: true, email: true },
  });
}

export async function findById(id: string) {
  const user = await prisma.user.findFirst({
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
  return user ? withHasAccount(user) : null;
}

/** Credential-bearing read for account grant / password reset. Never returned to clients. */
export async function findSecretById(id: string) {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, email: true, passwordHash: true, status: true },
  });
}

export async function findByEmail(email: string, excludeId?: string) {
  const where: Prisma.UserWhereInput = {
    email: { equals: email, mode: 'insensitive' },
    deletedAt: null,
  };
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
  const user = await (tx ?? prisma).user.create({
    data,
    select: userSelectFields,
  });
  return withHasAccount(user);
}

export async function update(
  id: string,
  data: Prisma.UserUpdateInput,
  tx?: PrismaTransactionClient,
) {
  const user = await (tx ?? prisma).user.update({
    where: { id },
    data,
    select: userSelectFields,
  });
  return withHasAccount(user);
}

export async function softDelete(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).user.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'RESIGNED' },
  });
}

/**
 * Replace the role set on a user atomically. Accepts an optional `tx` so
 * the service-layer caller can stitch this into a larger transaction
 * with the matching audit-log insert (Phase 16 Tier 8 review fix).
 */
export async function replaceUserRoles(
  userId: string,
  roles: Array<{ roleId: string; locationId?: string | null }>,
  tx?: PrismaTransactionClient,
) {
  const run = async (client: PrismaTransactionClient) => {
    await client.userRole.deleteMany({ where: { userId } });
    if (roles.length > 0) {
      await client.userRole.createMany({
        data: roles.map((r) => ({
          userId,
          roleId: r.roleId,
          locationId: r.locationId ?? null,
        })),
      });
    }
    return client.userRole.findMany({
      where: { userId },
      include: {
        role: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });
  };
  return tx ? run(tx) : prisma.$transaction(run);
}
