import { z } from 'zod';

// Resource is an open-ended string at the DB layer, but the API enumerates
// the values it currently supports so a typo doesn't silently land a view
// no UI knows how to read. Extend as new list pages adopt saved views.
export const savedViewResourceSchema = z.enum(['assets']);

// Config shape is intentionally permissive. The asset list passes its own
// filter/sort/column-visibility blob; we don't want each schema migration
// of that blob to require a server-side change here. Cap the size so a
// runaway client can't store megabytes per view.
const MAX_CONFIG_BYTES = 16 * 1024;

const configSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (v) => JSON.stringify(v).length <= MAX_CONFIG_BYTES,
    `Config exceeds ${MAX_CONFIG_BYTES / 1024} KB limit`,
  );

export const createSavedViewSchema = z.object({
  resource: savedViewResourceSchema,
  name: z.string().trim().min(1).max(100),
  config: configSchema,
  isDefault: z.boolean().default(false),
});

export const updateSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: configSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;
