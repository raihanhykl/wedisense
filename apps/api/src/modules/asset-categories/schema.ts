import { z } from 'zod';

// Mirrors prisma's DepreciationMethod enum. Kept in sync manually because the
// generated Prisma types don't expose the enum as a runtime value.
const depreciationMethodSchema = z.enum(['STRAIGHT_LINE', 'DECLINING_BALANCE', 'NONE']);

// Hex colour: leading hash plus 6 hex chars. Loose enough to allow either case
// (the seed uses uppercase; the UI's colour picker emits lowercase).
const hexColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex code starting with "#"');

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(255),
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    // The asset-number generator uses code as a segment of the format
    // `WDS-{CATEGORY_CODE}-{YEAR}-{SEQ}` — keep it printable / URL-safe.
    .regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, underscores, or hyphens'),
  description: z.string().trim().max(2000).optional(),
  parentId: z.string().uuid().nullable().optional(),
  depreciationMethod: depreciationMethodSchema.default('NONE'),
  defaultDepreciationRate: z.number().min(0).max(100).optional(),
  defaultUsefulLifeMonths: z.number().int().positive().optional(),
  icon: z.string().trim().max(64).optional(),
  color: hexColourSchema.optional(),
});

// Update is partial — every field is optional and may be cleared by sending
// null where allowed. We use `.partial()` over duplicating the shape so the
// validation rules stay in lock-step with create.
export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
