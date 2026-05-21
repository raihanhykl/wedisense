import type { PurchaseOrderStatus } from '@prisma/client';
import type { prisma } from '../../lib/prisma.js';

// Tx-client subset exposed inside $transaction callbacks. Matches the
// shape locations/assets repos use so service code can stitch a write +
// the matching audit log into the same boundary.
export type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface PurchaseOrderListFilters {
  status?: PurchaseOrderStatus;
  vendor?: string;
  /** Free-text search across po_number, name, vendor. */
  search?: string;
  /** ISO date string. Inclusive lower bound on po_date. */
  poDateFrom?: string;
  /** ISO date string. Inclusive upper bound on po_date. */
  poDateTo?: string;
}
