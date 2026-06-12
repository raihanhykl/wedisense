import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before importing the module under test. Vitest hoists these.

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    asset: {
      count: vi.fn(),
    },
    assetCategory: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('./repository.js', () => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  findByEan: vi.fn(),
  createInTransaction: vi.fn(),
  update: vi.fn(),
  updateInTransaction: vi.fn(),
  deleteById: vi.fn(),
  countAllAssets: vi.fn(),
  countActiveAssets: vi.fn(),
  countPurchaseOrderItems: vi.fn(),
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import * as repo from './repository.js';
import {
  listProducts,
  getProduct,
  deleteProduct,
} from './service.js';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockRepoFindMany = repo.findMany as ReturnType<typeof vi.fn>;
const mockRepoCount = repo.count as ReturnType<typeof vi.fn>;
const mockRepoFindById = repo.findById as ReturnType<typeof vi.fn>;
const mockRepoCountAllAssets = repo.countAllAssets as ReturnType<typeof vi.fn>;
const mockRepoCountActiveAssets = repo.countActiveAssets as ReturnType<typeof vi.fn>;
const mockRepoCountPurchaseOrderItems = repo.countPurchaseOrderItems as ReturnType<typeof vi.fn>;

// ── Shared fixtures ───────────────────────────────────────────────────────────

const CATEGORY = { id: 'cat-1', name: 'IT Equipment', code: 'IT' };

function makeRawProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    name: 'MacBook Pro',
    brand: 'Apple',
    model: 'A2442',
    eanCode: '0194252710982',
    categoryId: 'cat-1',
    imageUrl: null,
    source: 'MANUAL' as const,
    rawApiResponse: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    category: CATEGORY,
    _count: { assets: 2, purchaseOrderItems: 1 },
    ...overrides,
  };
}

const USER_ID = 'user-1';

