import { z } from 'zod';

// ── Helper ───────────────────────────────────────────────────────────────────

/** An ISO 8601 datetime (with offset) that is never in the future. */
const pastOrNowDatetime = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO 8601 datetime with offset' });

const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

// ── POST /api/sms/rto-contracts — hand over as RTO ───────────────────────────

export const createRtoContractSchema = z.object({
  unitId: z.string().uuid('unitId must be a valid UUID'),
  /**
   * Typed by the admin from the contract document.
   * Trimmed, whitespace collapsed, uppercased before storage.
   */
  contractNumber: z
    .string()
    .min(1, 'contractNumber is required')
    .max(100)
    .transform((s) => s.trim().replace(/\s+/g, ' ').toUpperCase()),
  salesUserId: z.string().uuid('salesUserId must be a valid UUID'),
  customerName: z.string().min(1).max(255).optional(),
  customerPhone: z.string().max(50).optional(),
  customerIdNumber: z.string().max(100).optional(),
  /** YYYY-MM-DD; not in the future. */
  startDate: businessDate,
  /** ISO datetime; default now; may be past; never future. */
  handoverAt: pastOrNowDatetime.optional(),
  notes: z.string().max(2000).optional(),
});

// ── PUT /api/sms/rto-contracts/:id/return ────────────────────────────────────

export const rtoReturnSchema = z.object({
  returnKind: z.enum(['RETURNED_BY_CUSTOMER', 'REPOSSESSED']),
  /** ISO datetime; default now; may be past; never future. */
  returnedAt: pastOrNowDatetime.optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']),
  odometer: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});

// ── PUT /api/sms/rto-contracts/:id/close ─────────────────────────────────────

export const closeRtoContractSchema = z.object({
  /** YYYY-MM-DD; default today. */
  closedOn: businessDate.optional(),
  legalReference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

// ── PUT /api/sms/rto-contracts/:id/ownership-transfer ────────────────────────

export const ownershipTransferSchema = z.object({
  /** YYYY-MM-DD; default today. */
  transferredOn: businessDate.optional(),
  legalReference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

// ── GET /api/sms/rto-contracts ───────────────────────────────────────────────

export const listRtoContractsQuerySchema = z.object({
  showroomId: z.string().uuid().optional(),
  status: z.enum(['active', 'returned_open', 'closed', 'all']).default('all'),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateRtoContractInput = z.infer<typeof createRtoContractSchema>;
export type RtoReturnInput = z.infer<typeof rtoReturnSchema>;
export type CloseRtoContractInput = z.infer<typeof closeRtoContractSchema>;
export type OwnershipTransferInput = z.infer<typeof ownershipTransferSchema>;
export type ListRtoContractsQuery = z.infer<typeof listRtoContractsQuerySchema>;
