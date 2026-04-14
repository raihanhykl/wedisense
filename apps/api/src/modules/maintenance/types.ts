import type { PrismaClient } from '@prisma/client';

/** Transaction client type for use inside $transaction callbacks */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Filters for schedule list query */
export interface ScheduleListFilters {
  assetId?: string;
  frequencyType?: string;
  isActive?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
}

/** Filters for log list query */
export interface LogListFilters {
  assetId?: string;
  scheduleId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sort?: string;
  order?: 'asc' | 'desc';
}
