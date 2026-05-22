import type { prisma } from '../../lib/prisma.js';

export type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface VendorListFilters {
  search?: string;
  /** When undefined: returns both active + inactive. Explicit false
   *  returns only archived vendors. */
  isActive?: boolean;
}
