import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

// Tx-client subset for service-layer atomic writes (Phase 16 Tier 6).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function findMany() {
  return prisma.role.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { userRoles: true } },
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

export async function replacePermissions(roleId: string, permissionIds: string[]) {
  return prisma.$transaction(async (tx) => {
    // Delete all existing permissions for this role
    await tx.rolePermission.deleteMany({ where: { roleId } });

    // Create new permissions
    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      });
    }

    return tx.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
  });
}

export async function hasUsers(id: string): Promise<boolean> {
  const count = await prisma.userRole.count({
    where: { roleId: id },
  });
  return count > 0;
}
