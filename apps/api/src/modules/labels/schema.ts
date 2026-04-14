import { z } from 'zod';

// ── Label field schema ────────────────────────────────────────

const labelFieldSchema = z.object({
  type: z.enum(['barcode', 'qr_code', 'text', 'field', 'divider']),
  field_key: z.string().optional(),
  label: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  font_size: z.number().optional(),
  bold: z.boolean().optional(),
  custom_value: z.string().optional(),
});

// ── Template schemas ──────────────────────────────────────────

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  paperWidthMm: z.number().positive(),
  paperHeightMm: z.number().positive(),
  isDefault: z.boolean().optional().default(false),
  fields: z.array(labelFieldSchema).min(1),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  paperWidthMm: z.number().positive().optional(),
  paperHeightMm: z.number().positive().optional(),
  isDefault: z.boolean().optional(),
  fields: z.array(labelFieldSchema).min(1).optional(),
});

export const previewTemplateSchema = z.object({
  assetId: z.string().uuid(),
});

// ── Print Job schemas ─────────────────────────────────────────

export const createPrintJobSchema = z.object({
  templateId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1),
  copiesPerAsset: z.number().int().positive().optional().default(1),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type CreatePrintJobInput = z.infer<typeof createPrintJobSchema>;
