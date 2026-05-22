import { randomUUID } from 'crypto';
import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { ProcurementBatchStatus } from '@prisma/client';
import * as batchRepo from './repository.js';
import {
  recomputePurchaseOrderStatus,
  incrementBatchCount,
  decrementBatchCount,
  bumpAssetCount as bumpPoAssetCount,
} from '../purchase-orders/service.js';
import * as poRepo from '../purchase-orders/repository.js';
import { computeItemAmounts } from '../purchase-orders/totals.js';
import type { PrismaTransactionClient } from './types.js';
import type {
  CreateProcurementBatchInput,
  UpdateProcurementBatchInput,
  ReceiveProcurementBatchInput,
  CompleteProcurementBatchInput,
  CancelProcurementBatchInput,
  BatchItemInput,
} from './schema.js';
import type { ProcurementBatchListFilters } from './types.js';

// ── State machine ───────────────────────────────────────────────────────────
//
// DRAFT ──────► ITEMS_PENDING ──────► RECEIVED ──────► COMPLETED
//                         ↓
//                      CANCELLED (terminal, only from DRAFT or ITEMS_PENDING)
//
// Transition guards live in service code rather than at the DB level so the
// error surface (AppError with code) is uniform with the rest of the app.
//
// Cascade rule: every transition that moves into or out of the RECEIVED
// status family (RECEIVED, COMPLETED) triggers a recompute of the parent
// PO's status (OPEN ↔ PARTIALLY_RECEIVED ↔ FULLY_RECEIVED). The recompute
// lives in purchase-orders/service.ts so PO state-machine logic stays in
// one place.

// ── Read ────────────────────────────────────────────────────────────────────

export async function listProcurementBatches(
  filters: ProcurementBatchListFilters,
  skip: number,
  take: number,
) {
  return batchRepo.findMany(filters, skip, take);
}

// ── Cross-module helpers (called from assets service / import service) ─────
//
// These let the assets module link/unlink an asset against a batch
// without re-implementing the validation + denormalised-count plumbing.

/**
 * Validate that a batch can accept new (or returning) asset links.
 * Returns the minimal batch summary the caller needs to make further
 * decisions; throws AppError on any rejection.
 *
 * Acceptance rules:
 *  - batch must exist and not be soft-deleted
 *  - status must be DRAFT or ITEMS_PENDING
 *    (RECEIVED+ means BAST signed — no new items expected;
 *     COMPLETED / CANCELLED are locked)
 *
 * Returns purchaseOrderId so the caller doesn't need a follow-up query
 * to know if it should cascade counts into the parent PO.
 */
export async function assertBatchAcceptsAssets(
  batchId: string,
  tx: PrismaTransactionClient,
): Promise<{ id: string; purchaseOrderId: string | null; status: ProcurementBatchStatus }> {
  const batch = await tx.procurementBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { id: true, status: true, purchaseOrderId: true },
  });
  if (!batch) {
    throw new AppError(
      404,
      'PROCUREMENT_BATCH_NOT_FOUND',
      `Procurement batch ${batchId} not found`,
    );
  }
  if (batch.status !== 'DRAFT' && batch.status !== 'ITEMS_PENDING') {
    throw new AppError(
      409,
      'BATCH_NOT_ACCEPTING_ASSETS',
      `Batch is in status ${batch.status} — only DRAFT or ITEMS_PENDING accept new asset links`,
    );
  }
  return batch;
}

/**
 * Apply a signed delta to a batch's denormalised assetCount AND cascade
 * the same delta to its parent PO (if any). Called from the assets
 * module after a successful create / bulk-create / bulk-import or after
 * a soft-delete. Must run inside the same $transaction that mutates
 * the asset row(s) so the count stays consistent with reality.
 *
 * The parent-PO lookup is a single FK read; we accept the extra
 * round-trip rather than threading purchaseOrderId through every call
 * site.
 */
export async function bumpBatchAssetCountWithCascade(
  batchId: string,
  delta: number,
  tx: PrismaTransactionClient,
): Promise<void> {
  if (delta === 0) return;
  await batchRepo.bumpAssetCount(batchId, delta, tx);
  const batch = await tx.procurementBatch.findUnique({
    where: { id: batchId },
    select: { purchaseOrderId: true },
  });
  if (batch?.purchaseOrderId) {
    await bumpPoAssetCount(batch.purchaseOrderId, delta, tx);
  }
}

