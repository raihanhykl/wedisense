import { z } from 'zod';

const purchaseOrderStatusEnum = z.enum([
  'OPEN',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'CLOSED',
  'CANCELLED',
]);

// Currency: 3-letter ISO 4217. Defaults to IDR at the DB level; this just
// guards malformed input at the API boundary.
const currencySchema = z.string().length(3).toUpperCase();

// Attachments: free-form JSONB. We keep it loose because the shape varies
// per attachment (PDF / image / signed BAST), but the array bound protects
// against accidental unbounded uploads.
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

// Shared field set used by both create and update. Date inputs accept
// ISO strings (z.coerce.date) and serialise back as Date for Prisma.
const sharedFields = {
  name: z.string().min(1).max(255).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  // Phase 17 v2: vendor is a FK; vendorContact moved into Vendor entity.
  vendorId: z.string().uuid(),
  poDate: z.coerce.date(),
  expectedDeliveryDate: z.coerce.date().nullable().optional(),
  poUrl: z.string().url().max(2048).nullable().optional(),
  currency: currencySchema.optional(),
  // Phase 17 v2: PO totals are computed from line items in the service.
  // We no longer accept totalAmount from the API. Items array will land
  // in Tier 7.3 — for now the create call goes through with no items
  // and totals default to 0 (computed but empty).
  notes: z.string().max(2000).nullable().optional(),
  attachments: attachmentsSchema.nullable().optional(),
  customFields: customFieldsSchema.nullable().optional(),
};

export const createPurchaseOrderSchema = z
  .object(sharedFields)
  .refine(
    (v) => !v.expectedDeliveryDate || v.expectedDeliveryDate >= v.poDate,
    {
      message: 'expectedDeliveryDate must be on or after poDate',
      path: ['expectedDeliveryDate'],
    },
  );

// Update: every field optional. The poDate vs expectedDeliveryDate cross-
// check is harder here (we only see partial input) so we only enforce it
// when BOTH fields are present in the patch — the service layer can do
// the existing-vs-patch comparison if we ever need stricter checks.
export const updatePurchaseOrderSchema = z
  .object({
    name: sharedFields.name,
    description: sharedFields.description,
    vendorId: sharedFields.vendorId.optional(),
    poDate: sharedFields.poDate.optional(),
    expectedDeliveryDate: sharedFields.expectedDeliveryDate,
    poUrl: sharedFields.poUrl,
    currency: sharedFields.currency,
    notes: sharedFields.notes,
    attachments: sharedFields.attachments,
    customFields: sharedFields.customFields,
  })
  .refine(
    (v) =>
      !(v.poDate && v.expectedDeliveryDate) ||
      v.expectedDeliveryDate >= v.poDate,
    {
      message: 'expectedDeliveryDate must be on or after poDate',
      path: ['expectedDeliveryDate'],
    },
  );

export const listPurchaseOrderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: purchaseOrderStatusEnum.optional(),
  vendor: z.string().max(255).optional(),
  search: z.string().max(255).optional(),
  poDateFrom: z.string().datetime().optional(),
  poDateTo: z.string().datetime().optional(),
});

// Cancellation requires a reason (audit trail and downstream UI). The
// reason is appended to PO.notes by the service so a future reader sees
// it without diffing the audit log.
export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().min(5).max(500),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type ListPurchaseOrderQuery = z.infer<typeof listPurchaseOrderQuerySchema>;
export type CancelPurchaseOrderInput = z.infer<typeof cancelPurchaseOrderSchema>;
