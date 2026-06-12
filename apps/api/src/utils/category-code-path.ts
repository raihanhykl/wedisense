import type { PrismaClient } from '@prisma/client';

// Hierarchical category code path used in asset numbers. A "Notebook" (NB)
// category whose parent is "IT Equipment" (IT) resolves to "IT/NB", so the
// asset number reads WDS-IT/NB-2026-00001. Root categories resolve to just
// their own code, which keeps legacy single-segment numbers and their
// asset_number_sequences rows working unchanged.

export const CATEGORY_PATH_SEPARATOR = '/';

export interface CategoryPathNode {
  id: string;
  code: string;
  parentId: string | null;
}

/** Minimal client shape — satisfied by both PrismaClient and a $transaction client. */
type CategoryQueryClient = Pick<PrismaClient, 'assetCategory'>;

/**
 * Pure path builder over an in-memory category list. Walks the parent chain
 * leaf→root and joins codes root-first. The visited-set guards against
 * cycles (the API only blocks direct self-parenting, not multi-hop loops);
 * a missing parent truncates the walk instead of throwing.
 */
export function buildCategoryCodePath(
  categoryId: string,
  categories: ReadonlyArray<CategoryPathNode>,
): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(categoryId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    segments.unshift(current.code);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments.join(CATEGORY_PATH_SEPARATOR);
}

/**
 * Loads every category once (soft-deleted included — codes are globally
 * unique even across deleted rows, and including them means a path never
 * silently loses an ancestor segment) and returns a resolver for bulk use.
 */
export async function loadCategoryCodePathResolver(
  client: CategoryQueryClient,
): Promise<(categoryId: string) => string> {
  const categories = await client.assetCategory.findMany({
    select: { id: true, code: true, parentId: true },
  });
  return (categoryId: string) => buildCategoryCodePath(categoryId, categories);
}

/** Single-category convenience wrapper around the bulk resolver. */
export async function getCategoryCodePath(
  client: CategoryQueryClient,
  categoryId: string,
): Promise<string> {
  const resolve = await loadCategoryCodePathResolver(client);
  return resolve(categoryId);
}
