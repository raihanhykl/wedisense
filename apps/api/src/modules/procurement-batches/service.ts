import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import * as batchRepo from './repository.js';
import {
  recomputePurchaseOrderStatus,
  incrementBatchCount,
  decrementBatchCount,
} from '../purchase-orders/service.js';
import type {
  CreateProcurementBatchInput,
  UpdateProcurementBatchInput,
  ReceiveProcurementBatchInput,
  CompleteProcurementBatchInput,
  CancelProcurementBatchInput,
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

// ── Create ──────────────────────────────────────────────────────────────────

export async function createProcurementBatch(
  input: CreateProcurementBatchInput,
  userId: string,
) {
  // If a parent PO is referenced, validate it exists, isn't deleted, and is
  // in a status that accepts new batches. CLOSED / CANCELLED PO reject;
  // FULLY_RECEIVED accepts and demotes itself via the cascade below.
  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, deletedAt: null },
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
  }

  return prisma.$transaction(async (tx) => {
    const batchNumber = await batchRepo.nextBatchNumber(tx);

    const created = await batchRepo.create(
      {
        batchNumber,
        name: input.name ?? null,
        status: 'DRAFT',
        purchaseDate: input.purchaseDate,
        currency: input.currency ?? 'IDR',
        totalAmount: input.totalAmount ?? null,
        notes: input.notes ?? null,
        attachments: (input.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdBy: { connect: { id: userId } },
        ...(input.purchaseOrderId && {
          purchaseOrder: { connect: { id: input.purchaseOrderId } },
        }),
        ...(input.defaultLocationId && {
          defaultLocation: { connect: { id: input.defaultLocationId } },
        }),
        ...(input.defaultCategoryId && {
          defaultCategory: { connect: { id: input.defaultCategoryId } },
        }),
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'ProcurementBatch',
        resourceId: created.id,
        newValues: created as unknown as Prisma.InputJsonValue,
      },
    });

    if (input.purchaseOrderId) {
      await incrementBatchCount(input.purchaseOrderId, tx);
      await recomputePurchaseOrderStatus(input.purchaseOrderId, tx, userId);
    }

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

  return prisma.$transaction(async (tx) => {
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
        ...(input.totalAmount !== undefined && { totalAmount: input.totalAmount }),
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
      },
      tx,
    );

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
        ...(input.totalAmount !== undefined && { totalAmount: input.totalAmount }),
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
