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

// ── PO Line Items (Phase 17 v2) ──────────────────────────────────────────────
//
// Spec §2.6 / §2.7: a PO carries one or more product line items. Per-row:
//   - product (required FK)
//   - qty, unit price, discount %, tax %
//   - free-text notes
// Computed amounts (untaxed/tax/total) are NEVER sent from the client —
// the service recomputes them from inputs so the source of truth stays
// in one place.
const purchaseOrderItemInputSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().positive('qty must be a positive integer'),
  unitPrice: z
    .number()
    .nonnegative('unitPrice must be non-negative'),
  // Default 0 matches spec's "default 0.00%". Capped at 100 because a
  // discount > 100% (negative price) doesn't make sense for procurement.
  discountPercent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .default(0),
  // Tax also a percent. Capped at 100; PPN in ID is 11%, so this is a
  // safety upper bound, not a typical value.
  taxPercent: z.number().min(0).max(100).optional().default(0),
  // Optional explicit sort. When omitted, service assigns based on
  // array index (0, 10, 20…) so reordering doesn't require renumbering.
  sortOrder: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// Items array — spec §2.6 supports multiple products per PO. Cap at 200
// to keep the create transaction bounded.
const purchaseOrderItemsSchema = z
  .array(purchaseOrderItemInputSchema)
  .min(1, 'At least one item is required')
  .max(200, 'A single PO may not have more than 200 items');

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
  .object({ ...sharedFields, items: purchaseOrderItemsSchema })
  .refine(
    (v) => !v.expectedDeliveryDate || v.expectedDeliveryDate >= v.poDate,
    {
      message: 'expectedDeliveryDate must be on or after poDate',
      path: ['expectedDeliveryDate'],
    },
  );

// Update: every field optional. Items is also optional — when supplied,
// it REPLACES the existing item set atomically (simpler than diffing).
// Service-layer enforces that items can only be replaced while the PO
// is still in OPEN status (no batches attached yet) — once a batch
// references a PO item, mutating the item set would break batch_items
// FKs in confusing ways.
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
    items: purchaseOrderItemsSchema.optional(),
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
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemInputSchema>;
