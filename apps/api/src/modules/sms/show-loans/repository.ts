import { type Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { businessToday } from '../lib/ledger.js';

/**
 * Full projection for list and detail queries.
 * Includes unit auth columns (physicalLocationId / responsibleShowroomId) so
 * the service can run per-location checks without a second query.
 */
const showLoanSelect = {
  id: true,
  unitId: true,
  unit: {
    select: {
      id: true,
      vin: true,
      status: true,
      physicalLocationId: true,
      responsibleShowroomId: true,
      variant: {
        select: {
          name: true,
          color: true,
          model: { select: { name: true } },
        },
      },
    },
  },
  showroomId: true,
  eventName: true,
  eventLocation: true,
  pic: { select: { id: true, name: true } },
  dispatchedAt: true,
  expectedReturnDate: true,
  returnedAt: true,
  returnCondition: true,
  hasFindings: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ShowLoanFull = Prisma.SmsShowLoanGetPayload<{ select: typeof showLoanSelect }>;

export interface ListFilters {
  showroomId?: string;
  status?: 'out' | 'overdue' | 'returned' | 'all';
  /**
   * Caller's visible showroom scope from `locationScope(access, STOCK_VIEW)`.
   * Undefined means "no scope restriction" (global or already filtered by showroomId).
   * 'ALL' means global access.
   * string[] means specific location IDs.
   */
  scopeShowroomIds?: 'ALL' | string[];
}

export async function findMany(
  filters: ListFilters,
  skip: number,
  take: number,
  now: Date = new Date(),
): Promise<{ data: ShowLoanFull[]; total: number }> {
  const today = businessToday(now);

  const where: Prisma.SmsShowLoanWhereInput = {};

  // Location scope: specific showroom takes priority over scope array
  if (filters.showroomId) {
    where.showroomId = filters.showroomId;
  } else if (filters.scopeShowroomIds !== undefined && filters.scopeShowroomIds !== 'ALL') {
    where.showroomId = { in: filters.scopeShowroomIds };
  }
  // scopeShowroomIds === 'ALL' → no showroom filter (global user sees everything)

  // Status filter
  switch (filters.status) {
    case 'returned':
      where.returnedAt = { not: null };
      break;
    case 'out':
      // Everything still at an event — overdue loans included (they carry
      // the overdue flag); 'overdue' is the subset past the planned return.
      where.returnedAt = null;
      break;
    case 'overdue':
      where.returnedAt = null;
      where.expectedReturnDate = { lt: today };
      break;
    // 'all' and undefined: no extra filter
  }

  const [data, total] = await Promise.all([
    prisma.smsShowLoan.findMany({
      where,
      skip,
      take,
      select: showLoanSelect,
      orderBy: { dispatchedAt: 'desc' },
    }),
    prisma.smsShowLoan.count({ where }),
  ]);

  return { data, total };
}

/** `client` lets a caller read its own uncommitted writes inside a transaction. */
export async function findById(
  id: string,
  client: Prisma.TransactionClient = prisma,
): Promise<ShowLoanFull | null> {
  return client.smsShowLoan.findUnique({ where: { id }, select: showLoanSelect });
}
