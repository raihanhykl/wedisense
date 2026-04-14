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
  vendor: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceUrl: z.string().nullable().optional(),
  warrantyStartDate: z.coerce.date().nullable().optional(),
  warrantyEndDate: z.coerce.date().nullable().optional(),
  usefulLifeMonths: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
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

export const assetListFilterSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'IDLE', 'IN_MAINTENANCE', 'DISPOSED', 'LOST', 'BORROWED']).optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
  categoryId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  purchaseDateFrom: z.coerce.date().optional(),
  purchaseDateTo: z.coerce.date().optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type BulkCreateAssetInput = z.infer<typeof bulkCreateAssetSchema>;
export type AssetListFilterInput = z.infer<typeof assetListFilterSchema>;
