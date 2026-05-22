import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient, PurchaseOrderListFilters } from './types.js';

// Columns we surface on the list view. Heavy JSONB (attachments,
// customFields) deliberately excluded — those land via the detail
// endpoint to keep list payloads lean.
//
// Phase 17 v2: vendor is now a relation, so we select its id/name into
// a nested object. List items also get itemCount (computed from
// _count) so the tree-view list can render a chevron only when the PO
// actually has line items.
const purchaseOrderListSelect = {
  id: true,
  poNumber: true,
  name: true,
  status: true,
  vendor: { select: { id: true, name: true } },
  poDate: true,
  expectedDeliveryDate: true,
  currency: true,
  untaxedAmount: true,
  totalTaxes: true,
  totalAmount: true,
  batchCount: true,
  assetCount: true,
  createdByUserId: true,
  closedByUserId: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true, batches: true } },
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
      vendor: {
        select: {
          id: true,
          name: true,
          taxId: true,
          email: true,
          phone: true,
          contactPerson: true,
        },
      },
      createdBy: { select: { id: true, name: true, email: true } },
      closedBy: { select: { id: true, name: true, email: true } },
      // Line items + their product reference. Ordered by sortOrder so
      // the UI presents the list in the order the user authored.
      items: {
        select: {
          id: true,
          productId: true,
          qty: true,
          unitPrice: true,
          discountPercent: true,
          taxPercent: true,
          untaxedAmount: true,
          taxAmount: true,
          totalAmount: true,
          sortOrder: true,
          notes: true,
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
              model: true,
              eanCode: true,
              category: { select: { id: true, name: true, code: true } },
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
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

/**
 * Light fetch returning just the PO's items (id, qty, totals) — used
 * by the Tier 7.4 batch service when it needs to validate qty receipts
 * against PO line capacity. Skips heavy product joins.
 */
export async function findItemsForReceiptCheck(poId: string) {
  return prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: poId },
    select: { id: true, qty: true, productId: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
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

// ── Line items (Phase 17 v2) ────────────────────────────────────────────────

export async function createItems(
  data: Prisma.PurchaseOrderItemCreateManyInput[],
  tx: PrismaTransactionClient,
) {
  if (data.length === 0) return { count: 0 };
  return tx.purchaseOrderItem.createMany({ data });
}

/**
 * Atomic item replacement — used by update when the caller sends a
 * fresh items array. Service-layer guards ensure this is only invoked
 * when status === OPEN (no batches attached).
 */
export async function replaceItems(
  poId: string,
  items: Prisma.PurchaseOrderItemCreateManyInput[],
  tx: PrismaTransactionClient,
) {
  await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: poId } });
  if (items.length > 0) {
    await tx.purchaseOrderItem.createMany({ data: items });
  }
}

/**
 * Sum the qtyReceived per PO item across all non-cancelled, non-deleted
 * batches. Returns a map keyed by purchase_order_item_id, used by both
 * recomputePurchaseOrderStatus (Tier 7.3) and the closePO qty guard
 * (spec §3.6: cannot complete unless 100% received).
 */
export async function sumReceivedByItem(
  poId: string,
  tx?: PrismaTransactionClient,
): Promise<Map<string, number>> {
  const rows = await (tx ?? prisma).batchItem.groupBy({
    by: ['purchaseOrderItemId'],
    where: {
      purchaseOrderItem: { purchaseOrderId: poId },
      procurementBatch: {
        deletedAt: null,
        status: { in: ['RECEIVED', 'COMPLETED'] },
      },
    },
    _sum: { qtyReceived: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.purchaseOrderItemId, r._sum.qtyReceived ?? 0);
  }
  return map;
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
