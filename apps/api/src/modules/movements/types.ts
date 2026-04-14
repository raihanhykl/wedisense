import type { PrismaClient } from '@prisma/client';

/** Transaction client type for use inside $transaction callbacks */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Filters for movement list query */
export interface MovementListFilters {
  assetId?: string;
  movementType?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  performedByUserId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}