export async function getProcurementBatch(id: string) {
  const batch = await batchRepo.findById(id);
  if (!batch) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }
  return batch;
}

export async function getBatchAuditTrail(id: string) {
  // Use findFirst — same not-found mapping the detail endpoint uses, so the
  // audit endpoint and detail endpoint surface identical error codes.
  const batch = await batchRepo.findById(id);
  if (!batch) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }
  return batchRepo.findBatchAuditTrail(id);
}

// ── Parent PO lookup + acceptance check ─────────────────────────────────────
//
// Returns the parent PO if it exists and is in a status that accepts
// new (or modified) batches; throws AppError otherwise. The returned
// fields are exactly what the batch needs to inherit at create time.
async function loadAcceptingPo(
  poId: string,
  tx: PrismaTransactionClient,
): Promise<{ id: string; status: string; currency: string; poDate: Date }> {
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, deletedAt: null },
    select: { id: true, status: true, currency: true, poDate: true },
  });
  if (!po) {
    throw new AppError(
      404,
      'PURCHASE_ORDER_NOT_FOUND',
      'Parent purchase order not found',
    );
  }
  if (po.status === 'CLOSED' || po.status === 'CANCELLED') {
    throw new AppError(
      409,
      'PURCHASE_ORDER_LOCKED',
      `Cannot attach a batch to a ${po.status.toLowerCase()} purchase order`,
    );
  }
  return po;
}

