import { randomUUID } from 'crypto';
import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { PurchaseOrderStatus } from '@prisma/client';
import * as poRepo from './repository.js';
import { computeItemAmounts, sumPoTotals } from './totals.js';
import type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  CancelPurchaseOrderInput,
  PurchaseOrderItemInput,
} from './schema.js';
import type { PrismaTransactionClient, PurchaseOrderListFilters } from './types.js';

// ── State machine ───────────────────────────────────────────────────────────
//
// OPEN ──────► PARTIALLY_RECEIVED ──────► FULLY_RECEIVED ──────► CLOSED
//   │                  ▲                          ▲
//   │                  └────────  Tier 3 cascade  ┘
//   │   (batch.RECEIVED triggers parent recompute — implemented when
//   │    procurement-batches module lands)
//   │
//   └─► CANCELLED (terminal, from OPEN or PARTIALLY_RECEIVED only)
//
// Tier 2 only exposes the manual transitions the user can perform via
// the UI:
//   * close  — must be in FULLY_RECEIVED, advances to CLOSED
//   * cancel — must be in OPEN or PARTIALLY_RECEIVED, advances to CANCELLED
//
// The PARTIALLY_RECEIVED ↔ FULLY_RECEIVED auto-advance lives in the
// batches module (Tier 3), because that's where batch-receipt events
// originate. Cross-module ownership stays on the side that has the
// trigger data; PurchaseOrder service exposes a recompute hook the
// batches module can call.

/** Statuses where most mutations and metadata edits are allowed. */
const MUTABLE_STATUSES: PurchaseOrderStatus[] = ['OPEN', 'PARTIALLY_RECEIVED'];

/** Statuses from which CANCELLED is reachable. */
const CANCELLABLE_STATUSES: PurchaseOrderStatus[] = ['OPEN', 'PARTIALLY_RECEIVED'];

// ── Read ────────────────────────────────────────────────────────────────────

export async function listPurchaseOrders(
  filters: PurchaseOrderListFilters,
  skip: number,
  take: number,
) {
  return poRepo.findMany(filters, skip, take);
}

export async function getPurchaseOrder(id: string) {
  const po = await poRepo.findById(id);
  if (!po) {
    throw new AppError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }
  // Per-item receipt aggregates so the UI can render real progress
  // ("1 / 1 received") and the new-batch form can disable items that
  // are out of capacity. Two buckets:
  //   - qtyReceived       : sum across RECEIVED + COMPLETED batches
  //                         (what physically arrived)
  //   - qtyInDraftBatches : sum across DRAFT + ITEMS_PENDING batches
  //                         (reserved capacity — backend still rejects
  //                         attempts to over-allocate via these)
  // Run in parallel with the main fetch already done — two cheap
  // groupBy queries scoped to this PO's items only.
  const [receivedRaw, inDraftRaw] = await Promise.all([
    prisma.batchItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: {
        purchaseOrderItem: { purchaseOrderId: id },
        procurementBatch: {
          deletedAt: null,
          status: { in: ['RECEIVED', 'COMPLETED'] },
        },
      },
      _sum: { qtyReceived: true },
    }),
    prisma.batchItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: {
        purchaseOrderItem: { purchaseOrderId: id },
        procurementBatch: {
          deletedAt: null,
          status: { in: ['DRAFT', 'ITEMS_PENDING'] },
        },
      },
      _sum: { qtyReceived: true },
    }),
  ]);

  const receivedByItem = new Map<string, number>(
    receivedRaw.map((r) => [r.purchaseOrderItemId, r._sum.qtyReceived ?? 0]),
  );
  const inDraftByItem = new Map<string, number>(
    inDraftRaw.map((r) => [r.purchaseOrderItemId, r._sum.qtyReceived ?? 0]),
  );

  return {
    ...po,
    items: po.items.map((it) => ({
      ...it,
      qtyReceived: receivedByItem.get(it.id) ?? 0,
      qtyInDraftBatches: inDraftByItem.get(it.id) ?? 0,
    })),
  };
}

