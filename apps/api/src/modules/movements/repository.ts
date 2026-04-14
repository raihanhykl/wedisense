import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from './types.js';

// ── Include presets ──────────────────────────────────────────────────

const listInclude = {
  asset: { select: { id: true, name: true, assetNumber: true } },
  fromUser: { select: { id: true, name: true, email: true } },
  toUser: { select: { id: true, name: true, email: true } },
  fromLocation: { select: { id: true, name: true, code: true } },
  toLocation: { select: { id: true, name: true, code: true } },
  performedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
} as const;

const detailInclude = {
  asset: { select: { id: true, name: true, assetNumber: true, status: true, condition: true } },
  fromUser: { select: { id: true, name: true, email: true, employeeId: true } },
  toUser: { select: { id: true, name: true, email: true, employeeId: true } },
  fromLocation: { select: { id: true, name: true, code: true, type: true } },
  toLocation: { select: { id: true, name: true, code: true, type: true } },
  performedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
} as const;

// ── Queries ──────────────────────────────────────────────────────────

export function findMany(args: {
  skip: number;
  take: number;
  where?: Prisma.AssetMovementWhereInput;
  orderBy?: Prisma.AssetMovementOrderByWithRelationInput;
}) {
  return prisma.assetMovement.findMany({
    skip: args.skip,
    take: args.take,
    where: args.where,
    orderBy: args.orderBy ?? { createdAt: 'desc' },
    include: listInclude,
  });
}

export function count(where?: Prisma.AssetMovementWhereInput) {
  return prisma.assetMovement.count({ where });
}

export function findById(id: string) {
  return prisma.assetMovement.findUnique({
    where: { id },
    include: detailInclude,
  });
}

export function createInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.AssetMovementCreateInput,
) {
  return (tx as unknown as { assetMovement: typeof prisma.assetMovement }).assetMovement.create({
    data,
    include: listInclude,
  });
}

export function updateAssetInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.AssetUpdateInput,
) {
  return (tx as unknown as { asset: typeof prisma.asset }).asset.update({
    where: { id },
    data,
  });
}

export function findAssetById(
  tx: PrismaTransactionClient,
  id: string,
) {
  return (tx as unknown as { asset: typeof prisma.asset }).asset.findUnique({
    where: { id, deletedAt: null },
    include: {
      assignedTo: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
  });
}

export function findAssetsByUserId(
  tx: PrismaTransactionClient,
  userId: string,
) {
  return (tx as unknown as { asset: typeof prisma.asset }).asset.findMany({
    where: { assignedToUserId: userId, deletedAt: null },
    include: {
      assignedTo: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
  });
}

export function createAuditLogInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.AuditLogCreateInput,
) {
  return (tx as unknown as { auditLog: typeof prisma.auditLog }).auditLog.create({ data });
}

export function createMaintenanceLogInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.MaintenanceLogCreateInput,
) {
  return (tx as unknown as { maintenanceLog: typeof prisma.maintenanceLog }).maintenanceLog.create({ data });
}

export function updateUserInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.UserUpdateInput,
) {
  return (tx as unknown as { user: typeof prisma.user }).user.update({
    where: { id },
    data,
  });
}

// ── Status transition (using raw SQL since AssetMovement has no updatedAt) ────

export function updateMovementStatus(
  id: string,
  status: string,
  approvedByUserId?: string,
) {
  if (approvedByUserId) {
    return prisma.$executeRaw`
      UPDATE asset_movements
      SET status = ${status}::"MovementStatus",
          approved_by_user_id = ${approvedByUserId}::uuid
      WHERE id = ${id}::uuid
    `;
  }
  return prisma.$executeRaw`
    UPDATE asset_movements
    SET status = ${status}::"MovementStatus"
    WHERE id = ${id}::uuid
  `;
}
