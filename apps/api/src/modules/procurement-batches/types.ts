import type { ProcurementBatchStatus } from '@prisma/client';
import type { prisma } from '../../lib/prisma.js';

// Tx-client subset exposed inside $transaction callbacks. Same shape
// the locations / assets / purchase-orders repos use so service code
// can stitch a write + the matching audit log into one boundary.
export type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface ProcurementBatchListFilters {
  status?: ProcurementBatchStatus;
  /** Filter to a single parent PO. */
  purchaseOrderId?: string;
  vendor?: string;
  bastNumber?: string;
  invoiceNumber?: string;
  /** Free-text search across batch_number, name, bast_number, invoice_number. */
  search?: string;
  /** ISO date string. Inclusive lower bound on purchase_date. */
  purchaseDateFrom?: string;
  /** ISO date string. Inclusive upper bound on purchase_date. */
  purchaseDateTo?: string;
}
