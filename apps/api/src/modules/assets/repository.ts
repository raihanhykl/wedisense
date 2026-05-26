import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from './types.js';

// ── Include presets ──────────────────────────────────────────────────

const listInclude = {
  product: {
    select: {
      id: true,
      name: true,
      brand: true,
      // Category is shown as a list column + powers the filter dropdown.
      // Selecting it here avoids an N+1 fetch from the frontend.
      category: { select: { id: true, name: true } },
    },
  },
  location: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  // Phase 17 v2 — surface the originating PO inline so the asset list
  // can render a "PO" column + power the PO filter dropdown without
  // a per-row follow-up fetch. Null for legacy / manually-created assets.
  procurementBatch: {
    select: {
      id: true,
      batchNumber: true,
      purchaseOrder: {
        select: { id: true, poNumber: true },
      },
    },
  },
  // Vendor relation (replaces the deprecated free-text `vendorLegacy`
  // column). Null when the asset has no vendor set OR predates the FK
  // migration; the frontend falls back to vendorLegacy in that case.
  vendor: { select: { id: true, name: true } },
} as const;

const detailInclude = {
  product: { select: { id: true, name: true, brand: true, model: true, eanCode: true, category: { select: { id: true, name: true, code: true } } } },
  location: { select: { id: true, name: true, code: true, type: true } },
  assignedTo: { select: { id: true, name: true, email: true, employeeId: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  // Phase 17 v2 — Vendor relation, replaces the free-text vendorLegacy.
  vendor: { select: { id: true, name: true, taxId: true } },
  // Phase 17 v2 — assets created via the procurement workflow carry a
  // back-link to their batch and (via the batch) the originating PO so
  // the asset detail page can render "Procured via SP-2026-0001 from
  // PO/2026/04/00057" with deep links to both. Null for legacy assets
  // created manually before procurement was introduced.
  procurementBatch: {
    select: {
      id: true,
      batchNumber: true,
      status: true,
      bastNumber: true,
      receivedDate: true,
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          poDate: true,
          status: true,
          vendor: { select: { id: true, name: true } },
        },
      },
    },
  },
  movements: {
    orderBy: { createdAt: 'desc' as const },
    take: 5,
    select: {
      id: true,
      movementType: true,
      referenceNumber: true,
      status: true,
      notes: true,
      createdAt: true,
      performedBy: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      fromLocation: { select: { id: true, name: true } },
      toUser: { select: { id: true, name: true } },
      fromUser: { select: { id: true, name: true } },
    },
  },
} as const;

// ── Queries ──────────────────────────────────────────────────────────

export function findMany(args: {
  skip: number;
  take: number;
  where?: Prisma.AssetWhereInput;
  orderBy?: Prisma.AssetOrderByWithRelationInput;
}) {
  return prisma.asset.findMany({
    skip: args.skip,
    take: args.take,
    where: { ...args.where, deletedAt: null },
    orderBy: args.orderBy ?? { createdAt: 'desc' },
    include: listInclude,
  });
}

export function count(where?: Prisma.AssetWhereInput) {
  return prisma.asset.count({ where: { ...where, deletedAt: null } });
}

export function findById(id: string) {
  return prisma.asset.findUnique({
    where: { id, deletedAt: null },
    include: detailInclude,
  });
}

export function findByBarcodeValue(barcodeValue: string) {
  return prisma.asset.findUnique({
    where: { barcodeValue, deletedAt: null },
    include: detailInclude,
  });
}

export function createInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.AssetCreateInput,
) {
  return (tx as unknown as { asset: typeof prisma.asset }).asset.create({
    data,
    include: listInclude,
  });
}

export function update(
  id: string,
  data: Prisma.AssetUpdateInput,
  tx?: PrismaTransactionClient,
) {
  const client = (tx ?? prisma) as typeof prisma;
  return client.asset.update({
    where: { id },
    data,
    include: detailInclude,
  });
}

export function softDelete(id: string, tx?: PrismaTransactionClient) {
  const client = (tx ?? prisma) as typeof prisma;
  return client.asset.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ── Movements ────────────────────────────────────────────────────────

export function findMovements(args: {
  assetId: string;
  skip: number;
  take: number;
}) {
  return prisma.assetMovement.findMany({
    where: { assetId: args.assetId },
    skip: args.skip,
    take: args.take,
    orderBy: { createdAt: 'desc' },
    include: {
      performedBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true } },
      fromUser: { select: { id: true, name: true } },
      toUser: { select: { id: true, name: true } },
      fromLocation: { select: { id: true, name: true, code: true } },
      toLocation: { select: { id: true, name: true, code: true } },
    },
  });
}

export function countMovements(assetId: string) {
  return prisma.assetMovement.count({ where: { assetId } });
}

export function createMovementInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.AssetMovementCreateInput,
) {
  return (tx as unknown as { assetMovement: typeof prisma.assetMovement }).assetMovement.create({
    data,
  });
}

// ── Maintenance ──────────────────────────────────────────────────────

export function findMaintenanceLogs(args: {
  assetId: string;
  skip: number;
  take: number;
}) {
  return prisma.maintenanceLog.findMany({
    where: { assetId: args.assetId },
    skip: args.skip,
    take: args.take,
    orderBy: { performedAt: 'desc' },
    include: {
      performedBy: { select: { id: true, name: true, email: true } },
      schedule: { select: { id: true, title: true } },
    },
  });
}

export function countMaintenanceLogs(assetId: string) {
  return prisma.maintenanceLog.count({ where: { assetId } });
}
