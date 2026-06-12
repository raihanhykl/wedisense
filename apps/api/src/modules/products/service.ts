import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import * as repo from './repository.js';
import type { CreateProductInput, UpdateProductInput, ProductListQueryInput } from './schema.js';
import type { EanLookupResult, ProductSortField } from './types.js';
import type { PaginationQuery } from '@wedisense/shared';

const EAN_LOOKUP_TIMEOUT = 3000; // 3 seconds per API

/** Safely convert an unknown API field value to string, returning undefined for non-string/non-primitive values. */
function asStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

// ── EAN Lookup Chain ──────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function lookupUpcItemDb(ean: string): Promise<EanLookupResult | null> {
  try {
    const apiKey = process.env['UPCITEMDB_API_KEY'];
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) {
      headers['user_key'] = apiKey;
    }

    const res = await fetchWithTimeout(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(ean)}`,
      { headers },
      EAN_LOOKUP_TIMEOUT,
    );

    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    const items = data['items'] as Array<Record<string, unknown>> | undefined;
    const item = items?.[0];
    if (!item) return null;

    return {
      name: asStr(item['title']) ?? '',
      brand: asStr(item['brand']) ?? null,
      model: asStr(item['model']) ?? null,
      description: asStr(item['description']) ?? null,
      imageUrl: (item['images'] as string[] | undefined)?.[0] ?? null,
      source: 'API_UPCITEMDB',
      rawApiResponse: data,
    };
  } catch {
    return null;
  }
}

async function lookupGoUpc(ean: string): Promise<EanLookupResult | null> {
  const apiKey = process.env['GO_UPC_API_KEY'];
  if (!apiKey) return null;

  try {
    const res = await fetchWithTimeout(
      `https://go-upc.com/api/v1/code/${encodeURIComponent(ean)}`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      },
      EAN_LOOKUP_TIMEOUT,
    );

    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    const product = data['product'] as Record<string, unknown> | undefined;
    if (!product) return null;

    return {
      name: asStr(product['name']) ?? '',
      brand: asStr(product['brand']) ?? null,
      model: null,
      description: asStr(product['description']) ?? null,
      imageUrl: asStr(product['imageUrl']) ?? null,
      source: 'API_BARCODELOOKUP',
      rawApiResponse: data,
    };
  } catch {
    return null;
  }
}

/**
 * Lookup EAN code: internal DB → UPCitemdb → Go-UPC
 * Returns product data if found, null if not found anywhere
 */
export async function lookupEan(ean: string) {
  // 1. Check internal DB first
  const existing = await repo.findByEan(ean);
  if (existing) {
    return { product: existing, source: 'internal' as const };
  }

  // 2. Try UPCitemdb API (3s timeout)
  const upcResult = await lookupUpcItemDb(ean);
  if (upcResult) {
    return { product: null, lookup: upcResult, source: 'upcitemdb' as const };
  }

  // 3. Try Go-UPC API (3s timeout)
  const goUpcResult = await lookupGoUpc(ean);
  if (goUpcResult) {
    return { product: null, lookup: goUpcResult, source: 'go-upc' as const };
  }

  // 4. Not found anywhere
  return { product: null, lookup: null, source: 'not_found' as const };
}

// ── CRUD ──────────────────────────────────────────────────────────────

function buildOrderBy(
  sort?: string,
  order?: 'asc' | 'desc',
): Prisma.ProductOrderByWithRelationInput {
  const validSorts: Record<ProductSortField, Prisma.ProductOrderByWithRelationInput> = {
    name: { name: order ?? 'desc' },
    brand: { brand: order ?? 'desc' },
    createdAt: { createdAt: order ?? 'desc' },
    // NOTE: assetCount sorts on the total count of ALL asset rows (including
    // soft-deleted) because Prisma's relation orderBy does not support filtered
    // _count. The list item shows only active-asset counts, so there may be a
    // minor ordering skew for products with soft-deleted assets. This is
    // acceptable — the sort is a convenience hint, not a precision ranking.
    assetCount: { assets: { _count: order ?? 'desc' } },
  };

  if (sort && sort in validSorts) {
    return validSorts[sort as ProductSortField];
  }

  return { createdAt: order ?? 'desc' };
}

export async function listProducts(
  query: PaginationQuery & ProductListQueryInput,
) {
  const { skip, take, page, limit } = parsePagination(query);

  const where: Prisma.ProductWhereInput = {
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
        { eanCode: { contains: query.search, mode: 'insensitive' } },
      ],
    }),
    ...(query.categoryId && { categoryId: query.categoryId }),
  };

  const orderBy = buildOrderBy(query.sort, query.order);

  const [rawProducts, total] = await Promise.all([
    repo.findMany({ skip, take, where, orderBy }),
    repo.count(where),
  ]);

  // Flatten the Prisma _count relation into named fields so callers get a
  // stable shape: { assetCount, purchaseOrderItemCount }. Keeping all other
  // scalar fields preserves backwards-compatibility with existing consumers
  // (e.g. ProductOption in the web app).
  const products = rawProducts.map(({ _count, ...rest }) => ({
    ...rest,
    assetCount: _count.assets,
    purchaseOrderItemCount: _count.purchaseOrderItems,
  }));

  return { products, meta: buildPaginationMeta(page, limit, total) };
}

