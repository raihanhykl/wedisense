import { z } from 'zod';

// ── Vehicle model schemas ────────────────────────────────────────────────────

export const createVehicleModelSchema = z.object({
  code: z
    .string()
    .min(1, 'code is required')
    .max(50, 'code may not exceed 50 characters')
    .transform((v) => v.trim().toUpperCase()),
  name: z.string().min(1, 'name is required').max(255),
});

export const updateVehicleModelSchema = z.object({
  name: z.string().min(1, 'name is required').max(255).optional(),
  isActive: z.boolean().optional(),
});

export const listVehicleModelsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ── Vehicle variant schemas ──────────────────────────────────────────────────

export const createVehicleVariantSchema = z.object({
  modelId: z.string().uuid('modelId must be a valid UUID'),
  name: z.string().min(1, 'name is required').max(255),
  batteryVariant: z.string().max(100).optional(),
  color: z.string().min(1, 'color is required').max(100),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'colorHex must be a 6-digit hex colour, e.g. #FF0000')
    .optional(),
});

export const updateVehicleVariantSchema = z.object({
  name: z.string().min(1, 'name is required').max(255).optional(),
  batteryVariant: z.string().max(100).nullable().optional(),
  color: z.string().min(1, 'color is required').max(100).optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'colorHex must be a 6-digit hex colour, e.g. #FF0000')
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});

export const listVehicleVariantsQuerySchema = z.object({
  modelId: z.string().uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().max(255).optional(),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type CreateVehicleModelInput = z.infer<typeof createVehicleModelSchema>;
export type UpdateVehicleModelInput = z.infer<typeof updateVehicleModelSchema>;
export type ListVehicleModelsQuery = z.infer<typeof listVehicleModelsQuerySchema>;
export type CreateVehicleVariantInput = z.infer<typeof createVehicleVariantSchema>;
export type UpdateVehicleVariantInput = z.infer<typeof updateVehicleVariantSchema>;
export type ListVehicleVariantsQuery = z.infer<typeof listVehicleVariantsQuerySchema>;
