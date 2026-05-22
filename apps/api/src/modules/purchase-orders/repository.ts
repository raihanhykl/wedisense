import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient, PurchaseOrderListFilters } from './types.js';

// Columns we surface on the list view. Heavy JSONB (attachments,
// customFields) deliberately excluded — those land via the detail
// endpoint to keep list payloads lean.
const purchaseOrderListSelect = {
  id: true,
  poNumber: true,
  name: true,
  status: true,
  vendor: true,
  poDate: true,
  expectedDeliveryDate: true,
  currency: true,
  totalAmount: true,
  batchCount: true,
  assetCount: true,
  createdByUserId: true,
  closedByUserId: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function buildWhereClause(
  filters: PurchaseOrderListFilters,
): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = { deletedAt: null };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.vendor) {
    // Phase 17 v2 — vendor is now a relation; filter through Vendor.name.
    where.vendor = { name: { contains: filters.vendor, mode: 'insensitive' } };
  }

  if (filters.search) {
    where.OR = [
      { poNumber: { contains: filters.search, mode: 'insensitive' } },
      { name: { contains: filters.search, mode: 'insensitive' } },
      { vendor: { name: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  if (filters.poDateFrom || filters.poDateTo) {
    where.poDate = {};
    if (filters.poDateFrom) where.poDate.gte = new Date(filters.poDateFrom);
    if (filters.poDateTo) where.poDate.lte = new Date(filters.poDateTo);
  }

  return where;
}

export async function findMany(
  filters: PurchaseOrderListFilters,
  skip: number,
  take: number,
) {
  const where = buildWhereClause(filters);

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take,
      select: purchaseOrderListSelect,
      orderBy: [{ poDate: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { data, total };
}

// Detail load. Includes child batches (id + headline fields only — same
// "lean child rows" pattern as Asset detail's movements relation) and
// the creator/closer user references so the UI can render the names
// without a follow-up query.
export async function findById(id: string) {
  return prisma.purchaseOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      closedBy: { select: { id: true, name: true, email: true } },
      batches: {
        where: { deletedAt: null },
        select: {
          id: true,
          batchNumber: true,
          name: true,
          status: true,
          bastNumber: true,
          bastDate: true,
          receivedDate: true,
          assetCount: true,
          totalAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function findByNumber(poNumber: string) {
  return prisma.purchaseOrder.findFirst({
    where: { poNumber, deletedAt: null },
    select: { id: true },
  });
}

export async function create(
  data: Prisma.PurchaseOrderCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).purchaseOrder.create({ data });
}

export async function update(
  id: string,
  data: Prisma.PurchaseOrderUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).purchaseOrder.update({ where: { id }, data });
}

export async function softDelete(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).purchaseOrder.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

/**
 * Thread-safe SP-YYYY-NNNN generator.
 *
 * Atomic INSERT…ON CONFLICT mirrors the existing asset-number pattern in
 * `assets/service.ts:15-30`. The row-level lock that Postgres acquires on
 * the conflict path serialises concurrent imports without an explicit
 * SELECT…FOR UPDATE round-trip. Must be called inside the same $transaction
 * that creates the PO so the counter bump rolls back if the create fails.
 */
export async function nextPurchaseOrderNumber(
  tx: PrismaTransactionClient,
): Promise<string> {
  const year = new Date().getFullYear();

  const result = await (
    tx as unknown as { $queryRaw: typeof prisma.$queryRaw }
  ).$queryRaw<Array<{ current_sequence: number }>>`
    INSERT INTO purchase_order_sequences (id, year, current_sequence)
    VALUES (gen_random_uuid(), ${year}, 1)
    ON CONFLICT (year)
    DO UPDATE SET current_sequence = purchase_order_sequences.current_sequence + 1
    RETURNING current_sequence
  `;

  const seq = result[0]!.current_sequence;
  return `SP-${year}-${String(seq).padStart(4, '0')}`;
}