// ── Item validation + row preparation ───────────────────────────────────────
//
// Translates user input into ready-to-insert Prisma createMany rows.
// Validates every product UUID exists, then computes the three
// denormalised amounts per item plus the PO-level totals. Runs inside
// the create/update transaction so a missing product rolls back the
// whole operation.
async function validateAndPrepareItems(
  poId: string,
  items: PurchaseOrderItemInput[],
  tx: PrismaTransactionClient,
): Promise<{
  rows: Prisma.PurchaseOrderItemCreateManyInput[];
  totals: { untaxedAmount: Prisma.Decimal; totalTaxes: Prisma.Decimal; totalAmount: Prisma.Decimal };
}> {
  // Pre-load referenced products in a single query. Empty array (no
  // items) is guarded by the Zod schema's `min(1)` so we never get here
  // with zero items.
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  const productSet = new Set(products.map((p) => p.id));

  for (const item of items) {
    if (!productSet.has(item.productId)) {
      throw new AppError(
        404,
        'PRODUCT_NOT_FOUND',
        `Product ${item.productId} not found`,
      );
    }
  }

  const computedAmounts = items.map((i) => computeItemAmounts(i));

  const rows: Prisma.PurchaseOrderItemCreateManyInput[] = items.map((item, idx) => {
    const amt = computedAmounts[idx]!;
    return {
      id: randomUUID(),
      purchaseOrderId: poId,
      productId: item.productId,
      qty: item.qty,
      unitPrice: new Prisma.Decimal(item.unitPrice),
      discountPercent: new Prisma.Decimal(item.discountPercent ?? 0),
      taxPercent: new Prisma.Decimal(item.taxPercent ?? 0),
      untaxedAmount: amt.untaxedAmount,
      taxAmount: amt.taxAmount,
      totalAmount: amt.totalAmount,
      // Service-assigned default: 0, 10, 20… so the user can reorder
      // (insert "5" between 0 and 10) without renumbering siblings.
      // Explicit user value wins if provided.
      sortOrder: item.sortOrder ?? idx * 10,
      notes: item.notes ?? null,
    };
  });

  const totals = sumPoTotals(computedAmounts);
  return { rows, totals };
}

