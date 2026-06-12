import { z } from 'zod';

export const createAssetSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(255),
  serialNumber: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'IDLE', 'IN_MAINTENANCE', 'DISPOSED', 'LOST', 'BORROWED']).default('ACTIVE'),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).default('NEW'),
  locationId: z.string().uuid(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().default('IDR'),
  // Phase 17 v2 — vendorId is the preferred path (FK to Vendor table).
  // `vendor` (legacy free-text) is still accepted for backwards
  // compatibility with older clients but new flows should use vendorId.
  vendorId: z.string().uuid().nullable().optional(),
  vendor: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceUrl: z.string().nullable().optional(),
  warrantyStartDate: z.coerce.date().nullable().optional(),
  warrantyEndDate: z.coerce.date().nullable().optional(),
  usefulLifeMonths: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
  // Optional FK to a procurement batch (Phase 17). When set, the asset
  // is linked to the batch and the batch + parent-PO assetCount counters
  // bump atomically inside the same transaction that creates the row.
  // The batch must exist and be in DRAFT or ITEMS_PENDING (RECEIVED+ /
  // COMPLETED / CANCELLED are rejected by the service).
  procurementBatchId: z.string().uuid().nullable().optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  serialNumber: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'IDLE', 'IN_MAINTENANCE', 'DISPOSED', 'LOST', 'BORROWED']).optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
  locationId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  vendor: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceUrl: z.string().nullable().optional(),
  warrantyStartDate: z.coerce.date().nullable().optional(),
  warrantyEndDate: z.coerce.date().nullable().optional(),
  usefulLifeMonths: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
});

export const bulkCreateAssetSchema = z.object({
  assets: z.array(createAssetSchema).min(1).max(100),
});

// ── Bulk action schemas ──────────────────────────────────────────────
// All bulk action endpoints share the same ID-array shape. Capped at 200
// per request — past that the user is better served by a saved filter +
// "Apply to all matching" workflow we haven't built yet.
const bulkAssetIdsSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(200),
});

export const bulkMoveLocationSchema = bulkAssetIdsSchema.extend({
  toLocationId: z.string().uuid(),
});

export const bulkAssignUserSchema = bulkAssetIdsSchema.extend({
  // null = unassignment (system handles UNASSIGNMENT movements)
  toUserId: z.string().uuid().nullable(),
});

export const bulkChangeConditionSchema = bulkAssetIdsSchema.extend({
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']),
});

export const bulkDeleteSchema = bulkAssetIdsSchema;

export const assetListFilterSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'IDLE', 'IN_MAINTENANCE', 'DISPOSED', 'LOST', 'BORROWED']).optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
  categoryId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  // Filter by product — shows all assets of a specific product entry.
  productId: z.string().uuid().optional(),
  // Phase 17 — drill-down from batch detail page to its asset roster.
  procurementBatchId: z.string().uuid().optional(),
  // Phase 17 v2 — drill-down from a PO to every asset created under
  // ANY of its batches. Backend translates to:
  //   procurementBatch: { purchaseOrderId: <id> }
  purchaseOrderId: z.string().uuid().optional(),
  purchaseDateFrom: z.coerce.date().optional(),
  purchaseDateTo: z.coerce.date().optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type BulkCreateAssetInput = z.infer<typeof bulkCreateAssetSchema>;
export type AssetListFilterInput = z.infer<typeof assetListFilterSchema>;
