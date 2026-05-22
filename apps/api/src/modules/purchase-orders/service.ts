import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { PurchaseOrderStatus } from '@prisma/client';
import * as poRepo from './repository.js';
import type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  CancelPurchaseOrderInput,
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
  return po;
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  userId: string,
) {
  // Generate the SP number, persist the row, and write the audit log in a
  // single $transaction. The sequence bump must roll back with a failed
  // create — otherwise an aborted import leaves a "burned" PO number.
  return prisma.$transaction(async (tx) => {
    const poNumber = await poRepo.nextPurchaseOrderNumber(tx);

    const created = await poRepo.create(
      {
        poNumber,
        name: input.name ?? null,
        description: input.description ?? null,
        status: 'OPEN',
        // Phase 17 v2: vendor FK + computed totals (default 0, set
        // properly when items are persisted in Tier 7.3).
        vendor: { connect: { id: input.vendorId } },
        poDate: input.poDate,
        expectedDeliveryDate: input.expectedDeliveryDate ?? null,
        poUrl: input.poUrl ?? null,
        currency: input.currency ?? 'IDR',
        untaxedAmount: 0,
        totalTaxes: 0,
        totalAmount: 0,
        notes: input.notes ?? null,
        attachments: (input.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdBy: { connect: { id: userId } },
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'PurchaseOrder',
        resourceId: created.id,
        newValues: created as unknown as Prisma.InputJsonValue,
      },
    });

    return created;
  });
}

// ── Update (metadata only — status changes go through dedicated endpoints) ─

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

  return prisma.$transaction(async (tx) => {
    const updated = await poRepo.update(
      id,
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        // Phase 17 v2: vendor swaps via relation re-connect; totals are
        // computed (not patched directly).
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
        newValues: updated as unknown as Prisma.InputJsonValue,
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
//   no batches                       → OPEN
//   any batch in RECEIVED+COMPLETED  → at least PARTIALLY_RECEIVED
//   every batch in RECEIVED+COMPLETED → FULLY_RECEIVED
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
    const allReceived = batches.every((b) => isReceived(b.status));
    const anyReceived = batches.some((b) => isReceived(b.status));
    if (allReceived) nextStatus = 'FULLY_RECEIVED';
    else if (anyReceived) nextStatus = 'PARTIALLY_RECEIVED';
    else nextStatus = 'OPEN';
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