// ── Vendor validation helper ────────────────────────────────────────────────
//
// Pre-check inside the same transaction that creates/updates the PO so
// a missing or archived vendor reverts the whole operation cleanly
// rather than letting the DB's Restrict FK throw a raw P2003.
async function assertVendorExists(
  vendorId: string,
  tx: PrismaTransactionClient,
): Promise<void> {
  const vendor = await tx.vendor.findFirst({
    where: { id: vendorId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!vendor) {
    throw new AppError(
      404,
      'VENDOR_NOT_FOUND',
      `Vendor ${vendorId} not found or archived`,
    );
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  userId: string,
) {
  // Generate the SP number, validate inputs, persist PO + items, and
  // write the audit log in ONE $transaction so the SP-number sequence
  // bump rolls back together with any validation failure.
  return prisma.$transaction(async (tx) => {
    await assertVendorExists(input.vendorId, tx);

    const poNumber = await poRepo.nextPurchaseOrderNumber(tx);
    const poId = randomUUID();

    const { rows: itemRows, totals } = await validateAndPrepareItems(
      poId,
      input.items,
      tx,
    );

    const created = await poRepo.create(
      {
        id: poId,
        poNumber,
        name: input.name ?? null,
        description: input.description ?? null,
        status: 'OPEN',
        vendor: { connect: { id: input.vendorId } },
        poDate: input.poDate,
        expectedDeliveryDate: input.expectedDeliveryDate ?? null,
        poUrl: input.poUrl ?? null,
        currency: input.currency ?? 'IDR',
        untaxedAmount: totals.untaxedAmount,
        totalTaxes: totals.totalTaxes,
        totalAmount: totals.totalAmount,
        notes: input.notes ?? null,
        attachments: (input.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdBy: { connect: { id: userId } },
      },
      tx,
    );

    await poRepo.createItems(itemRows, tx);

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'PurchaseOrder',
        resourceId: created.id,
        newValues: {
          ...created,
          itemCount: itemRows.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // Re-fetch with items + vendor populated so the caller sees the
    // complete picture for redirect-to-detail UX.
    const detail = await tx.purchaseOrder.findUnique({
      where: { id: created.id },
      include: {
        vendor: { select: { id: true, name: true } },
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    return detail ?? created;
  });
}

// ── Update (metadata + optional items replacement) ─────────────────────────
//
// Status changes go through /close and /cancel — never via this endpoint.
// Items replacement (when `input.items` is provided) is allowed ONLY when
// the PO has zero batches attached, because BatchItem rows FK to
// PurchaseOrderItem.id; replacing items mid-batch would orphan or
// silently void those receipts.

export async function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
  userId: string,
) {
  const existing = await poRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }

  // Only OPEN / PARTIALLY_RECEIVED accept metadata edits. FULLY_RECEIVED
  // is editable too — supplier contact / notes can still legitimately
  // change before close. CLOSED and CANCELLED are immutable.
  if (existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
    throw new AppError(
      409,
      'PURCHASE_ORDER_LOCKED',
      `Cannot modify a ${existing.status.toLowerCase()} purchase order`,
    );
  }

  // Cross-field check: when both dates are present in the patch OR one is
  // patched against an existing value, enforce expectedDeliveryDate >= poDate.
  const nextPoDate = input.poDate ?? existing.poDate;
  const nextExpected =
    input.expectedDeliveryDate !== undefined
      ? input.expectedDeliveryDate
      : existing.expectedDeliveryDate;
  if (nextPoDate && nextExpected && nextExpected < nextPoDate) {
    throw new AppError(
      400,
      'INVALID_DATE_RANGE',
      'expectedDeliveryDate must be on or after poDate',
    );
  }

  // Items replacement guard. Once batches exist, item rows are
  // referenced by BatchItem and cannot be swapped without orphaning
  // receipts.
  if (input.items !== undefined && existing.batches.length > 0) {
    throw new AppError(
      409,
      'PURCHASE_ORDER_HAS_BATCHES',
      'Cannot change PO items after a batch has been attached. Cancel the batches first or create a new PO.',
    );
  }

  return prisma.$transaction(async (tx) => {
    // Validate vendor swap inside the tx so a missing vendor reverts
    // the entire update.
    if (input.vendorId !== undefined && input.vendorId !== existing.vendorId) {
      await assertVendorExists(input.vendorId, tx);
    }

    // Compute new items + totals if the caller supplied an items array.
    let nextTotals:
      | { untaxedAmount: Prisma.Decimal; totalTaxes: Prisma.Decimal; totalAmount: Prisma.Decimal }
      | undefined;
    if (input.items !== undefined) {
      const prepared = await validateAndPrepareItems(id, input.items, tx);
      nextTotals = prepared.totals;
      await poRepo.replaceItems(id, prepared.rows, tx);
    }

    const updated = await poRepo.update(
      id,
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        // Phase 17 v2: vendor swaps via relation re-connect; totals come
        // from the items recompute above (never patched directly).
        ...(input.vendorId !== undefined && {
          vendor: { connect: { id: input.vendorId } },
        }),
        ...(input.poDate !== undefined && { poDate: input.poDate }),
        ...(input.expectedDeliveryDate !== undefined && {
          expectedDeliveryDate: input.expectedDeliveryDate,
        }),
        ...(input.poUrl !== undefined && { poUrl: input.poUrl }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.attachments !== undefined && {
          attachments: (input.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        }),
        ...(input.customFields !== undefined && {
          customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        }),
        ...(nextTotals && {
          untaxedAmount: nextTotals.untaxedAmount,
          totalTaxes: nextTotals.totalTaxes,
          totalAmount: nextTotals.totalAmount,
        }),
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
        newValues: {
          ...updated,
          ...(input.items !== undefined && { itemCount: input.items.length }),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

// ── Delete (soft) ───────────────────────────────────────────────────────────
//
// Only an OPEN PO with no batches is deletable. A PO that already has
// batches — even DRAFT ones — represents a real procurement event and
// stays on the books; cancel it instead.
export async function deletePurchaseOrder(id: string, userId: string) {
  const existing = await poRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }

  if (existing.status !== 'OPEN') {
    throw new AppError(
      409,
      'PURCHASE_ORDER_NOT_DELETABLE',
      `Cannot delete a ${existing.status.toLowerCase()} purchase order. Cancel it instead.`,
    );
  }

  if (existing.batchCount > 0 || existing.batches.length > 0) {
    throw new AppError(
      409,
      'PURCHASE_ORDER_HAS_BATCHES',
      'Cannot delete a purchase order with procurement batches. Cancel it instead.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await poRepo.softDelete(id, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// ── Close ───────────────────────────────────────────────────────────────────
//
// CLOSED is the terminal "everything is done" state. Reachable only from
// FULLY_RECEIVED — we don't allow an admin to skip ahead from OPEN
// because closing an unreceived PO leaves the procurement state ambiguous
// (was the order fulfilled? was it cancelled?). Use cancel for that case.
//
// Phase 17 v2 / spec §3.6: even from FULLY_RECEIVED, close requires that
// every PO line item has been 100% fulfilled (sum of qtyReceived across
// non-cancelled batches == PO line qty). The auto-cascade in
// recomputePurchaseOrderStatus already enforces this for the FULLY_RECEIVED
// transition itself, but we re-check here as a defence-in-depth guard —
// closes shouldn't depend on a derived status that could theoretically
// drift if the cascade ever has a bug.
export async function closePurchaseOrder(id: string, userId: string) {
  const existing = await poRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }

  if (existing.status === 'CLOSED') {
    // Idempotent: already closed → return current row without a no-op audit.
    return existing;
  }

  if (existing.status !== 'FULLY_RECEIVED') {
    throw new AppError(
      409,
      'PURCHASE_ORDER_NOT_CLOSABLE',
      `Only FULLY_RECEIVED purchase orders can be closed. Current status: ${existing.status}.`,
    );
  }

  // Per-line qty audit — re-verify outside the cascade. Surface a
  // detailed error per item so the UI can highlight which lines are
  // still short.
  const receivedMap = await poRepo.sumReceivedByItem(id);
  const shortfalls = existing.items
    .map((it) => ({
      productId: it.productId,
      itemId: it.id,
      ordered: it.qty,
      received: receivedMap.get(it.id) ?? 0,
    }))
    .filter((s) => s.received < s.ordered);

  if (shortfalls.length > 0) {
    throw new AppError(
      409,
      'PURCHASE_ORDER_INCOMPLETE_RECEIPT',
      `Cannot close — ${shortfalls.length} item(s) under-received: ${shortfalls
        .map((s) => `${s.received}/${s.ordered}`)
        .join(', ')}.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await poRepo.update(
      id,
      {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: { connect: { id: userId } },
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        oldValues: { status: existing.status } as unknown as Prisma.InputJsonValue,
        newValues: {
          status: 'CLOSED',
          closedAt: updated.closedAt,
          closedByUserId: userId,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

// ── Cancel ──────────────────────────────────────────────────────────────────
//
// Cancellation requires a reason. We append the reason to the PO's
// `notes` field so a future reader sees it without diffing the audit log,
// AND we record it in the audit log for the immutable trail.
export async function cancelPurchaseOrder(
  id: string,
  input: CancelPurchaseOrderInput,
  userId: string,
) {
  const existing = await poRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }

  if (!CANCELLABLE_STATUSES.includes(existing.status)) {
    throw new AppError(
      409,
      'PURCHASE_ORDER_NOT_CANCELLABLE',
      `Cannot cancel a ${existing.status.toLowerCase()} purchase order. Only OPEN or PARTIALLY_RECEIVED are cancellable.`,
    );
  }

  const cancelStamp = `[Cancelled ${new Date().toISOString()}] ${input.reason}`;
  const nextNotes = existing.notes ? `${existing.notes}\n\n${cancelStamp}` : cancelStamp;

  return prisma.$transaction(async (tx) => {
    const updated = await poRepo.update(
      id,
      {
        status: 'CANCELLED',
        notes: nextNotes,
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        oldValues: {
          status: existing.status,
          notes: existing.notes,
        } as unknown as Prisma.InputJsonValue,
        newValues: {
          status: 'CANCELLED',
          notes: nextNotes,
          cancellationReason: input.reason,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

// Exported for the batches module (Tier 3) — let downstream batch events
// recompute their parent PO's status. The mutable-statuses constant lives
// here as the source of truth.
export { MUTABLE_STATUSES };

// ── Cascade from batches ────────────────────────────────────────────────────
//
// Called by the procurement-batches module whenever a batch is created,
// soft-deleted, cancelled, or transitions across the RECEIVED threshold.
// Walks the PO's non-deleted, non-cancelled batches and derives the
// correct PO status:
//
//   no batches                          → OPEN
//   any received batch                  → at least PARTIALLY_RECEIVED
//   all PO line items 100% received     → FULLY_RECEIVED
//
// Phase 17 v2: FULLY_RECEIVED now requires PER-LINE qty fulfillment
// (spec §3.6), not just "all batches in RECEIVED". A batch can be
// RECEIVED while still under-fulfilling its PO line — that puts the
// PO in PARTIALLY_RECEIVED until additional batches close the gap.
//
// CLOSED and CANCELLED POs are terminal — we never demote out of them,
// even if a downstream operation would otherwise suggest it. (A late
// batch on a CLOSED PO is a data-quality issue the user has to resolve
// manually; auto-demoting would silently void a financial close.)
//
// Writes an audit log only when the status actually changes. `actorId`
// may be null for cascades originating from system jobs; the audit row
// supports null user_id for system actions.
export async function recomputePurchaseOrderStatus(
  poId: string,
  tx: PrismaTransactionClient,
  actorId: string | null,
): Promise<{ status: PurchaseOrderStatus; changed: boolean } | null> {
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!po) return null;

  // Terminal statuses do not auto-recompute.
  if (po.status === 'CLOSED' || po.status === 'CANCELLED') {
    return { status: po.status, changed: false };
  }

  // Only count batches that are real (not soft-deleted) and not voided
  // (not CANCELLED). A cancelled batch is a procurement event that didn't
  // happen, so it shouldn't influence the parent PO's status.
  const batches = await tx.procurementBatch.findMany({
    where: {
      purchaseOrderId: poId,
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
    select: { status: true },
  });

  let nextStatus: PurchaseOrderStatus;
  if (batches.length === 0) {
    nextStatus = 'OPEN';
  } else {
    const isReceived = (s: string) => s === 'RECEIVED' || s === 'COMPLETED';
    const anyReceived = batches.some((b) => isReceived(b.status));

    if (!anyReceived) {
      // All batches still DRAFT or ITEMS_PENDING.
      nextStatus = 'OPEN';
    } else {
      // At least one batch received. FULLY_RECEIVED requires all PO
      // items to have qtyReceived ≥ qty across non-cancelled batches.
      // We fetch the PO's items + the per-item received tally and
      // compare.
      const [items, receivedMap] = await Promise.all([
        tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: poId },
          select: { id: true, qty: true },
        }),
        poRepo.sumReceivedByItem(poId, tx),
      ]);

      const everyFulfilled =
        items.length > 0 &&
        items.every((it) => (receivedMap.get(it.id) ?? 0) >= it.qty);

      nextStatus = everyFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';
    }
  }

  if (nextStatus === po.status) {
    return { status: po.status, changed: false };
  }

  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { status: nextStatus },
  });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: 'UPDATE',
      resourceType: 'PurchaseOrder',
      resourceId: poId,
      oldValues: { status: po.status } as unknown as Prisma.InputJsonValue,
      newValues: { status: nextStatus, recomputedBy: 'batch-cascade' } as unknown as Prisma.InputJsonValue,
    },
  });

  return { status: nextStatus, changed: true };
}

/** Increment the parent PO's batchCount. Called when a batch is created. */
export async function incrementBatchCount(
  poId: string,
  tx: PrismaTransactionClient,
) {
  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { batchCount: { increment: 1 } },
  });
}

/** Decrement the parent PO's batchCount. Called when a batch is soft-deleted. */
export async function decrementBatchCount(
  poId: string,
  tx: PrismaTransactionClient,
) {
  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { batchCount: { decrement: 1 } },
  });
}

/** Bump the parent PO's denormalised assetCount by a signed delta. */
export async function bumpAssetCount(
  poId: string,
  delta: number,
  tx: PrismaTransactionClient,
) {
  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { assetCount: { increment: delta } },
  });
}

