import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import * as repo from './repository.js';
import type { CreateProductInput, UpdateProductInput } from './schema.js';
import type { EanLookupResult } from './types.js';
import type { PaginationQuery } from '@wedisense/shared';

const EAN_LOOKUP_TIMEOUT = 3000; // 3 seconds per API

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
      name: String(item['title'] ?? ''),
      brand: item['brand'] ? String(item['brand']) : null,
      model: item['model'] ? String(item['model']) : null,
      description: item['description'] ? String(item['description']) : null,
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
      name: String(product['name'] ?? ''),
      brand: product['brand'] ? String(product['brand']) : null,
      model: null,
      description: product['description'] ? String(product['description']) : null,
      imageUrl: product['imageUrl'] ? String(product['imageUrl']) : null,
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

export async function listProducts(
  query: PaginationQuery & { search?: string; categoryId?: string },
) {
  const { skip, take, page, limit } = parsePagination(query);

  const where = {
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' as const } },
        { brand: { contains: query.search, mode: 'insensitive' as const } },
        { eanCode: { contains: query.search, mode: 'insensitive' as const } },
      ],
    }),
    ...(query.categoryId && { categoryId: query.categoryId }),
  };

  const [products, total] = await Promise.all([
    repo.findMany({ skip, take, where }),
    repo.count(where),
  ]);

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
  // Verify category exists
  const category = await prisma.assetCategory.findUnique({
    where: { id: input.categoryId, deletedAt: null },
  });
  if (!category) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Asset category not found');
  }

  // Check for duplicate EAN
  if (input.eanCode) {
    const existing = await repo.findByEan(input.eanCode);
    if (existing) {
      throw new AppError(409, 'EAN_ALREADY_EXISTS', 'A product with this EAN code already exists');
    }
  }

  const product = await repo.create({
    eanCode: input.eanCode ?? null,
    name: input.name,
    brand: input.brand ?? null,
    model: input.model ?? null,
    description: input.description ?? null,
    category: { connect: { id: input.categoryId } },
    imageUrl: input.imageUrl ?? null,
    source: input.source ?? 'MANUAL',
    rawApiResponse: input.rawApiResponse
      ? (input.rawApiResponse as Prisma.InputJsonValue)
      : Prisma.JsonNull,
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      resourceType: 'Product',
      resourceId: product.id,
      newValues: { name: product.name, eanCode: product.eanCode },
    },
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

  const product = await repo.update(id, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.brand !== undefined && { brand: input.brand }),
    ...(input.model !== undefined && { model: input.model }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.categoryId !== undefined && { category: { connect: { id: input.categoryId } } }),
    ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
    ...(input.eanCode !== undefined && { eanCode: input.eanCode }),
  });

  // Audit log
  await prisma.auditLog.create({
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
}
