import { type Prisma, type SmsReturnRequest, type SmsDecision } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type {
  ReturnRequestRow,
  ReturnRequestDisplayStatus,
  ListReturnRequestsFilters,
} from './types.js';

// ── Projections ───────────────────────────────────────────────────────────────

const returnRequestSelect = {
  id: true,
  requestNumber: true,
  unitId: true,
  rtoContractId: true,
  fromShowroomId: true,
  toShowroomId: true,
  reason: true,
  requestedByUserId: true,
  requestedAt: true,
  decision: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionReason: true,
  custodyReceivedAt: true,
  officialReceivedAt: true,
  custodyResolvedAt: true,
  custodyResolution: true,
  createdAt: true,
  updatedAt: true,
  unit: {
    select: {
      id: true,
      vin: true,
      status: true,
      wasRto: true,
      responsibleShowroomId: true,
      openReturnRequestId: true,
      openRtoContractId: true,
      variant: {
        select: {
          name: true,
          batteryVariant: true,
          color: true,
          model: { select: { name: true } },
        },
      },
    },
  },
  rtoContract: {
    select: { contractNumber: true, customerName: true, customerPhone: true, customerIdNumber: true },
  },
  fromShowroom: { select: { id: true, name: true, code: true } },
  toShowroom: { select: { id: true, name: true, code: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

type RawReturnRequest = Prisma.SmsReturnRequestGetPayload<{ select: typeof returnRequestSelect }>;

// ── Derived status ────────────────────────────────────────────────────────────

export function computeDisplayStatus(r: Pick<SmsReturnRequest, 'decision' | 'custodyReceivedAt' | 'officialReceivedAt' | 'custodyResolvedAt'>): ReturnRequestDisplayStatus {
  if (r.officialReceivedAt !== null) return 'COMPLETED';
  if (r.decision === 'REJECTED') {
    if (r.custodyReceivedAt !== null && r.custodyResolvedAt === null) return 'REJECTED_IN_CUSTODY';
    return 'REJECTED';
  }
  if (r.decision === 'APPROVED') {
    return r.custodyReceivedAt !== null ? 'APPROVED_IN_CUSTODY' : 'APPROVED';
  }
  return 'PENDING';
}

// ── Mapper ────────────────────────────────────────────────────────────────────

export function mapToRow(raw: RawReturnRequest, canViewCustomer: boolean): ReturnRequestRow {
  const customerName = raw.rtoContract?.customerName ?? null;
  return {
    id: raw.id,
    requestNumber: raw.requestNumber,
    unitId: raw.unitId,
    rtoContractId: raw.rtoContractId,
    rtoContractNumber: raw.rtoContract?.contractNumber ?? null,
    fromShowroomId: raw.fromShowroomId,
    toShowroomId: raw.toShowroomId,
    reason: raw.reason,
    requestedByUserId: raw.requestedByUserId,
    requestedAt: raw.requestedAt,
    decision: raw.decision,
    decidedByUserId: raw.decidedByUserId,
    decidedAt: raw.decidedAt,
    decisionReason: raw.decisionReason,
    custodyReceivedAt: raw.custodyReceivedAt,
    officialReceivedAt: raw.officialReceivedAt,
    custodyResolvedAt: raw.custodyResolvedAt,
    custodyResolution: raw.custodyResolution,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    displayStatus: computeDisplayStatus(raw),
    unit: {
      id: raw.unit.id,
      vin: raw.unit.vin,
      status: raw.unit.status,
      wasRto: raw.unit.wasRto,
      variant: {
        modelName: raw.unit.variant.model.name,
        variantName: raw.unit.variant.name,
        batteryVariant: raw.unit.variant.batteryVariant,
        color: raw.unit.variant.color,
      },
    },
    fromShowroom: raw.fromShowroom,
    toShowroom: raw.toShowroom,
    requestedBy: raw.requestedBy,
    decidedBy: raw.decidedBy,
    customerName: canViewCustomer ? customerName : (customerName ? '[Hidden]' : null),
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function findById(id: string): Promise<RawReturnRequest | null> {
  return prisma.smsReturnRequest.findUnique({ where: { id }, select: returnRequestSelect });
}

/** Same as findById but reads through a Prisma transaction client, so the result
 *  reflects writes made earlier in the same transaction (use this inside runIdempotent
 *  callbacks to avoid reading stale data under READ COMMITTED isolation). */
export async function findByIdTx(tx: TransactionClient, id: string): Promise<RawReturnRequest | null> {
  return tx.smsReturnRequest.findUnique({ where: { id }, select: returnRequestSelect });
}

export async function findMany(
  filters: ListReturnRequestsFilters,
  skip: number,
  take: number,
): Promise<{ data: RawReturnRequest[]; total: number }> {
  const where = buildWhereClause(filters);
  const [data, total] = await Promise.all([
    prisma.smsReturnRequest.findMany({
      where,
      select: returnRequestSelect,
      orderBy: { requestedAt: 'desc' },
      skip,
      take,
    }),
    prisma.smsReturnRequest.count({ where }),
  ]);
  return { data, total };
}

function buildWhereClause(filters: ListReturnRequestsFilters): Prisma.SmsReturnRequestWhereInput {
  const where: Prisma.SmsReturnRequestWhereInput = {};

  // Direction + showroom scope
  const locationFilter = buildLocationFilter(filters);
  if (locationFilter !== null) {
    Object.assign(where, locationFilter);
  }

  // Status filter
  switch (filters.status) {
    case 'pending':
      where.decision = 'PENDING';
      break;
    case 'approved':
      where.decision = 'APPROVED';
      where.officialReceivedAt = null;
      break;
    case 'rejected_custody':
      where.decision = 'REJECTED';
      where.custodyReceivedAt = { not: null };
      where.custodyResolvedAt = null;
      break;
    case 'closed':
      where.OR = [
        { officialReceivedAt: { not: null } },
        { decision: 'REJECTED', custodyReceivedAt: null },
        { decision: 'REJECTED', custodyResolvedAt: { not: null } },
      ];
      break;
    case 'all':
      break;
  }

  return where;
}

function buildLocationFilter(
  filters: ListReturnRequestsFilters,
): Prisma.SmsReturnRequestWhereInput | null {
  const { showroomId, direction, scopeShowroomIds } = filters;

  // Build the set of accessible showroom IDs for scoping
  const scopeFilter =
    scopeShowroomIds === 'ALL' || scopeShowroomIds === undefined
      ? undefined
      : { in: scopeShowroomIds };

  if (showroomId) {
    // Specific showroom specified: direction filters which side it is on
    switch (direction) {
      case 'incoming':
        return { fromShowroomId: showroomId };
      case 'outgoing':
        return { toShowroomId: showroomId };
      case 'all':
      default:
        return { OR: [{ fromShowroomId: showroomId }, { toShowroomId: showroomId }] };
    }
  }

  if (scopeFilter === undefined) return null; // global user, no restriction

  // Scope array: include any request where either side is accessible
  switch (direction) {
    case 'incoming':
      return { fromShowroomId: scopeFilter };
    case 'outgoing':
      return { toShowroomId: scopeFilter };
    case 'all':
    default:
      return { OR: [{ fromShowroomId: scopeFilter }, { toShowroomId: scopeFilter }] };
  }
}

/** Minimal select for lookup results. */
export async function findUnitsForLookup(
  query: string,
): Promise<
  Array<{
    id: string;
    vin: string;
    status: string;
    responsibleShowroomId: string;
    wasRto: boolean;
    variant: { name: string; batteryVariant: string | null; color: string; model: { name: string } };
    responsibleShowroom: { id: string; name: string };
    openRtoContract: { contractNumber: string; customerName: string } | null;
    openReturnRequest: {
      id: string;
      requestNumber: string;
      toShowroomId: string;
      toShowroom: { name: string };
      decision: SmsDecision;
    } | null;
  }>
> {
  // Build WHERE conditions: exact VIN, VIN suffix (>=5 chars), or exact RTO contract number
  const isLongEnoughForSuffix = query.length >= 5;
  const conditions: Prisma.SmsUnitWhereInput[] = [
    { vin: { equals: query, mode: 'insensitive' } },
    ...(isLongEnoughForSuffix ? [{ vin: { endsWith: query, mode: 'insensitive' as const } }] : []),
    {
      openRtoContract: {
        contractNumber: { equals: query, mode: 'insensitive' },
      },
    },
  ];

  return prisma.smsUnit.findMany({
    where: {
      status: { in: ['ACTIVE_RTO', 'CUSTODY'] },
      OR: conditions,
    },
    take: 10,
    orderBy: { vin: 'asc' },
    select: {
      id: true,
      vin: true,
      status: true,
      responsibleShowroomId: true,
      wasRto: true,
      variant: {
        select: {
          name: true,
          batteryVariant: true,
          color: true,
          model: { select: { name: true } },
        },
      },
      responsibleShowroom: { select: { id: true, name: true } },
      openRtoContract: {
        select: { contractNumber: true, customerName: true },
      },
      openReturnRequest: {
        select: {
          id: true,
          requestNumber: true,
          toShowroomId: true,
          toShowroom: { select: { name: true } },
          decision: true,
        },
      },
    },
  });
}

// ── Write helpers used by service (inside a transaction) ──────────────────────

export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function createReturnRequest(
  tx: TransactionClient,
  data: Prisma.SmsReturnRequestUncheckedCreateInput,
): Promise<SmsReturnRequest> {
  return tx.smsReturnRequest.create({ data });
}

export async function updateReturnRequest(
  tx: TransactionClient,
  id: string,
  data: Prisma.SmsReturnRequestUncheckedUpdateInput,
): Promise<SmsReturnRequest> {
  return tx.smsReturnRequest.update({ where: { id }, data });
}

/**
 * Conditional update for the decide step: returns null if the request is no
 * longer PENDING (someone else got there first).
 */
export async function decideReturnRequest(
  tx: TransactionClient,
  id: string,
  data: Prisma.SmsReturnRequestUncheckedUpdateInput,
): Promise<SmsReturnRequest | null> {
  const updated = await tx.smsReturnRequest.updateMany({
    where: { id, decision: 'PENDING' },
    data,
  });
  if (updated.count === 0) return null;
  return tx.smsReturnRequest.findUniqueOrThrow({ where: { id } });
}
