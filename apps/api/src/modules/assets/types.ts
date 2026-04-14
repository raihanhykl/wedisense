import type { Prisma, PrismaClient } from '@prisma/client';

/** Transaction client type for use inside $transaction callbacks */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Allowed sort fields for asset list */
export type AssetSortField = 'assetNumber' | 'name' | 'status' | 'purchaseDate' | 'createdAt';

/** Filters for asset list query */
export interface AssetListFilters {
  search?: string;
  status?: string;
  condition?: string;
  categoryId?: string;
  locationId?: string;
  assignedToUserId?: string;
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
