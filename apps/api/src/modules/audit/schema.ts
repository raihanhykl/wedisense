import { z } from 'zod';

/**
 * Valid AuditAction values mirror the Prisma enum. We restate them here
 * rather than importing from @prisma/client because Zod's z.nativeEnum has
 * trickier inference behaviour than a literal union — and the explicit
 * list doubles as documentation right at the filter-validation boundary.
 */
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
  'IMPORT',
  'PRINT',
  'APPROVE',
  'REJECT',
] as const;

const auditActionSchema = z.enum(AUDIT_ACTIONS);

// Coerce + validate date strings (the frontend sends ISO strings). z.coerce
// is intentional — without it z.date() rejects strings, which would force
// a manual transform on every filter param.
const dateFilterSchema = z.coerce.date().optional();

/**
 * Shared filter shape for both list + CSV export. Both endpoints use the
 * same WHERE clause so re-using one schema keeps them in lockstep.
 *
 * Bounds on `search` length protect against a client sending a 10 KB string
 * that would translate into a slow ILIKE scan. resourceType is left
 * unbounded enum-wise because new resource types appear with every module;
 * tighten only if it becomes a vector for cardinality explosions in the UI.
 */
export const auditLogFilterSchema = z.object({
  userId: z.string().uuid().optional(),
  action: auditActionSchema.optional(),
  resourceType: z.string().min(1).max(50).optional(),
  resourceId: z.string().min(1).max(100).optional(),
  dateFrom: dateFilterSchema,
  dateTo: dateFilterSchema,
  search: z.string().min(1).max(200).optional(),
});

export type AuditLogFilter = z.infer<typeof auditLogFilterSchema>;

/** Pagination params — added separately so the export endpoint can re-use
 *  the filter without inheriting page/limit. */
export const auditLogListQuerySchema = auditLogFilterSchema.extend({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
