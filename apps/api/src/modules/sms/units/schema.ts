import { z } from 'zod';

// ── List query ───────────────────────────────────────────────────────────────

export const unitViewSchema = z.enum([
  'physical',
  'ready',
  'booked',
  'sold_pending_pickup',
  'inspection',
  'custody',
  'identity_mismatch',
  'outside',
  'all',
]);

export const listUnitsQuerySchema = z.object({
  showroomId: z.string().uuid('showroomId must be a valid UUID'),
  view: unitViewSchema.default('physical'),
  modelId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  sortBy: z.enum(['vin', 'status', 'receivedAt', 'updatedAt']).default('vin'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// ── Search query ─────────────────────────────────────────────────────────────

export const searchUnitsQuerySchema = z.object({
  q: z.string().min(3, 'Search query must be at least 3 characters').max(255),
});

// ── Mutations ─────────────────────────────────────────────────────────────────

export const updateUnitDetailsSchema = z.object({
  licensePlate: z.string().max(20).nullable().optional(),
  engineNumber: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const resolveIdentitySchema = z.object({
  outcome: z.enum(['AVAILABLE', 'INSPECTION']),
  vin: z.string().min(1).max(50).optional(),
  engineNumber: z.string().max(50).nullable().optional(),
  variantId: z.string().uuid().optional(),
  notes: z.string().min(1, 'notes is required').max(2000),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'eventDate must be YYYY-MM-DD')
    .optional(),
});

export const releaseUnitSchema = z.object({
  notes: z.string().max(2000).optional(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'eventDate must be YYYY-MM-DD')
    .optional(),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type ListUnitsQuery = z.infer<typeof listUnitsQuerySchema>;
export type SearchUnitsQuery = z.infer<typeof searchUnitsQuerySchema>;
export type UpdateUnitDetailsInput = z.infer<typeof updateUnitDetailsSchema>;
export type ResolveIdentityInput = z.infer<typeof resolveIdentitySchema>;
export type ReleaseUnitInput = z.infer<typeof releaseUnitSchema>;