// ── Per-line qty validation + amount derivation ─────────────────────────────
//
// For each input BatchItem we:
//   1. confirm the purchaseOrderItemId belongs to the given PO
//   2. confirm qtyReceived ≤ (po_item.qty − already received in OTHER batches)
//   3. derive batch_item_total via computeItemAmounts() on the PO item's
//      unitPrice/discount/tax (substituting qty=qtyReceived). Same math
//      as PO line totals, so a 30-of-50 batch carries proportional value.
//
// `excludeBatchId` is supplied during update so the batch's OWN current
// items aren't double-counted in the remaining-capacity calculation.
async function validateAndPrepareBatchItems(
  batchId: string,
  poId: string,
  items: BatchItemInput[],
  excludeBatchId: string | null,
  tx: PrismaTransactionClient,
): Promise<{
  rows: Prisma.BatchItemCreateManyInput[];
  totalAmount: Prisma.Decimal;
}> {
  // 1) Load the PO's items + unit prices so we can validate ownership
  //    AND compute amounts in one round-trip.
  const poItems = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: poId },
    select: {
      id: true,
      qty: true,
      unitPrice: true,
      discountPercent: true,
      taxPercent: true,
    },
  });
  const poItemMap = new Map(poItems.map((p) => [p.id, p]));

  // 2) Sum qtyReceived per PO item across OTHER batches (non-cancelled,
  //    non-deleted, excluding this batch if updating).
  const otherReceiptsRaw = await tx.batchItem.groupBy({
    by: ['purchaseOrderItemId'],
    where: {
      purchaseOrderItem: { purchaseOrderId: poId },
      procurementBatch: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        ...(excludeBatchId && { id: { not: excludeBatchId } }),
      },
    },
    _sum: { qtyReceived: true },
  });
  const otherReceived = new Map<string, number>();
  for (const r of otherReceiptsRaw) {
    otherReceived.set(r.purchaseOrderItemId, r._sum.qtyReceived ?? 0);
  }

  // 3) Within-batch duplicate check — same PO item appearing twice in
  //    the input array would otherwise pass the unique constraint by
  //    accident only because createMany hasn't run yet.
  const seenInPayload = new Set<string>();
  for (const item of items) {
    if (seenInPayload.has(item.purchaseOrderItemId)) {
      throw new AppError(
        400,
        'DUPLICATE_BATCH_ITEM',
        `Item ${item.purchaseOrderItemId} appears more than once in this batch`,
      );
    }
    seenInPayload.add(item.purchaseOrderItemId);
  }

  // 4) Per-item validation + amount derivation.
  const rows: Prisma.BatchItemCreateManyInput[] = [];
  let runningTotal = new Prisma.Decimal(0);

  for (const item of items) {
    const poItem = poItemMap.get(item.purchaseOrderItemId);
    if (!poItem) {
      throw new AppError(
        404,
        'PO_ITEM_NOT_FOUND',
        `PO item ${item.purchaseOrderItemId} does not belong to this purchase order`,
      );
    }

    const alreadyReceived = otherReceived.get(item.purchaseOrderItemId) ?? 0;
    const remaining = poItem.qty - alreadyReceived;
    if (item.qtyReceived > remaining) {
      throw new AppError(
        400,
        'QTY_RECEIVED_EXCEEDS_REMAINING',
        `Cannot receive ${item.qtyReceived} units of item ${item.purchaseOrderItemId} — only ${remaining} unit(s) remain (ordered: ${poItem.qty}, already received in other batches: ${alreadyReceived})`,
      );
    }

    // Amount derivation: same formula as PO line totals, substituting
    // qty with qtyReceived. Skip zero-qty rows from the running total
    // (DRAFT batches commonly enter every PO line with 0 to start).
    if (item.qtyReceived > 0) {
      const amounts = computeItemAmounts({
        qty: item.qtyReceived,
        unitPrice: poItem.unitPrice,
        discountPercent: poItem.discountPercent,
        taxPercent: poItem.taxPercent,
      });
      runningTotal = runningTotal.add(amounts.totalAmount);
    }

    rows.push({
      id: randomUUID(),
      procurementBatchId: batchId,
      purchaseOrderItemId: item.purchaseOrderItemId,
      qtyReceived: item.qtyReceived,
      notes: item.notes ?? null,
    });
  }

  return {
    rows,
    totalAmount: runningTotal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createProcurementBatch(
  input: CreateProcurementBatchInput,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const po = await loadAcceptingPo(input.purchaseOrderId, tx);

    const batchNumber = await batchRepo.nextBatchNumber(tx);
    const batchId = randomUUID();

    // Validate + prepare items (when supplied). Empty items array is a
    // valid "blank DRAFT batch" — user will fill qtyReceived later.
    let itemRows: Prisma.BatchItemCreateManyInput[] = [];
    let totalAmount: Prisma.Decimal = new Prisma.Decimal(0);
    if (input.items && input.items.length > 0) {
      const prepared = await validateAndPrepareBatchItems(
        batchId,
        po.id,
        input.items,
        null,
        tx,
      );
      itemRows = prepared.rows;
      totalAmount = prepared.totalAmount;
    }

    const created = await batchRepo.create(
      {
        id: batchId,
        batchNumber,
        name: input.name ?? null,
        status: 'DRAFT',
        // Spec §3.3: purchaseDate + currency inherited from PO at create
        // time. Stored denormalised so future PO edits don't retroactively
        // rewrite history.
        purchaseDate: po.poDate,
        currency: po.currency,
        totalAmount,
        notes: input.notes ?? null,
        attachments: (input.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdBy: { connect: { id: userId } },
        purchaseOrder: { connect: { id: po.id } },
        ...(input.defaultLocationId && {
          defaultLocation: { connect: { id: input.defaultLocationId } },
        }),
        ...(input.defaultCategoryId && {
          defaultCategory: { connect: { id: input.defaultCategoryId } },
        }),
      },
      tx,
    );

    if (itemRows.length > 0) {
      await batchRepo.createItems(itemRows, tx);
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'ProcurementBatch',
        resourceId: created.id,
        newValues: {
          ...created,
          itemCount: itemRows.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await incrementBatchCount(po.id, tx);
    await recomputePurchaseOrderStatus(po.id, tx, userId);

    return created;
  });
}

// ── Update (metadata only — status changes go through dedicated endpoints) ─

export async function updateProcurementBatch(
  id: string,
  input: UpdateProcurementBatchInput,
  userId: string,
) {
  const existing = await batchRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }

  // COMPLETED / CANCELLED batches are locked. Notes + attachments are still
  // mutable — useful for post-hoc annotation — but every other field is
  // frozen. Implementation strategy: at the service layer we narrow the
  // patch to (notes, attachments) when status is locked.
  const isLocked = existing.status === 'COMPLETED' || existing.status === 'CANCELLED';
  if (isLocked) {
    const lockedKeys = Object.keys(input).filter(
      (k) => k !== 'notes' && k !== 'attachments',
    );
    if (lockedKeys.length > 0) {
      throw new AppError(
        409,
        'BATCH_LOCKED',
        `Cannot modify a ${existing.status.toLowerCase()} batch. Only notes and attachments are editable.`,
      );
    }
  }

  // Items replacement guard. Once the batch is RECEIVED, qtyReceived
  // values reflect what was physically received and can't be rewritten
  // retroactively. DRAFT and ITEMS_PENDING accept item edits freely.
  if (
    input.items !== undefined &&
    existing.status !== 'DRAFT' &&
    existing.status !== 'ITEMS_PENDING'
  ) {
    throw new AppError(
      409,
      'BATCH_ITEMS_LOCKED',
      `Cannot edit items on a ${existing.status.toLowerCase()} batch — items lock at RECEIVED`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Items replacement: validate + recompute total. We don't touch
    // items if the caller didn't pass them.
    let nextTotalAmount: Prisma.Decimal | undefined;
    if (input.items !== undefined) {
      const prepared = await validateAndPrepareBatchItems(
        id,
        existing.purchaseOrderId,
        input.items,
        id, // excludeBatchId — don't count THIS batch's old items
        tx,
      );
      await batchRepo.replaceItems(id, prepared.rows, tx);
      nextTotalAmount = prepared.totalAmount;
    }

    const updated = await batchRepo.update(
      id,
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.bastNumber !== undefined && { bastNumber: input.bastNumber }),
        ...(input.bastDate !== undefined && { bastDate: input.bastDate }),
        ...(input.bastUrl !== undefined && { bastUrl: input.bastUrl }),
        ...(input.invoiceNumber !== undefined && { invoiceNumber: input.invoiceNumber }),
        ...(input.invoiceDate !== undefined && { invoiceDate: input.invoiceDate }),
        ...(input.invoiceUrl !== undefined && { invoiceUrl: input.invoiceUrl }),
        ...(input.taxInvoiceNumber !== undefined && {
          taxInvoiceNumber: input.taxInvoiceNumber,
        }),
        ...(input.taxInvoiceDate !== undefined && { taxInvoiceDate: input.taxInvoiceDate }),
        ...(input.purchaseDate !== undefined && { purchaseDate: input.purchaseDate }),
        ...(input.receivedDate !== undefined && { receivedDate: input.receivedDate }),
        ...(input.currency !== undefined && { currency: input.currency }),
        // Phase 17 v2: totalAmount computed from BatchItems, never patched directly here.
        ...(input.defaultLocationId !== undefined && {
          defaultLocation: input.defaultLocationId
            ? { connect: { id: input.defaultLocationId } }
            : { disconnect: true },
        }),
        ...(input.defaultCategoryId !== undefined && {
          defaultCategory: input.defaultCategoryId
            ? { connect: { id: input.defaultCategoryId } }
            : { disconnect: true },
        }),
        ...(input.receivedByUserId !== undefined && {
          receivedBy: input.receivedByUserId
            ? { connect: { id: input.receivedByUserId } }
            : { disconnect: true },
        }),
        ...(input.receivedByName !== undefined && { receivedByName: input.receivedByName }),
        ...(input.receivedByPosition !== undefined && {
          receivedByPosition: input.receivedByPosition,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.attachments !== undefined && {
          attachments: (input.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        }),
        ...(input.customFields !== undefined && {
          customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        }),
        // Phase 17 v2: when items are replaced, totalAmount is set from
        // the recomputed value above. Otherwise it's untouched.
        ...(nextTotalAmount !== undefined && { totalAmount: nextTotalAmount }),
      },
      tx,
    );

    // When items changed AND the batch had already crossed RECEIVED
    // before this update (shouldn't happen — gated above), recompute
    // the parent PO so its FULLY_RECEIVED status reflects new receipts.
    // For DRAFT/ITEMS_PENDING the parent PO can't be in FULLY_RECEIVED
    // anyway, so this is defensive only.
    if (input.items !== undefined) {
      await recomputePurchaseOrderStatus(existing.purchaseOrderId, tx, userId);
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'ProcurementBatch',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
        newValues: updated as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

// ── Delete (soft) ───────────────────────────────────────────────────────────
//
// DRAFT with zero linked assets only. Once a batch reaches ITEMS_PENDING
// (assets exist) or beyond (BAST/receipt happened), it's a real
// procurement record and we don't physically delete it. Cancel it
// instead — that keeps the row visible in the audit trail.
export async function deleteProcurementBatch(id: string, userId: string) {
  const existing = await batchRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }

  if (existing.status !== 'DRAFT') {
    throw new AppError(
      409,
      'BATCH_NOT_DELETABLE',
      `Cannot delete a ${existing.status.toLowerCase()} batch. Cancel it instead.`,
    );
  }

  const liveAssetCount = await batchRepo.countAssets(id);
  if (liveAssetCount > 0) {
    throw new AppError(
      409,
      'BATCH_HAS_ASSETS',
      'Cannot delete a batch with linked assets. Remove the assets or cancel the batch first.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await batchRepo.softDelete(id, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'ProcurementBatch',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
      },
    });

    if (existing.purchaseOrderId) {
      await decrementBatchCount(existing.purchaseOrderId, tx);
      await recomputePurchaseOrderStatus(existing.purchaseOrderId, tx, userId);
    }
  });
}

// ── Transition: submit (DRAFT → ITEMS_PENDING) ──────────────────────────────
//
// Marks the header as "assets are now expected" — the bulk-import flow
// (Tier 4) will move the batch here automatically after successful row
// creation. Exposed as a standalone endpoint too so the UI can do a
// "submit empty" if needed.
export async function submitProcurementBatch(id: string, userId: string) {
  const existing = await batchRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }

  if (existing.status !== 'DRAFT') {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      `submit requires status=DRAFT, currently ${existing.status}`,
    );
  }

  // We don't require assetCount > 0 here. Empty submit moves the header
  // forward as a placeholder for "items are coming via the bulk path".
  // The bulk-import service will increment assetCount as it links assets.

  return prisma.$transaction(async (tx) => {
    const updated = await batchRepo.update(id, { status: 'ITEMS_PENDING' }, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'ProcurementBatch',
        resourceId: id,
        oldValues: { status: existing.status } as unknown as Prisma.InputJsonValue,
        newValues: { status: 'ITEMS_PENDING' } as unknown as Prisma.InputJsonValue,
      },
    });
    // No PO cascade — ITEMS_PENDING doesn't cross the RECEIVED threshold.
    return updated;
  });
}

