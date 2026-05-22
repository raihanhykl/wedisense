import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type {
  PrismaTransactionClient,
  ProcurementBatchListFilters,
} from './types.js';

// List view: skip heavy JSONB columns (attachments, customFields) and the
// full asset roster. The detail endpoint pulls those when needed.
const procurementBatchListSelect = {
  id: true,
  purchaseOrderId: true,
  batchNumber: true,
  name: true,
  status: true,
  bastNumber: true,
  bastDate: true,
  invoiceNumber: true,
  invoiceDate: true,
  purchaseDate: true,
  receivedDate: true,
  currency: true,
  totalAmount: true,
  assetCount: true,
  receivedByUserId: true,
  receivedByName: true,
  createdByUserId: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      status: true,
      vendor: { select: { id: true, name: true } },
    },
  },
} as const;

function buildWhereClause(
  filters: ProcurementBatchListFilters,
): Prisma.ProcurementBatchWhereInput {
  const where: Prisma.ProcurementBatchWhereInput = { deletedAt: null };

  if (filters.status) where.status = filters.status;
  if (filters.purchaseOrderId) where.purchaseOrderId = filters.purchaseOrderId;

  if (filters.vendor) {
    // Vendor is a relation on PO (Phase 17 v2). Chain through to the
    // Vendor.name field.
    where.purchaseOrder = {
      vendor: { name: { contains: filters.vendor, mode: 'insensitive' } },
    };
  }

  if (filters.bastNumber) {
    where.bastNumber = { contains: filters.bastNumber, mode: 'insensitive' };
  }

  if (filters.invoiceNumber) {
    where.invoiceNumber = {
      contains: filters.invoiceNumber,
      mode: 'insensitive',
    };
  }

  if (filters.search) {
    where.OR = [
      { batchNumber: { contains: filters.search, mode: 'insensitive' } },
      { name: { contains: filters.search, mode: 'insensitive' } },
      { bastNumber: { contains: filters.search, mode: 'insensitive' } },
      { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  if (filters.purchaseDateFrom || filters.purchaseDateTo) {
    where.purchaseDate = {};
    if (filters.purchaseDateFrom) {
      where.purchaseDate.gte = new Date(filters.purchaseDateFrom);
    }
    if (filters.purchaseDateTo) {
      where.purchaseDate.lte = new Date(filters.purchaseDateTo);
    }
  }

  return where;
}

export async function findMany(
  filters: ProcurementBatchListFilters,
  skip: number,
  take: number,
) {
  const where = buildWhereClause(filters);

  const [data, total] = await Promise.all([
    prisma.procurementBatch.findMany({
      where,
      skip,
      take,
      select: procurementBatchListSelect,
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.procurementBatch.count({ where }),
  ]);

  return { data, total };
}

// Detail load. Includes parent PO summary + creator/receiver/completer
// user refs + child assets (top-N by createdAt). The asset roster is
// paginated separately in the assets module for batches that grow large;
// here we surface the first 100 inline for the detail page's default view.
export async function findById(id: string) {
  return prisma.procurementBatch.findFirst({
    where: { id, deletedAt: null },
    include: {
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          poDate: true,
          vendor: { select: { id: true, name: true } },
        },
      },
      defaultLocation: { select: { id: true, name: true, code: true } },
      defaultCategory: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      receivedBy: { select: { id: true, name: true, email: true } },
      completedBy: { select: { id: true, name: true, email: true } },
      // Phase 17 v2: line items include the referenced PO item +
      // product so the detail page can render qty/unitPrice/total per
      // product without follow-up queries.
      items: {
        select: {
          id: true,
          purchaseOrderItemId: true,
          qtyReceived: true,
          notes: true,
          createdAt: true,
          purchaseOrderItem: {
            select: {
              id: true,
              qty: true,
              unitPrice: true,
              discountPercent: true,
              taxPercent: true,
              sortOrder: true,
              product: {
                select: { id: true, name: true, brand: true, model: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      assets: {
        where: { deletedAt: null },
        select: {
          id: true,
          assetNumber: true,
          name: true,
          serialNumber: true,
          status: true,
          condition: true,
          locationId: true,
          assignedToUserId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
    },
  });
}

export async function findByNumber(batchNumber: string) {
  return prisma.procurementBatch.findFirst({
    where: { batchNumber, deletedAt: null },
    select: { id: true },
  });
}

export async function create(
  data: Prisma.ProcurementBatchCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).procurementBatch.create({ data });
}

export async function update(
  id: string,
  data: Prisma.ProcurementBatchUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).procurementBatch.update({ where: { id }, data });
}

export async function softDelete(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).procurementBatch.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ── Batch line items (Phase 17 v2) ──────────────────────────────────────────

export async function createItems(
  data: Prisma.BatchItemCreateManyInput[],
  tx: PrismaTransactionClient,
) {
  if (data.length === 0) return { count: 0 };
  return tx.batchItem.createMany({ data });
}

/**
 * Atomic replacement of a batch's items. Used by update when the caller
 * sends a fresh items array. Service-layer guards ensure this is only
 * invoked while the batch is in DRAFT or ITEMS_PENDING (after RECEIVED
 * we'd be rewriting history).
 */
export async function replaceItems(
  batchId: string,
  items: Prisma.BatchItemCreateManyInput[],
  tx: PrismaTransactionClient,
) {
  await tx.batchItem.deleteMany({ where: { procurementBatchId: batchId } });
  if (items.length > 0) {
    await tx.batchItem.createMany({ data: items });
  }
}

/**
 * Read the current BatchItem rows for a batch. Used by the updateBatch
 * flow to know what was there before so the audit-log diff is helpful.
 */
export async function findItemsForBatch(
  batchId: string,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).batchItem.findMany({
    where: { procurementBatchId: batchId },
    select: {
      id: true,
      purchaseOrderItemId: true,
      qtyReceived: true,
      notes: true,
    },
  });
}

/**
 * Count *real* (not soft-deleted) assets currently linked to a batch.
 * The batches.assetCount column is denormalised and updated inside the
 * transactions that link/unlink assets, but this raw count is the
 * source of truth — used by guards like "cancel only if assetCount == 0"
 * to avoid trusting the denormalised value.
 */
export async function countAssets(
  batchId: string,
  tx?: PrismaTransactionClient,
): Promise<number> {
  return (tx ?? prisma).asset.count({
    where: { procurementBatchId: batchId, deletedAt: null },
  });
}

/**
 * Increment / decrement the denormalised counters. Wrapped here so the
 * service layer doesn't sprinkle raw Prisma calls. `delta` is signed.
 */
export async function bumpAssetCount(
  batchId: string,
  delta: number,
  tx: PrismaTransactionClient,
) {
  await tx.procurementBatch.update({
    where: { id: batchId },
    data: { assetCount: { increment: delta } },
  });
}

/**
 * Atomic BATCH-YYYYMM-NNNN generator. Same INSERT…ON CONFLICT trick as
 * the asset-number sequence; the year_month integer (e.g. 202605) is the
 * unique key so concurrent inserts in the same month serialise on the
 * row lock without an explicit SELECT FOR UPDATE.
 */
export async function nextBatchNumber(
  tx: PrismaTransactionClient,
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const yearMonth = year * 100 + month;

  const result = await (
    tx as unknown as { $queryRaw: typeof prisma.$queryRaw }
  ).$queryRaw<Array<{ current_sequence: number }>>`
    INSERT INTO procurement_batch_sequences (id, year_month, current_sequence)
    VALUES (gen_random_uuid(), ${yearMonth}, 1)
    ON CONFLICT (year_month)
    DO UPDATE SET current_sequence = procurement_batch_sequences.current_sequence + 1
    RETURNING current_sequence
  `;

  const seq = result[0]!.current_sequence;
  return `BATCH-${year}${String(month).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;
}

/**
 * Audit aggregate for a single batch — returns audit_log rows for both
 * the batch itself AND every asset currently linked to it. One query
 * via UNION ALL so the result set is stably ordered server-side.
 *
 * Capped at 500 rows per query. The detail page consumes the latest
 * slice; a "load older" endpoint can paginate if a batch ever
 * accumulates more.
 */
export async function findBatchAuditTrail(batchId: string) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      user_id: string | null;
      action: string;
      resource_type: string;
      resource_id: string;
      old_values: unknown;
      new_values: unknown;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
    }>
  >`
    (
      SELECT id, user_id, action::text AS action, resource_type, resource_id,
             old_values, new_values, ip_address, user_agent, created_at
      FROM audit_logs
      WHERE resource_type = 'ProcurementBatch' AND resource_id = ${batchId}::uuid
    )
    UNION ALL
    (
      SELECT al.id, al.user_id, al.action::text AS action, al.resource_type, al.resource_id,
             al.old_values, al.new_values, al.ip_address, al.user_agent, al.created_at
      FROM audit_logs al
      WHERE al.resource_type = 'Asset'
        AND al.resource_id IN (
          SELECT id FROM assets WHERE procurement_batch_id = ${batchId}::uuid
        )
    )
    ORDER BY created_at DESC
    LIMIT 500
  `;
}
