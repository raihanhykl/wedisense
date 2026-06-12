import type { Prisma, PrismaClient } from '@prisma/client';

/** Transaction client type for use inside $transaction callbacks */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Allowed sort fields for asset list */
export type AssetSortField =
  | 'assetNumber'
  | 'name'
  | 'status'
  | 'purchaseDate'
  | 'purchasePrice'
  | 'createdAt'
  | 'assignedTo'
  | 'product';

/** Filters for asset list query */
export interface AssetListFilters {
  search?: string;
  status?: string;
  condition?: string;
  categoryId?: string;
  locationId?: string;
  assignedToUserId?: string;
  /** Filter assets to a single product entry. */
  productId?: string;
  /** Phase 17: filter by procurement batch. The frontend uses this to
   *  power the "see all assets in batch" link on the batch detail page. */
  procurementBatchId?: string;
  /** Phase 17 v2: filter by parent PO. Translates server-side to
   *  `procurementBatch.purchaseOrderId = X`, returning every asset
   *  created under any non-cancelled batch of that PO. */
  purchaseOrderId?: string;
  purchaseDateFrom?: Date;
  purchaseDateTo?: Date;
  sort?: string;
  order?: 'asc' | 'desc';
}

/** Input for bulk create - single item */
export interface BulkAssetItem {
  productId: string;
  name: string;
  serialNumber?: string | null;
  status?: string;
  condition?: string;
  locationId: string;
  assignedToUserId?: string | null;
  purchaseDate?: Date | null;
  purchasePrice?: number | null;
  currency?: string;
  vendor?: string | null;
  invoiceNumber?: string | null;
  warrantyStartDate?: Date | null;
  warrantyEndDate?: Date | null;
  usefulLifeMonths?: number | null;
  notes?: string | null;
  customFields?: Prisma.InputJsonValue | null;
}
