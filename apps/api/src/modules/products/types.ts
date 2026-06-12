import type { PrismaClient } from '@prisma/client';

/** Transaction client type for use inside $transaction callbacks */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface EanLookupResult {
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  imageUrl: string | null;
  source: 'API_UPCITEMDB' | 'API_BARCODELOOKUP' | 'MANUAL';
  rawApiResponse: Record<string, unknown> | null;
}

export type ProductSortField = 'name' | 'brand' | 'createdAt' | 'assetCount';
