import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

// Tx-client subset for service-layer atomic writes (Phase 16 Tier 6).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function findMany() {
  // Both counts surfaced — the list view shows users-assigned alongside
  // permission-count so admins can decide which roles need attention
  // ("MANAGER has 12 users + 14 permissions"). Earlier versions only
  // included `userRoles` and the frontend mis-labelled it as
  // "Permissions"; fixing this is the audit-flagged display bug.
  return prisma.role.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { userRoles: true, rolePermissions: true },
      },
    },
  });
}

export async function findById(id: string) {
  return prisma.role.findUnique({
    where: { id },
    include: {
      rolePermissions: {
        include: { permission: true },
      },
    },
  });
}

export async function findByName(name: string, excludeId?: string) {
  const where: Prisma.RoleWhereInput = { name };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return prisma.role.findFirst({ where });
}

export async function create(
  data: Prisma.RoleCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).role.create({ data });
}

export async function update(
  id: string,
  data: Prisma.RoleUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).role.update({ where: { id }, data });
}

export async function deleteRole(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).role.delete({ where: { id } });
}

export async function getPermissions(roleId: string) {
  return prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: true },
  });
}

/**
 * Replace the permission set on a role atomically.
 *
 * Accepts an optional `tx` so callers can compose this into a larger
 * transaction (e.g. service-layer audit + permission replace in one
 * boundary). When `tx` is passed, we run the three statements inside it
 * directly. When it isn't, we spin up our own $transaction so the helper
 * stays atomic on its own.
 */
export async function replacePermissions(
  roleId: string,
  permissionIds: string[],
  tx?: PrismaTransactionClient,
) {
  const run = async (client: PrismaTransactionClient) => {
    await client.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await client.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      });
    }
    return client.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function hasUsers(id: string): Promise<boolean> {
  const count = await prisma.userRole.count({
    where: { roleId: id },
  });
  return count > 0;
}
