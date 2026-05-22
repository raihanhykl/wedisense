import { z } from 'zod';

export const lookupEanSchema = z.object({
  ean: z.string().min(1),
});

export const createProductSchema = z.object({
  eanCode: z.string().nullable().optional(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // Phase 17 v2 — optional for the spec §2.5 "inline quick-save" path.
  // When omitted, the service falls back to the first available
  // category (alphabetical by name) so a PO line item can be created
  // without forcing a category picker during the quick-add flow.
  categoryId: z.string().uuid().optional(),
  imageUrl: z.string().nullable().optional(),
  source: z.enum(['API_UPCITEMDB', 'API_BARCODELOOKUP', 'MANUAL']).default('MANUAL'),
  rawApiResponse: z.record(z.unknown()).nullable().optional(),
});

export const updateProductSchema = createProductSchema.partial().omit({ source: true, rawApiResponse: true });

export type LookupEanInput = z.infer<typeof lookupEanSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
