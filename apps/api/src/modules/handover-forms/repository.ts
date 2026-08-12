import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type { HandoverFormListFilters, PrismaTransactionClient } from './types.js';

const partySelect = {
  select: { id: true, name: true, employeeId: true, email: true },
} as const;

const listInclude = {
  itOfficer: partySelect,
  fromUser: partySelect,
  toUser: partySelect,
  acknowledgedBy: partySelect,
  createdBy: { select: { id: true, name: true } },
  fromLocation: { select: { id: true, name: true } },
  toLocation: { select: { id: true, name: true } },
  _count: { select: { items: true, movements: true } },
} as const;

const detailInclude = {
  ...listInclude,
  scanUploadedBy: { select: { id: true, name: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      // Live asset fields alongside the frozen snapshot, so the detail page
      // can show "condition at handover: GOOD / today: DAMAGED".
      asset: { select: { id: true, assetNumber: true, name: true, status: true, condition: true } },
    },
  },
  movements: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      referenceNumber: true,
      movementType: true,
      status: true,
      createdAt: true,
      asset: { select: { id: true, assetNumber: true, name: true } },
    },
  },
} as const;

function buildWhere(filters: HandoverFormListFilters): Prisma.HandoverFormWhereInput {
  const where: Prisma.HandoverFormWhereInput = { deletedAt: null };

  if (filters.status?.length) {
    where.status = { in: filters.status };
  }
  if (filters.handoverType) {
    where.handoverType = filters.handoverType;
  }
  if (filters.dateFrom || filters.dateTo) {
    where.handoverDate = {
      ...(filters.dateFrom && { gte: filters.dateFrom }),
      ...(filters.dateTo && { lte: filters.dateTo }),
    };
  }
  if (filters.search) {
    const search = filters.search;
    where.OR = [
      { formNumber: { contains: search, mode: 'insensitive' } },
      { purpose: { contains: search, mode: 'insensitive' } },
      { fromUser: { name: { contains: search, mode: 'insensitive' } } },
      { toUser: { name: { contains: search, mode: 'insensitive' } } },
      { items: { some: { assetNumber: { contains: search, mode: 'insensitive' } } } },
    ];
  }

  return where;
}

export async function findMany(filters: HandoverFormListFilters, skip: number, take: number) {
  const where = buildWhere(filters);

  const [data, total] = await Promise.all([
    prisma.handoverForm.findMany({
      where,
      include: listInclude,
      orderBy: [{ handoverDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.handoverForm.count({ where }),
  ]);

  return { data, total };
}

export function findById(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).handoverForm.findFirst({
    where: { id, deletedAt: null },
    include: detailInclude,
  });
}

/** Minimal read used by guards that only need status/ownership, not the graph. */
export function findBareById(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).handoverForm.findFirst({ where: { id, deletedAt: null } });
}

export function createInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.HandoverFormCreateInput,
) {
  return tx.handoverForm.create({ data, include: detailInclude });
}

export function updateInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.HandoverFormUpdateInput,
) {
  return tx.handoverForm.update({ where: { id }, data, include: detailInclude });
}

export function deleteItemsInTransaction(tx: PrismaTransactionClient, handoverFormId: string) {
  return tx.handoverFormItem.deleteMany({ where: { handoverFormId } });
}

export function createItemsInTransaction(
  tx: PrismaTransactionClient,
  items: Prisma.HandoverFormItemCreateManyInput[],
) {
  return tx.handoverFormItem.createMany({ data: items });
}

/**
 * Loads assets for the form's line items. Filters soft-deleted rows so a
 * deleted asset surfaces as "not found" rather than silently producing a
 * line item pointing at a dead record.
 */
export function findAssetsByIds(tx: PrismaTransactionClient, assetIds: string[]) {
  return tx.asset.findMany({
    where: { id: { in: assetIds }, deletedAt: null },
    select: {
      id: true,
      assetNumber: true,
      name: true,
      serialNumber: true,
      condition: true,
      status: true,
    },
  });
}

export function findUsersByIds(tx: PrismaTransactionClient, userIds: string[]) {
  return tx.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: { id: true, name: true, employeeId: true, email: true },
  });
}

export function findLocationsByIds(tx: PrismaTransactionClient, locationIds: string[]) {
  return tx.location.findMany({
    where: { id: { in: locationIds }, deletedAt: null },
    select: { id: true, name: true },
  });
}

export function countMovements(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).assetMovement.count({ where: { handoverFormId: id } });
}

export function createAuditLogInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.AuditLogUncheckedCreateInput,
) {
  return tx.auditLog.create({ data });
}

export type HandoverFormDetail = NonNullable<Awaited<ReturnType<typeof findById>>>;