// ── Transition: receive (ITEMS_PENDING → RECEIVED) ──────────────────────────
//
// BAST signed + items physically present. Requires the BAST document
// chain in the request body. Hybrid signatory rule enforced here:
// at least one of receivedByUserId / receivedByName must be set.
export async function receiveProcurementBatch(
  id: string,
  input: ReceiveProcurementBatchInput,
  userId: string,
) {
  const existing = await batchRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }

  if (existing.status !== 'ITEMS_PENDING') {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      `receive requires status=ITEMS_PENDING, currently ${existing.status}`,
    );
  }

  // Signatory: prefer the input's values; fall back to whatever was already
  // on the batch (set via metadata patch). The hybrid rule (≥1 of FK/name)
  // is evaluated against the merged result.
  const effectiveSignerUserId =
    input.receivedByUserId ?? existing.receivedByUserId;
  const effectiveSignerName = input.receivedByName ?? existing.receivedByName;
  if (!effectiveSignerUserId && !effectiveSignerName) {
    throw new AppError(
      400,
      'SIGNATORY_REQUIRED',
      'At least one of receivedByUserId or receivedByName must be provided to mark a batch as received',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await batchRepo.update(
      id,
      {
        status: 'RECEIVED',
        bastNumber: input.bastNumber,
        bastDate: input.bastDate,
        bastUrl: input.bastUrl ?? existing.bastUrl,
        receivedDate: input.receivedDate ?? input.bastDate,
        ...(input.receivedByUserId !== undefined && {
          receivedBy: input.receivedByUserId
            ? { connect: { id: input.receivedByUserId } }
            : { disconnect: true },
        }),
        ...(input.receivedByName !== undefined && { receivedByName: input.receivedByName }),
        ...(input.receivedByPosition !== undefined && {
          receivedByPosition: input.receivedByPosition,
        }),
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'APPROVE',
        resourceType: 'ProcurementBatch',
        resourceId: id,
        oldValues: { status: existing.status } as unknown as Prisma.InputJsonValue,
        newValues: {
          status: 'RECEIVED',
          bastNumber: updated.bastNumber,
          bastDate: updated.bastDate,
          receivedDate: updated.receivedDate,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (existing.purchaseOrderId) {
      await recomputePurchaseOrderStatus(existing.purchaseOrderId, tx, userId);
    }

    return updated;
  });
}

// ── Transition: complete (RECEIVED → COMPLETED) ─────────────────────────────
//
// Invoice + faktur pajak in. Batch becomes immutable (notes/attachments
// only, enforced by updateProcurementBatch).
export async function completeProcurementBatch(
  id: string,
  input: CompleteProcurementBatchInput,
  userId: string,
) {
  const existing = await batchRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }

  if (existing.status !== 'RECEIVED') {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      `complete requires status=RECEIVED, currently ${existing.status}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await batchRepo.update(
      id,
      {
        status: 'COMPLETED',
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        ...(input.invoiceUrl !== undefined && { invoiceUrl: input.invoiceUrl }),
        ...(input.taxInvoiceNumber !== undefined && {
          taxInvoiceNumber: input.taxInvoiceNumber,
        }),
        ...(input.taxInvoiceDate !== undefined && { taxInvoiceDate: input.taxInvoiceDate }),
        completedAt: new Date(),
        completedBy: { connect: { id: userId } },
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'APPROVE',
        resourceType: 'ProcurementBatch',
        resourceId: id,
        oldValues: { status: existing.status } as unknown as Prisma.InputJsonValue,
        newValues: {
          status: 'COMPLETED',
          invoiceNumber: updated.invoiceNumber,
          invoiceDate: updated.invoiceDate,
          completedAt: updated.completedAt,
          completedByUserId: userId,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // RECEIVED → COMPLETED stays inside the "received family" for the PO
    // cascade rule, so the parent PO's status is unchanged. We skip the
    // recompute call to avoid a no-op write.
    return updated;
  });
}

// ── Transition: cancel (DRAFT or ITEMS_PENDING → CANCELLED) ─────────────────

export async function cancelProcurementBatch(
  id: string,
  input: CancelProcurementBatchInput,
  userId: string,
) {
  const existing = await batchRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PROCUREMENT_BATCH_NOT_FOUND', 'Procurement batch not found');
  }

  if (existing.status !== 'DRAFT' && existing.status !== 'ITEMS_PENDING') {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      `cancel requires status=DRAFT or ITEMS_PENDING, currently ${existing.status}`,
    );
  }

  // Cancelling ITEMS_PENDING with linked assets would orphan those assets.
  // Force user to remove assets first (or proceed through receive). This is
  // the same trade-off we made for delete — keep things explicit.
  const liveAssetCount = await batchRepo.countAssets(id);
  if (liveAssetCount > 0) {
    throw new AppError(
      409,
      'BATCH_HAS_ASSETS',
      'Cannot cancel a batch with linked assets. Remove the assets first or proceed through the receive flow.',
    );
  }

  const cancelStamp = `[Cancelled ${new Date().toISOString()}] ${input.reason}`;
  const nextNotes = existing.notes ? `${existing.notes}\n\n${cancelStamp}` : cancelStamp;

  return prisma.$transaction(async (tx) => {
    const updated = await batchRepo.update(
      id,
      { status: 'CANCELLED', notes: nextNotes },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'REJECT',
        resourceType: 'ProcurementBatch',
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

    if (existing.purchaseOrderId) {
      // Cancelling a batch removes it from the PO's status calculation
      // (the recompute filters out CANCELLED batches). The parent's
      // batchCount stays — counts include cancelled batches for the
      // history-friendly view ("PO had 3 batches, 1 cancelled").
      await recomputePurchaseOrderStatus(existing.purchaseOrderId, tx, userId);
    }

    return updated;
  });
}