// ─────────────────────────────────────────────────────────────────────────────
describe('listProducts()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns products with assetCount and purchaseOrderItemCount flattened from _count', async () => {
    const raw = makeRawProduct();
    mockRepoFindMany.mockResolvedValue([raw]);
    mockRepoCount.mockResolvedValue(1);

    const { products, meta } = await listProducts({ page: 1, limit: 20 });

    expect(products).toHaveLength(1);
    const p = products[0]!;
    expect(p.assetCount).toBe(2);
    expect(p.purchaseOrderItemCount).toBe(1);
    // _count must NOT be present in the returned shape
    expect(p).not.toHaveProperty('_count');
    expect(meta.total).toBe(1);
  });

  it('passes all existing scalar fields through so existing consumers keep working', async () => {
    const raw = makeRawProduct();
    mockRepoFindMany.mockResolvedValue([raw]);
    mockRepoCount.mockResolvedValue(1);

    const { products } = await listProducts({ page: 1, limit: 20 });
    const p = products[0]!;

    expect(p.id).toBe('prod-1');
    expect(p.name).toBe('MacBook Pro');
    expect(p.brand).toBe('Apple');
    expect(p.category).toEqual(CATEGORY);
  });

  it('passes search filter matching name to repo', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, search: 'macbook' });

    const whereArg = mockRepoFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(whereArg).toHaveProperty('OR');
    const or = whereArg['OR'] as Array<Record<string, unknown>>;
    expect(or.some((clause) => JSON.stringify(clause).includes('"name"'))).toBe(true);
  });

  it('search filters across name, brand, model, and eanCode', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, search: 'apple' });

    const whereArg = mockRepoFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    const or = whereArg['OR'] as Array<Record<string, unknown>>;
    const orStr = JSON.stringify(or);
    expect(orStr).toContain('"name"');
    expect(orStr).toContain('"brand"');
    expect(orStr).toContain('"model"');
    expect(orStr).toContain('"eanCode"');
  });

  it('passes categoryId filter to repo', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, categoryId: 'cat-1' });

    const whereArg = mockRepoFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(whereArg['categoryId']).toBe('cat-1');
  });

  it('sorts by name field when sort=name', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, sort: 'name', order: 'asc' });

    const orderByArg = mockRepoFindMany.mock.calls[0]![0].orderBy as Record<string, unknown>;
    expect(orderByArg).toEqual({ name: 'asc' });
  });

  it('sorts by brand field when sort=brand', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, sort: 'brand', order: 'desc' });

    const orderByArg = mockRepoFindMany.mock.calls[0]![0].orderBy as Record<string, unknown>;
    expect(orderByArg).toEqual({ brand: 'desc' });
  });

  it('sorts by assetCount via relation _count when sort=assetCount', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, sort: 'assetCount', order: 'asc' });

    const orderByArg = mockRepoFindMany.mock.calls[0]![0].orderBy as Record<string, unknown>;
    expect(orderByArg).toEqual({ assets: { _count: 'asc' } });
  });

  it('falls back to createdAt desc for unknown sort values', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20, sort: 'unknownField' });

    const orderByArg = mockRepoFindMany.mock.calls[0]![0].orderBy as Record<string, unknown>;
    expect(orderByArg).toEqual({ createdAt: 'desc' });
  });

  it('defaults to createdAt desc when no sort is provided', async () => {
    mockRepoFindMany.mockResolvedValue([]);
    mockRepoCount.mockResolvedValue(0);

    await listProducts({ page: 1, limit: 20 });

    const orderByArg = mockRepoFindMany.mock.calls[0]![0].orderBy as Record<string, unknown>;
    expect(orderByArg).toEqual({ createdAt: 'desc' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteProduct()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PRODUCT_NOT_FOUND when product does not exist', async () => {
    mockRepoFindById.mockResolvedValue(null);

    await expect(deleteProduct('no-such-id', USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws PRODUCT_IN_USE with counts when active assets exist', async () => {
    mockRepoFindById.mockResolvedValue(makeRawProduct());
    // countAllAssets: 2 total, asset.count (active): 2, purchaseOrderItems: 0
    mockRepoCountAllAssets.mockResolvedValue(2);
    mockRepoCountPurchaseOrderItems.mockResolvedValue(0);
    mockRepoCountActiveAssets.mockResolvedValue(2); // active-only count

    await expect(deleteProduct('prod-1', USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRODUCT_IN_USE',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws PRODUCT_IN_USE even when only soft-deleted assets exist', async () => {
    // Soft-deleted assets still hold the FK (onDelete: Restrict), so they
    // block a hard delete until purged.
    mockRepoFindById.mockResolvedValue(makeRawProduct());
    mockRepoCountAllAssets.mockResolvedValue(1); // 1 soft-deleted asset
    mockRepoCountPurchaseOrderItems.mockResolvedValue(0);
    mockRepoCountActiveAssets.mockResolvedValue(0); // 0 active

    await expect(deleteProduct('prod-1', USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRODUCT_IN_USE',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws PRODUCT_IN_USE when purchase order items exist (no assets)', async () => {
    mockRepoFindById.mockResolvedValue(makeRawProduct());
    mockRepoCountAllAssets.mockResolvedValue(0);
    mockRepoCountPurchaseOrderItems.mockResolvedValue(3);
    mockRepoCountActiveAssets.mockResolvedValue(0);

    await expect(deleteProduct('prod-1', USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRODUCT_IN_USE',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('exposes activeAssetCount, totalAssetCount, and purchaseOrderItemCount in error details', async () => {
    mockRepoFindById.mockResolvedValue(makeRawProduct());
    mockRepoCountAllAssets.mockResolvedValue(3); // total (incl. soft-deleted)
    mockRepoCountPurchaseOrderItems.mockResolvedValue(1);
    mockRepoCountActiveAssets.mockResolvedValue(2); // active only

    const err = await deleteProduct('prod-1', USER_ID).catch((e: unknown) => e) as {
      details: Array<{ activeAssetCount: number; totalAssetCount: number; purchaseOrderItemCount: number }>;
    };
    expect(err.details?.[0]).toEqual({
      activeAssetCount: 2,
      totalAssetCount: 3,
      purchaseOrderItemCount: 1,
    });
  });

  it('deletes the product and writes an audit log when unreferenced', async () => {
    const product = makeRawProduct({ _count: { assets: 0, purchaseOrderItems: 0 } });
    mockRepoFindById.mockResolvedValue(product);
    mockRepoCountAllAssets.mockResolvedValue(0);
    mockRepoCountPurchaseOrderItems.mockResolvedValue(0);
    mockRepoCountActiveAssets.mockResolvedValue(0);

    // Wire the transaction to execute the callback
    const mockTx = {
      product: { delete: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    mockTransaction.mockImplementation(
      (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    );

    await deleteProduct('prod-1', USER_ID);

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockTx.product.delete).toHaveBeenCalledWith({ where: { id: 'prod-1' } });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          action: 'DELETE',
          resourceType: 'Product',
          resourceId: 'prod-1',
        }),
      }),
    );
  });

  it('does not call $transaction when the guard check throws', async () => {
    mockRepoFindById.mockResolvedValue(makeRawProduct());
    mockRepoCountAllAssets.mockResolvedValue(5);
    mockRepoCountPurchaseOrderItems.mockResolvedValue(0);
    mockRepoCountActiveAssets.mockResolvedValue(5);

    await expect(deleteProduct('prod-1', USER_ID)).rejects.toMatchObject({
      code: 'PRODUCT_IN_USE',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('maps a FK race (P2003) during delete to PRODUCT_IN_USE with fresh counts', async () => {
    mockRepoFindById.mockResolvedValue(makeRawProduct());
    // Guard passes (no references), then the FK trips inside the transaction
    // because a referencing row was created in between — the guard re-runs
    // and reports the new reference as a 409 instead of a generic 500.
    mockRepoCountAllAssets.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    mockRepoCountActiveAssets.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    mockRepoCountPurchaseOrderItems.mockResolvedValue(0);
    mockTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK constraint violated', {
        code: 'P2003',
        clientVersion: '0.0.0-test',
      }),
    );

    const err = await deleteProduct('prod-1', USER_ID).catch((e: unknown) => e) as {
      statusCode: number;
      code: string;
      details: Array<{ activeAssetCount: number; totalAssetCount: number; purchaseOrderItemCount: number }>;
    };
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('PRODUCT_IN_USE');
    expect(err.details?.[0]).toEqual({
      activeAssetCount: 1,
      totalAssetCount: 1,
      purchaseOrderItemCount: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getProduct()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PRODUCT_NOT_FOUND when product is missing', async () => {
    mockRepoFindById.mockResolvedValue(null);

    await expect(getProduct('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('returns the product when found', async () => {
    const product = makeRawProduct();
    mockRepoFindById.mockResolvedValue(product);

    const result = await getProduct('prod-1');
    expect(result).toEqual(product);
  });
});
