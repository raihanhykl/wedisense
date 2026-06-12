import { z } from 'zod';

export const lookupEanSchema = z.object({
  ean: z.string().min(1),
});

export const productListQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
});

export const createProductSchema = z.object({
  eanCode: z.string().nullable().optional(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // Required — the category code is baked into the asset number
  // (WDS-{CATEGORY_CODE}-…) at asset-creation time, so a product created
  // with the wrong category silently mis-numbers every asset linked to
  // it. The old "first category alphabetically" fallback did exactly
  // that (everything landed in Electronics); the quick-save UX now asks
  // for a category in NewProductDialog instead.
  categoryId: z.string().uuid(),
  imageUrl: z.string().nullable().optional(),
  source: z.enum(['API_UPCITEMDB', 'API_BARCODELOOKUP', 'MANUAL']).default('MANUAL'),
  rawApiResponse: z.record(z.unknown()).nullable().optional(),
});

export const updateProductSchema = createProductSchema.partial().omit({ source: true, rawApiResponse: true });

export type LookupEanInput = z.infer<typeof lookupEanSchema>;
export type ProductListQueryInput = z.infer<typeof productListQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
