/**
 * Zod schemas for the /api/sms/shipments endpoints.
 */
import { z } from 'zod';

// ── Shared primitives ─────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date');

// ── POST /import/inspect ──────────────────────────────────────────────────────

export const inspectTextBodySchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
  sheetName: z.string().optional(),
});

export const inspectFileQuerySchema = z.object({
  sheetName: z.string().optional(),
});

// ── POST /import/preview ──────────────────────────────────────────────────────

export const previewOptionsSchema = z.object({
  sheetName: z.string().optional(),
  headerRowIndex: z.number().int().nonnegative(),
  mapping: z.record(z.string().min(1), z.number().int().nonnegative().nullable()),
  destinationLocationId: z.string().uuid(),
  batchNumber: z.string().min(1).max(100),
  deliveryNoteNumber: z.string().max(100).optional(),
});

export const previewTextBodySchema = z.object({
  text: z.string().min(1),
  options: previewOptionsSchema,
});

export type PreviewOptions = z.infer<typeof previewOptionsSchema>;

// ── POST /import/confirm ──────────────────────────────────────────────────────

export const confirmSourceRowSchema = z.object({
  row: z.number().int().positive(),
  values: z.record(z.string(), z.string()),
});

export const confirmLineSchema = z.object({
  vin: z.string().min(1).max(100),
  engineNumber: z.string().max(100).optional(),
  variantId: z.string().uuid().optional(),
  rawModel: z.string().max(255).optional(),
  rawVariant: z.string().max(255).optional(),
  rawColor: z.string().max(255).optional(),
  sourceRows: z.array(confirmSourceRowSchema).min(1),
});

export const confirmBodySchema = z.object({
  destinationLocationId: z.string().uuid(),
  batchNumber: z.string().min(1).max(100),
  deliveryNoteNumber: z.string().max(100).optional(),
  dispatchDate: isoDate.optional(),
  originLocationId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  sourceFileName: z.string().max(255).optional(),
  columnMapping: z.record(z.string(), z.number().nullable()).optional(),
  lines: z.array(confirmLineSchema).min(1).max(2000),
});

export type ConfirmBody = z.infer<typeof confirmBodySchema>;
export type ConfirmLine = z.infer<typeof confirmLineSchema>;

// ── GET / ─────────────────────────────────────────────────────────────────────

export const listShipmentsQuerySchema = z.object({
  destinationLocationId: z.string().uuid().optional(),
  state: z.enum(['open', 'complete', 'all']).optional().default('all'),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type ListShipmentsQuery = z.infer<typeof listShipmentsQuerySchema>;

// ── POST /:id/receive ─────────────────────────────────────────────────────────

export const receiveItemSchema = z
  .object({
    lineId: z.string().uuid(),
    condition: z.enum(['OK', 'DAMAGED']),
    variantId: z.string().uuid().optional(),
    engineNumber: z.string().max(100).optional(),
    damageNotes: z.string().min(1).max(2000).optional(),
  })
  .refine(
    (item) =>
      item.condition !== 'DAMAGED' ||
      (item.damageNotes !== undefined && item.damageNotes.length > 0),
    {
      message: 'damageNotes is required when condition is DAMAGED',
      path: ['damageNotes'],
    },
  );

export const receiveBodySchema = z.object({
  eventDate: isoDate.optional(),
  items: z.array(receiveItemSchema).min(1).max(200),
});

export type ReceiveBody = z.infer<typeof receiveBodySchema>;
export type ReceiveItem = z.infer<typeof receiveItemSchema>;

// ── POST /:id/findings ────────────────────────────────────────────────────────

export const findingsBodySchema = z.object({
  vin: z.string().min(1).max(100),
  engineNumber: z.string().max(100).optional(),
  variantId: z.string().uuid(),
  lineId: z.string().uuid().optional(),
  notes: z.string().min(1).max(2000),
  eventDate: isoDate.optional(),
});

export type FindingsBody = z.infer<typeof findingsBodySchema>;
