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
  // locationId is needed for the service-layer RBAC check (a movement is
  // visible when the asset itself sits in an accessible location, even if
  // the movement didn't change location). Other fields are for the UI.
  asset: {
    select: {
      id: true,
      name: true,
      assetNumber: true,
      status: true,
      condition: true,
      locationId: true,
    },
  },
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
  return tx.assetMovement.create({
    data,
    include: listInclude,
  });
}

export function updateAssetInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.AssetUpdateInput,
) {
  return tx.asset.update({
    where: { id },
    data,
  });
}

export function findAssetById(
  tx: PrismaTransactionClient,
  id: string,
) {
  return tx.asset.findUnique({
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
  return tx.asset.findMany({
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
  return tx.auditLog.create({ data });
}

export function createMaintenanceLogInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.MaintenanceLogCreateInput,
) {
  return tx.maintenanceLog.create({ data });
}

export function updateUserInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.UserUpdateInput,
) {
  return tx.user.update({
    where: { id },
    data,
  });
}

// ── Status transition (using raw SQL since AssetMovement has no updatedAt) ────
//
// CRITICAL: takes a `tx` client. Earlier versions called the top-level
// `prisma.$executeRaw` even when invoked inside a $transaction block, which
// meant the raw UPDATE ran on a separate connection OUTSIDE the transaction
// — so a failure in the same block's audit-log insert wouldn't roll the
// status back. The Phase 16 Tier 6 transaction audit caught this. Always
// pass the `tx` from the surrounding $transaction callback.
export function updateMovementStatus(
  tx: PrismaTransactionClient,
  id: string,
  status: string,
  approvedByUserId?: string,
) {
  if (approvedByUserId) {
    return tx.$executeRaw`
      UPDATE asset_movements
      SET status = ${status}::"MovementStatus",
          approved_by_user_id = ${approvedByUserId}::uuid
      WHERE id = ${id}::uuid
    `;
  }
  return tx.$executeRaw`
    UPDATE asset_movements
    SET status = ${status}::"MovementStatus"
    WHERE id = ${id}::uuid
  `;
}
