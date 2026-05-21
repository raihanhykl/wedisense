import { z } from 'zod';

const procurementBatchStatusEnum = z.enum([
  'DRAFT',
  'ITEMS_PENDING',
  'RECEIVED',
  'COMPLETED',
  'CANCELLED',
]);

const currencySchema = z.string().length(3).toUpperCase();

const attachmentsSchema = z
  .array(
    z.object({
      filename: z.string().min(1).max(255),
      url: z.string().url().max(2048),
      contentType: z.string().max(255).optional(),
      uploadedAt: z.string().datetime().optional(),
    }),
  )
  .max(50);

const customFieldsSchema = z.record(z.unknown());

// ── Create ──────────────────────────────────────────────────────────────────

export const createProcurementBatchSchema = z.object({
  // Optional parent PO. Null means direct-purchase batch (no formal PO).
  purchaseOrderId: z.string().uuid().nullable().optional(),

  name: z.string().min(1).max(255).nullable().optional(),

  // Inherited from PO at create time when purchaseOrderId is set, but
  // override-able if the batch represents a different commercial moment
  // (e.g. items priced as of a different date).
  purchaseDate: z.coerce.date(),
  currency: currencySchema.optional(),
  totalAmount: z.number().nonnegative().nullable().optional(),

  // Defaults applied to assets at import time. Each asset may override.
  defaultLocationId: z.string().uuid().nullable().optional(),
  defaultCategoryId: z.string().uuid().nullable().optional(),

  notes: z.string().max(2000).nullable().optional(),
  attachments: attachmentsSchema.nullable().optional(),
  customFields: customFieldsSchema.nullable().optional(),
});

// ── Update (metadata only — status changes go through dedicated endpoints) ─

export const updateProcurementBatchSchema = z.object({
  name: z.string().min(1).max(255).nullable().optional(),

  // BAST / invoice / faktur pajak fields are individually editable at the
  // metadata layer too (e.g. correcting a typo), even after RECEIVED.
  // COMPLETED batches are locked at the service layer; this Zod allows the
  // shape but the service throws BATCH_LOCKED if status === COMPLETED.
  bastNumber: z.string().max(255).nullable().optional(),
  bastDate: z.coerce.date().nullable().optional(),
  bastUrl: z.string().url().max(2048).nullable().optional(),

  invoiceNumber: z.string().max(255).nullable().optional(),
  invoiceDate: z.coerce.date().nullable().optional(),
  invoiceUrl: z.string().url().max(2048).nullable().optional(),

  taxInvoiceNumber: z.string().max(255).nullable().optional(),
  taxInvoiceDate: z.coerce.date().nullable().optional(),

  purchaseDate: z.coerce.date().optional(),
  receivedDate: z.coerce.date().nullable().optional(),

  currency: currencySchema.optional(),
  totalAmount: z.number().nonnegative().nullable().optional(),

  defaultLocationId: z.string().uuid().nullable().optional(),
  defaultCategoryId: z.string().uuid().nullable().optional(),

  // Signatory metadata can be patched independently of /receive. Useful for
  // post-receive corrections (e.g. correct signer name typo).
  receivedByUserId: z.string().uuid().nullable().optional(),
  receivedByName: z.string().max(255).nullable().optional(),
  receivedByPosition: z.string().max(255).nullable().optional(),

  notes: z.string().max(2000).nullable().optional(),
  attachments: attachmentsSchema.nullable().optional(),
  customFields: customFieldsSchema.nullable().optional(),
});

// ── List ────────────────────────────────────────────────────────────────────

export const listProcurementBatchQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: procurementBatchStatusEnum.optional(),
  purchaseOrderId: z.string().uuid().optional(),
  vendor: z.string().max(255).optional(),
  bastNumber: z.string().max(255).optional(),
  invoiceNumber: z.string().max(255).optional(),
  search: z.string().max(255).optional(),
  purchaseDateFrom: z.string().datetime().optional(),
  purchaseDateTo: z.string().datetime().optional(),
});

// ── Receive (ITEMS_PENDING → RECEIVED) ──────────────────────────────────────
//
// BAST document chain plus signatory. The hybrid signatory rule is enforced
// in the service layer (at least one of receivedByUserId / receivedByName
// must be set) so the error message can be specific.
export const receiveProcurementBatchSchema = z.object({
  bastNumber: z.string().min(1).max(255),
  bastDate: z.coerce.date(),
  bastUrl: z.string().url().max(2048).nullable().optional(),
  receivedDate: z.coerce.date().optional(),
  receivedByUserId: z.string().uuid().nullable().optional(),
  receivedByName: z.string().max(255).nullable().optional(),
  receivedByPosition: z.string().max(255).nullable().optional(),
});

// ── Complete (RECEIVED → COMPLETED) ─────────────────────────────────────────

export const completeProcurementBatchSchema = z.object({
  invoiceNumber: z.string().min(1).max(255),
  invoiceDate: z.coerce.date(),
  invoiceUrl: z.string().url().max(2048).nullable().optional(),
  taxInvoiceNumber: z.string().max(255).nullable().optional(),
  taxInvoiceDate: z.coerce.date().nullable().optional(),
  // Optional override of the batch's total amount as recorded on the
  // supplier invoice. If omitted, batch.totalAmount stays as-is.
  totalAmount: z.number().nonnegative().nullable().optional(),
});

// ── Cancel (DRAFT or ITEMS_PENDING → CANCELLED) ─────────────────────────────

export const cancelProcurementBatchSchema = z.object({
  reason: z.string().min(5).max(500),
});

export type CreateProcurementBatchInput = z.infer<typeof createProcurementBatchSchema>;
export type UpdateProcurementBatchInput = z.infer<typeof updateProcurementBatchSchema>;
export type ListProcurementBatchQuery = z.infer<typeof listProcurementBatchQuerySchema>;
export type ReceiveProcurementBatchInput = z.infer<typeof receiveProcurementBatchSchema>;
export type CompleteProcurementBatchInput = z.infer<typeof completeProcurementBatchSchema>;
export type CancelProcurementBatchInput = z.infer<typeof cancelProcurementBatchSchema>;
