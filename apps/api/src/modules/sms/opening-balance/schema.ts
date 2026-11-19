/**
 * Zod schemas for the /api/sms/opening-balance endpoints.
 */
import { z } from 'zod';

// ── Shared primitives ─────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date');

// ── POST /inspect ─────────────────────────────────────────────────────────────

export const obInspectTextBodySchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
  sheetName: z.string().optional(),
});

export const obInspectFileQuerySchema = z.object({
  sheetName: z.string().optional(),
});

// ── POST /preview ─────────────────────────────────────────────────────────────

export const obPreviewOptionsSchema = z.object({
  sheetName: z.string().optional(),
  headerRowIndex: z.number().int().nonnegative(),
  mapping: z.record(z.string().min(1), z.number().int().nonnegative().nullable()),
  /** Override showroom for every row; required when the sheet has no showroom column. */
  showroomId: z.string().uuid().optional(),
  /** Cutover date (YYYY-MM-DD). Defaults to today. Must not be in the future. */
  balanceDate: isoDate.optional(),
});

export const obPreviewTextBodySchema = z.object({
  text: z.string().min(1),
  options: obPreviewOptionsSchema,
});

export type ObPreviewOptions = z.infer<typeof obPreviewOptionsSchema>;

// ── POST /confirm ─────────────────────────────────────────────────────────────

/** One fully-normalised row sent from the client after preview. */
export const obConfirmRowSchema = z.object({
  /** 1-based source row number (for error references). */
  row: z.number().int().positive(),
  vin: z.string().min(1).max(100),
  engineNumber: z.string().max(100).optional(),
  licensePlate: z.string().max(50).optional(),
  /** Resolved from the product master. Required before confirm. */
  variantId: z.string().uuid(),
  /** Responsible showroom id. */
  showroomId: z.string().uuid(),
  state: z.enum([
    'AVAILABLE',
    'BOOKED',
    'SOLD_PENDING_PICKUP',
    'ACTIVE_RTO',
    'INSPECTION',
    'SHOW_UNIT',
    'CUSTODY',
  ]),
  notes: z.string().max(2000).optional(),

  // ── BOOKED / SOLD_PENDING_PICKUP ──
  spkNumber: z.string().max(100).optional(),
  customerName: z.string().max(255).optional(),
  customerPhone: z.string().max(50).optional(),
  salesUserId: z.string().uuid().nullable().optional(),

  // ── ACTIVE_RTO ──
  contractNumber: z.string().max(100).optional(),
  contractStartDate: isoDate.optional(),

  // ── SHOW_UNIT ──
  eventName: z.string().max(255).optional(),
  eventLocation: z.string().max(255).optional(),
  expectedReturnDate: isoDate.optional(),
  picUserId: z.string().uuid().nullable().optional(),

  // ── CUSTODY ──
  /** Physical showroom id (must differ from showroomId). */
  heldAtShowroomId: z.string().uuid().optional(),
});

export const obConfirmBodySchema = z.object({
  /** Cutover date (YYYY-MM-DD, default today, not in the future). */
  balanceDate: isoDate.optional(),
  sourceFileName: z.string().max(255).optional(),
  rows: z.array(obConfirmRowSchema).min(1).max(2000),
});

export type ObConfirmBody = z.infer<typeof obConfirmBodySchema>;
export type ObConfirmRow = z.infer<typeof obConfirmRowSchema>;
