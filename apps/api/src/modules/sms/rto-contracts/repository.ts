import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type { PrismaTransactionClient } from '../lib/types.js';
import type { RtoContractFull } from './types.js';
import type { ListRtoContractsQuery } from './schema.js';

// ── Shared select ─────────────────────────────────────────────────────────────

export const rtoContractSelect = {
  id: true,
  contractNumber: true,
  unitId: true,
  originShowroomId: true,
  orderLineId: true,
  salesUserId: true,
  customerName: true,
  customerPhone: true,
  customerIdNumber: true,
  startDate: true,
  handoverAt: true,
  returnKind: true,
  returnedAt: true,
  receivedAtShowroomId: true,
  closedAt: true,
  closedByUserId: true,
  legalReference: true,
  outcome: true,
  notes: true,
  isOpeningBalance: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  unit: {
    select: {
      id: true,
      vin: true,
      physicalLocationId: true,
      responsibleShowroomId: true,
      openRtoContractId: true,
      variant: {
        select: {
          name: true,
          color: true,
          model: { select: { name: true } },
        },
      },
    },
  },
  originShowroom: { select: { id: true, code: true, name: true } },
  receivedAtShowroom: { select: { id: true, code: true, name: true } },
  sales: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
} as const;

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function findById(id: string): Promise<RtoContractFull | null> {
  return prisma.smsRtoContract.findUnique({
    where: { id },
    select: rtoContractSelect,
  }) as Promise<RtoContractFull | null>;
}

export async function findByIdInTx(
  tx: PrismaTransactionClient,
  id: string,
): Promise<RtoContractFull | null> {
  return tx.smsRtoContract.findUnique({
    where: { id },
    select: rtoContractSelect,
  }) as Promise<RtoContractFull | null>;
}

/** Check if a contract number is already taken (globally unique). */
export async function findByContractNumber(
  contractNumber: string,
): Promise<{ id: string } | null> {
  return prisma.smsRtoContract.findUnique({
    where: { contractNumber },
    select: { id: true },
  });
}

export async function findMany(
  query: ListRtoContractsQuery,
  scope: 'ALL' | string[],
  skip: number,
  take: number,
): Promise<{ data: RtoContractFull[]; total: number }> {
  const where = buildListWhere(query, scope);
  const [data, total] = await Promise.all([
    prisma.smsRtoContract.findMany({
      where,
      select: rtoContractSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.smsRtoContract.count({ where }),
  ]);
  return { data: data as RtoContractFull[], total };
}

function buildListWhere(
  query: ListRtoContractsQuery,
  scope: 'ALL' | string[],
): Prisma.SmsRtoContractWhereInput {
  const filters: Prisma.SmsRtoContractWhereInput[] = [];

  // Location scope: caller must have STOCK_VIEW at origin OR responsible showroom.
  if (scope !== 'ALL') {
    filters.push({
      OR: [
        { originShowroomId: { in: scope } },
        { unit: { responsibleShowroomId: { in: scope } } },
      ],
    });
  }

  // Showroom filter.
  if (query.showroomId) {
    filters.push({
      OR: [
        { originShowroomId: query.showroomId },
        { unit: { responsibleShowroomId: query.showroomId } },
      ],
    });
  }

  // Status filter.
  if (query.status !== 'all') {
    switch (query.status) {
      case 'active':
        // No closure yet.
        filters.push({ closedAt: null });
        break;
      case 'returned_open':
        // Physically returned (returnedAt set) but contract not closed.
        filters.push({ returnedAt: { not: null }, closedAt: null });
        break;
      case 'closed':
        filters.push({ closedAt: { not: null } });
        break;
    }
  }

  // Search: contract number, customer name, VIN.
  if (query.search) {
    const term = query.search;
    filters.push({
      OR: [
        { contractNumber: { contains: term, mode: 'insensitive' } },
        { customerName: { contains: term, mode: 'insensitive' } },
        { unit: { vin: { contains: term, mode: 'insensitive' } } },
      ],
    });
  }

  return filters.length === 0 ? {} : filters.length === 1 ? (filters[0] ?? {}) : { AND: filters };
}

/** Validate that a sales person exists and is not deleted. */
export async function validateSalesUser(
  tx: PrismaTransactionClient,
  userId: string,
): Promise<boolean> {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  return user !== null;
}
