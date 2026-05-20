import { z } from 'zod';

// ── Tour step ────────────────────────────────────────────────────────────────

const positionEnum = z.enum(['top', 'bottom', 'left', 'right', 'auto']);

export const tourStepSchema = z.object({
  stepIndex: z
    .number()
    .int()
    .min(0, 'stepIndex must be a non-negative integer'),
  title: z.string().min(1, 'title is required'),
  description: z.string().min(1, 'description is required'),
  targetElement: z.string().min(1, 'targetElement is required'),
  position: positionEnum,
  requiredPermission: z
    .object({
      resource: z.string().min(1),
      action: z.string().min(1),
    })
    .nullable(),
  route: z
    .string()
    .min(1)
    .startsWith('/', 'route must start with /'),
  isActive: z.boolean().default(true),
});

/**
 * Array validator that enforces:
 * - stepIndex values are unique
 * - sorted ascending starting from 0
 * - no gaps (0, 1, 2, ... N-1)
 */
export const tourStepsArraySchema = z.array(tourStepSchema).superRefine((steps, ctx) => {
  if (steps.length === 0) return; // empty steps are valid (degenerate tour)

  const indices = steps.map((s) => s.stepIndex);
  const seen = new Set<number>();

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] as number;
    if (seen.has(idx)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'stepIndex'],
        message: `Duplicate stepIndex ${idx}`,
      });
    }
    seen.add(idx);
  }

  // Verify sorted ascending
  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== indices[i]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'stepIndex'],
        message: 'Steps must be sorted ascending by stepIndex',
      });
      return; // report once
    }
  }

  // Verify starts at 0 and has no gaps
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'stepIndex'],
        message: `stepIndex sequence must start at 0 and have no gaps. Expected ${i}, got ${sorted[i]}`,
      });
      return; // report once
    }
  }
});

// ── Tour CRUD ────────────────────────────────────────────────────────────────

export const createTourSchema = z.object({
  roleId: z.string().uuid('roleId must be a UUID'),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
  steps: tourStepsArraySchema,
});

export const updateTourSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  steps: tourStepsArraySchema.optional(),
});

// ── Progress ─────────────────────────────────────────────────────────────────

export const updateProgressSchema = z.object({
  stepIndex: z.number().int().min(0),
  action: z.enum(['next', 'prev', 'skip', 'complete']),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type CreateTourInput = z.infer<typeof createTourSchema>;
export type UpdateTourInput = z.infer<typeof updateTourSchema>;
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