export async function getProduct(id: string) {
  const product = await repo.findById(id);
  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  return product;
}

export async function createProduct(input: CreateProductInput, userId: string) {
  // Category is required (schema-enforced). No fallback: the category
  // code is baked into asset numbers at asset-creation time, so a
  // silently-defaulted category mis-numbers every asset linked to the
  // product. Quick-save flows collect the category in NewProductDialog.
  const category = await prisma.assetCategory.findUnique({
    where: { id: input.categoryId, deletedAt: null },
  });
  if (!category) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Asset category not found');
  }
  const categoryId = category.id;

  // Check for duplicate EAN
  if (input.eanCode) {
    const existing = await repo.findByEan(input.eanCode);
    if (existing) {
      throw new AppError(409, 'EAN_ALREADY_EXISTS', 'A product with this EAN code already exists');
    }
  }

  // Product row + audit entry commit atomically — a failed audit write
  // must not leave an untracked product behind.
  const product = await prisma.$transaction(async (tx) => {
    const created = await repo.createInTransaction(tx, {
      eanCode: input.eanCode ?? null,
      name: input.name,
      brand: input.brand ?? null,
      model: input.model ?? null,
      description: input.description ?? null,
      category: { connect: { id: categoryId } },
      imageUrl: input.imageUrl ?? null,
      source: input.source ?? 'MANUAL',
      rawApiResponse: input.rawApiResponse
        ? (input.rawApiResponse as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'Product',
        resourceId: created.id,
        newValues: { name: created.name, eanCode: created.eanCode },
      },
    });

    return created;
  });

  return product;
}

export async function updateProduct(id: string, input: UpdateProductInput, userId: string) {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  // Check for duplicate EAN on update
  if (input.eanCode && input.eanCode !== existing.eanCode) {
    const duplicate = await repo.findByEan(input.eanCode);
    if (duplicate && duplicate.id !== id) {
      throw new AppError(409, 'EAN_ALREADY_EXISTS', 'A product with this EAN code already exists');
    }
  }

  if (input.categoryId) {
    const category = await prisma.assetCategory.findUnique({
      where: { id: input.categoryId, deletedAt: null },
    });
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Asset category not found');
    }
  }

  // Product row + audit entry commit atomically — a failed audit write
  // must not leave an untracked update behind (same contract as create).
  return prisma.$transaction(async (tx) => {
    const product = await repo.updateInTransaction(tx, id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.brand !== undefined && { brand: input.brand }),
      ...(input.model !== undefined && { model: input.model }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.categoryId !== undefined && { category: { connect: { id: input.categoryId } } }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.eanCode !== undefined && { eanCode: input.eanCode }),
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'Product',
        resourceId: product.id,
        oldValues: { name: existing.name, brand: existing.brand },
        newValues: { name: product.name, brand: product.brand },
      },
    });

    return product;
  });
}

export async function deleteProduct(id: string, userId: string) {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  // Guard: count referencing rows before attempting the hard delete. Soft-deleted
  // assets still hold the FK (schema onDelete: Restrict) so they block deletion
  // just as live assets do. We surface both counts so the caller can communicate
  // a precise message (e.g. "reassign 3 active assets and dispose of 1 archived
  // asset before deleting this product").
  const assertNotInUse = async () => {
    const [totalAssetCount, activeAssetCount, purchaseOrderItemCount] = await Promise.all([
      repo.countAllAssets(id),
      repo.countActiveAssets(id),
      repo.countPurchaseOrderItems(id),
    ]);

    if (totalAssetCount > 0 || purchaseOrderItemCount > 0) {
      throw new AppError(
        409,
        'PRODUCT_IN_USE',
        'Cannot delete: product is still referenced by assets or purchase order items. Reassign or remove all references first.',
        [{ activeAssetCount, totalAssetCount, purchaseOrderItemCount }],
      );
    }
  };

  await assertNotInUse();

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'DELETE',
          resourceType: 'Product',
          resourceId: id,
          oldValues: {
            name: existing.name,
            eanCode: existing.eanCode,
            brand: existing.brand,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  } catch (err) {
    // TOCTOU: a referencing row created between the guard and the delete trips
    // the FK restraint (P2003). Re-run the guard so the caller still gets the
    // 409 contract with fresh counts instead of a generic 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      await assertNotInUse();
    }
    throw err;
  }
}
