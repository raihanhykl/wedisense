import { z } from 'zod';

// ── Create order (SPK header + initial units) ────────────────────────────────

export const createOrderSchema = z.object({
  showroomId: z.string().uuid('showroomId must be a valid UUID'),
  spkNumber: z
    .string()
    .min(1, 'spkNumber is required')
    .max(100)
    .transform((s) => s.trim().replace(/\s+/g, ' ').toUpperCase()),
  salesUserId: z.string().uuid('salesUserId must be a valid UUID'),
  customerName: z.string().min(1, 'customerName is required').max(255),
  customerPhone: z.string().max(50).optional(),
  customerIdNumber: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  unitIds: z
    .array(z.string().uuid('each unitId must be a valid UUID'))
    .min(1, 'at least one unitId is required')
    .max(20, 'at most 20 units per order')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'unitIds must be unique',
    }),
});

// ── Add lines to existing order ──────────────────────────────────────────────

export const addLinesToOrderSchema = z.object({
  unitIds: z
    .array(z.string().uuid('each unitId must be a valid UUID'))
    .min(1, 'at least one unitId is required')
    .max(20, 'at most 20 units per request')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'unitIds must be unique',
    }),
});

// ── Cancel a line ────────────────────────────────────────────────────────────

export const cancelLineSchema = z.object({
  reason: z
    .string()
    .min(3, 'reason must be at least 3 characters')
    .max(500, 'reason must be at most 500 characters'),
});

// ── Follow-up ────────────────────────────────────────────────────────────────

export const followUpSchema = z.object({
  nextFollowUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'nextFollowUpDate must be YYYY-MM-DD'),
  note: z.string().max(2000).optional(),
});

// ── Record sale ──────────────────────────────────────────────────────────────

export const recordSaleSchema = z.object({
  lineIds: z
    .array(z.string().uuid('each lineId must be a valid UUID'))
    .min(1, 'at least one lineId is required')
    .max(20, 'at most 20 lines per request')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'lineIds must be unique',
    }),
  soldAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'soldAt must be YYYY-MM-DD')
    .optional(),
});

// ── Confirm pickup ───────────────────────────────────────────────────────────

export const confirmPickupSchema = z.object({
  receiverName: z.string().min(1, 'receiverName is required').max(255),
  handoverReference: z.string().max(100).optional(),
  /** ISO 8601 datetime of the handover. Defaults to now; never in the future. */
  pickedUpAt: z
    .string()
    .datetime({ offset: true, message: 'pickedUpAt must be an ISO 8601 datetime' })
    .optional(),
  vinConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'vinConfirmed must be true — the VIN on the frame must be matched' }),
  }),
});

// ── List orders query ────────────────────────────────────────────────────────

export const listOrdersQuerySchema = z.object({
  showroomId: z.string().uuid().optional(),
  status: z.enum(['open', 'all']).default('open'),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type AddLinesToOrderInput = z.infer<typeof addLinesToOrderSchema>;
export type CancelLineInput = z.infer<typeof cancelLineSchema>;
export type FollowUpInput = z.infer<typeof followUpSchema>;
export type RecordSaleInput = z.infer<typeof recordSaleSchema>;
export type ConfirmPickupInput = z.infer<typeof confirmPickupSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
