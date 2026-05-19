import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    asset: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    assetCategory: {
      findMany: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    location: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/barcode.js', () => ({
  generateBarcode: vi.fn().mockResolvedValue('/b.png'),
  generateQrCode: vi.fn().mockResolvedValue('/q.png'),
}));

vi.mock('./repository.js', () => ({
  createInTransaction: vi.fn(),
  createMovementInTransaction: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import * as repo from './repository.js';
import { previewImportDedup, bulkImport } from './import-service.js';
import type { AssetImportRow } from '../../lib/excel.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const mockAssetFindMany = prisma.asset.findMany as ReturnType<typeof vi.fn>;
const mockAssetCategoryFindMany = prisma.assetCategory.findMany as ReturnType<typeof vi.fn>;
const mockProductFindMany = prisma.product.findMany as ReturnType<typeof vi.fn>;
const mockProductCreate = prisma.product.create as ReturnType<typeof vi.fn>;
const mockLocationFindMany = prisma.location.findMany as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockRepoCreateInTx = repo.createInTransaction as ReturnType<typeof vi.fn>;
const mockRepoCreateMovementInTx = repo.createMovementInTransaction as ReturnType<typeof vi.fn>;

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<AssetImportRow> = {}): AssetImportRow {
  return {
    rowIndex: 2,
    productId: 'prod-1',
    name: 'Test Asset',
    status: 'ACTIVE',
    condition: 'NEW',
    locationId: 'loc-1',
    currency: 'IDR',
    ...overrides,
  };
}

const PRODUCT = {
  id: 'prod-1',
  name: 'MacBook',
  category: { code: 'IT' },
};

const LOCATION = { id: 'loc-1', name: 'Head Office', deletedAt: null };

const LIVE_ASSET = {
  id: 'existing-1',
  assetNumber: 'WDS-IT-2025-00001',
  name: 'Existing Asset',
  serialNumber: 'SN-LIVE',
};

/**
 * Wire up $transaction to invoke the callback with a tx that mirrors
 * createInTransaction and createMovementInTransaction calls through the repo mocks.
 */
function mockBulkTx(seqStart = 1) {
  let seq = seqStart;
  const tx = {
    asset: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    product: {
      create: vi.fn().mockImplementation((args: { data: { name: string } }) =>
        Promise.resolve({ id: `new-prod-${args.data.name}`, name: args.data.name }),
      ),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockImplementation(() => {
      return Promise.resolve([{ current_sequence: seq++ }]);
    }),
  };

  // The outer $transaction may be called more than once (product pre-pass + asset tx)
  mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(tx));

  mockRepoCreateInTx.mockImplementation((_tx: unknown, data: { name: string; id: string; assetNumber: string }) =>
    Promise.resolve({ id: data.id, assetNumber: data.assetNumber, name: data.name }),
  );
  mockRepoCreateMovementInTx.mockResolvedValue({});

  return tx;
}

const USER_ID = 'user-1';

// ─────────────────────────────────────────────────────────────────────────────
describe('previewImportDedup()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { willSkip: [] } for empty rows', async () => {
    const result = await previewImportDedup([]);
    expect(result).toEqual({ willSkip: [] });
    expect(mockAssetFindMany).not.toHaveBeenCalled();
  });

  it('returns { willSkip: [] } when no rows have serials', async () => {
    const result = await previewImportDedup([makeRow(), makeRow({ rowIndex: 3 })]);
    expect(result).toEqual({ willSkip: [] });
    expect(mockAssetFindMany).not.toHaveBeenCalled();
  });

  it('puts rows with serials matching live assets into willSkip', async () => {
    mockAssetFindMany.mockResolvedValue([LIVE_ASSET]);

    const result = await previewImportDedup([makeRow({ serialNumber: 'SN-LIVE' })]);

    expect(result.willSkip).toHaveLength(1);
    expect(result.willSkip[0]).toMatchObject({
      rowIndex: 2,
      reason: 'duplicate_serial',
      existing: { id: 'existing-1', serialNumber: 'SN-LIVE' },
    });
  });

  it('does NOT put soft-deleted asset serials into willSkip (query filters deletedAt: null)', async () => {
    // The query uses WHERE deletedAt IS NULL, so soft-deleted assets are not returned
    mockAssetFindMany.mockResolvedValue([]); // soft-deleted not returned by query

    const result = await previewImportDedup([makeRow({ serialNumber: 'SN-DELETED' })]);

    expect(result.willSkip).toHaveLength(0);
  });

  it('queries prisma with the correct deletedAt: null filter', async () => {
    mockAssetFindMany.mockResolvedValue([]);

    await previewImportDedup([makeRow({ serialNumber: 'SN-X' })]);

    expect(mockAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serialNumber: { in: ['SN-X'] },
          deletedAt: null,
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('bulkImport()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result for empty rows', async () => {
    const result = await bulkImport([], USER_ID);
    expect(result).toEqual({ created: [], skipped: [], failed: [] });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('all rows valid → all created, skipped=0, failed=0', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    // No existing live assets → no serials to skip
    mockAssetFindMany.mockResolvedValue([]);
    mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const rows = [
      makeRow({ rowIndex: 2, serialNumber: 'SN-A' }),
      makeRow({ rowIndex: 3, serialNumber: 'SN-B' }),
    ];
    const result = await bulkImport(rows, USER_ID);

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('rows with newProductSpec → product created in pre-pass, assets linked to new product', async () => {
    const rowWithSpec: AssetImportRow = {
      ...makeRow({ rowIndex: 2 }),
      productId: '__new__',
      newProductSpec: { name: 'Lenovo ThinkPad X1', categoryName: 'IT' },
    };

    mockAssetCategoryFindMany.mockResolvedValue([{ id: 'cat-IT', name: 'IT', code: 'it' }]);

    // The pre-pass $transaction creates the product, then the asset tx runs
    let txCallCount = 0;
    const productTx = {
      product: {
        create: vi.fn().mockResolvedValue({ id: 'new-prod-ThinkPad', name: 'Lenovo ThinkPad X1' }),
      },
      asset: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: 1 }]),
    };

    mockTransaction.mockImplementation((cb: (tx: typeof productTx) => Promise<unknown>) => {
      txCallCount++;
      return cb(productTx);
    });

    // After the pre-pass the row's productId gets patched to 'new-prod-ThinkPad'
    mockProductFindMany.mockResolvedValue([
      { id: 'new-prod-ThinkPad', name: 'Lenovo ThinkPad X1', category: { code: 'IT' } },
    ]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);

    mockRepoCreateInTx.mockImplementation(
      (_tx: unknown, data: { id: string; assetNumber: string; name: string }) =>
        Promise.resolve({ id: data.id, assetNumber: data.assetNumber, name: data.name }),
    );
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});

    const result = await bulkImport([rowWithSpec], USER_ID);

    // Product create should have been invoked in pre-pass tx
    expect(productTx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Lenovo ThinkPad X1' }) }),
    );
    expect(result.failed).toHaveLength(0);
    expect(result.created).toHaveLength(1);
  });

  it('newProductSpec with missing category → row goes to failed with productCategory error', async () => {
    const rowWithSpec: AssetImportRow = {
      ...makeRow({ rowIndex: 2 }),
      productId: '__new__',
      newProductSpec: { name: 'Unknown Product', categoryName: 'NonExistentCategory' },
    };

    mockAssetCategoryFindMany.mockResolvedValue([]); // category not found

    // pre-pass $transaction runs but product.create is not called
    const productTx = {
      product: { create: vi.fn() },
      asset: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn(),
    };
    mockTransaction.mockImplementation((cb: (tx: typeof productTx) => Promise<unknown>) => cb(productTx));

    // After early failure, no remaining rows → bulkImport returns early
    // But auditLog.create is still called (with 0 created)
    mockAuditLogCreate.mockResolvedValue({});
    // These won't be called if all rows fail early, but stub them anyway
    mockProductFindMany.mockResolvedValue([]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);

    const result = await bulkImport([rowWithSpec], USER_ID);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      rowIndex: 2,
      field: 'productCategory',
    });
    expect(result.created).toHaveLength(0);
    expect(productTx.product.create).not.toHaveBeenCalled();
  });

  it('duplicate serial against live asset → row goes to skipped, not failed', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([LIVE_ASSET]); // SN-LIVE already exists
    mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const result = await bulkImport([makeRow({ serialNumber: 'SN-LIVE' })], USER_ID);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ reason: 'duplicate_serial', rowIndex: 2 });
    expect(result.failed).toHaveLength(0);
    expect(result.created).toHaveLength(0);
  });

  it('duplicate serial against soft-deleted asset → row creates successfully and nulls old serial', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    // Soft-deleted not returned by the live-asset query
    mockAssetFindMany.mockResolvedValue([]);
    const tx = mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const result = await bulkImport([makeRow({ serialNumber: 'SN-WASDELETED' })], USER_ID);

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    // updateMany must be called inside tx to free the soft-deleted serial
    expect(tx.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serialNumber: { in: ['SN-WASDELETED'] },
          deletedAt: { not: null },
        }),
        data: { serialNumber: null },
      }),
    );
  });

  it('within-file duplicate serials → second row goes to failed', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]); // no live conflict
    mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const rows = [
      makeRow({ rowIndex: 2, serialNumber: 'SN-DUP' }),
      makeRow({ rowIndex: 3, serialNumber: 'SN-DUP' }), // second → duplicate within file
    ];
    const result = await bulkImport(rows, USER_ID);

    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      rowIndex: 3,
      field: 'serialNumber',
    });
  });

  it('live-asset dedupe wins over within-file conflict (live serial → skipped, not failed)', async () => {
    // Both rows share 'SN-LIVE' which is already owned by a live asset.
    // The first row should be classified as "skipped" (idempotent re-import).
    // The second row — even though it would have been a within-file duplicate —
    // is also classified as "skipped" because the live check runs first.
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([LIVE_ASSET]); // SN-LIVE exists live
    mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const rows = [
      makeRow({ rowIndex: 2, serialNumber: 'SN-LIVE' }),
      makeRow({ rowIndex: 3, serialNumber: 'SN-LIVE' }),
    ];
    const result = await bulkImport(rows, USER_ID);

    // Both rows were seen in the live-asset map before seenSerialsInFile could fire
    expect(result.skipped).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.created).toHaveLength(0);
  });

  it('onProgress callback is invoked at pre-pass checkpoint and per insert', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);
    mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const onProgress = vi.fn().mockResolvedValue(undefined);

    await bulkImport(
      [makeRow({ rowIndex: 2 }), makeRow({ rowIndex: 3 })],
      USER_ID,
      { onProgress },
    );

    // At minimum: one checkpoint after pre-pass + once per row = 3 calls
    expect(onProgress).toHaveBeenCalledTimes(4); // checkpoint + checkpoint2 + 2 per-row
    // Each call should have { processed, total, created, skipped, failed }
    const firstCall = onProgress.mock.calls[0]![0] as { total: number };
    expect(firstCall).toHaveProperty('total');
    expect(firstCall).toHaveProperty('processed');
  });

  it('onProgress errors are swallowed — import still completes', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);
    mockBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    const throwingProgress = vi.fn().mockRejectedValue(new Error('Redis down'));

    const result = await bulkImport([makeRow()], USER_ID, {
      onProgress: throwingProgress,
    });

    // Despite the callback throwing, import should complete successfully
    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it('writes audit log with mode-style fields after import', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);
    const tx = mockBulkTx();

    await bulkImport([makeRow({ rowIndex: 2 }), makeRow({ rowIndex: 3 })], USER_ID);

    // Audit log is written INSIDE the transaction via tx.auditLog.create
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    const auditArg = tx.auditLog.create.mock.calls[0]![0] as {
      data: {
        userId: string;
        action: string;
        resourceType: string;
        newValues: { created: number; skipped: number; failed: number };
      };
    };
    expect(auditArg.data.userId).toBe(USER_ID);
    expect(auditArg.data.action).toBe('IMPORT');
    expect(auditArg.data.resourceType).toBe('Asset');
    expect(auditArg.data.newValues).toMatchObject({ created: 2, skipped: 0, failed: 0 });
    // prisma.auditLog.create (outside tx) must NOT be called
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('deduplicates newProductSpec rows by name+category (one product created for N rows)', async () => {
    const makeSpecRow = (rowIndex: number): AssetImportRow => ({
      ...makeRow({ rowIndex }),
      productId: '__new__',
      newProductSpec: { name: 'Lenovo ThinkPad X1', categoryName: 'IT' },
    });

    mockAssetCategoryFindMany.mockResolvedValue([{ id: 'cat-IT', name: 'IT', code: 'IT' }]);

    let productCreateCount = 0;
    const sharedTx = {
      product: {
        create: vi.fn().mockImplementation((args: { data: { name: string } }) => {
          productCreateCount++;
          return Promise.resolve({ id: 'new-prod-thinkpad', name: args.data.name });
        }),
      },
      asset: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: 1 }]),
    };

    mockTransaction.mockImplementation((cb: (tx: typeof sharedTx) => Promise<unknown>) => cb(sharedTx));

    mockProductFindMany.mockResolvedValue([
      { id: 'new-prod-thinkpad', name: 'Lenovo ThinkPad X1', category: { code: 'IT' } },
    ]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);

    mockRepoCreateInTx.mockImplementation(
      (_tx: unknown, data: { id: string; assetNumber: string; name: string }) =>
        Promise.resolve({ id: data.id, assetNumber: data.assetNumber, name: data.name }),
    );
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});

    const rows = [makeSpecRow(2), makeSpecRow(3)];
    const result = await bulkImport(rows, USER_ID);

    // Only ONE product.create call despite TWO rows referencing the same spec
    expect(productCreateCount).toBe(1);
    expect(result.created).toHaveLength(2);
  });

  it('tx.product.create runs in the SAME $transaction as repo.createInTransaction (merged atom)', async () => {
    // Verify the new-product creation and asset insertion share one transaction boundary.
    // If they were in separate transactions, a crash between them would leave an orphaned product.
    const rowWithSpec: AssetImportRow = {
      ...makeRow({ rowIndex: 2 }),
      productId: '__new__',
      newProductSpec: { name: 'Sony Bravia', categoryName: 'AV' },
    };

    mockAssetCategoryFindMany.mockResolvedValue([{ id: 'cat-AV', name: 'AV', code: 'AV' }]);

    const NEW_PRODUCT_UUID = 'new-prod-sony-uuid';
    const capturedProductIdsForInsert: string[] = [];

    const singleTx = {
      product: {
        create: vi.fn().mockResolvedValue({ id: NEW_PRODUCT_UUID, name: 'Sony Bravia' }),
      },
      asset: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: 1 }]),
    };

    mockTransaction.mockImplementation((cb: (tx: typeof singleTx) => Promise<unknown>) => cb(singleTx));

    mockProductFindMany.mockResolvedValue([]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);

    mockRepoCreateInTx.mockImplementation(
      (_tx: unknown, data: { id: string; assetNumber: string; name: string; product?: { connect?: { id: string } } }) => {
        // Capture which productId the asset insert was wired to
        const productConnectId = (data as { product: { connect: { id: string } } }).product?.connect?.id;
        if (productConnectId) capturedProductIdsForInsert.push(productConnectId);
        return Promise.resolve({ id: data.id, assetNumber: data.assetNumber, name: data.name });
      },
    );
    mockRepoCreateMovementInTx.mockResolvedValue({});

    // Should use $transaction exactly once — both product.create and asset insert are inside it
    const result = await bulkImport([rowWithSpec], USER_ID);

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(singleTx.product.create).toHaveBeenCalledOnce();
    // The asset insert must reference the UUID returned by tx.product.create, not the natural-key string
    expect(capturedProductIdsForInsert).toHaveLength(1);
    expect(capturedProductIdsForInsert[0]).toBe(NEW_PRODUCT_UUID);
    expect(result.created).toHaveLength(1);
  });

  it('atomicity: if $transaction throws after product.create, the caller receives the error and nothing commits', async () => {
    // Simulate a crash inside the transaction after the product is "created" but before assets insert.
    // The mock simply rejects the whole $transaction, as the real Prisma would on a DB error.
    // The test verifies bulkImport propagates the error and does NOT return a partial result.
    const rowWithSpec: AssetImportRow = {
      ...makeRow({ rowIndex: 2 }),
      productId: '__new__',
      newProductSpec: { name: 'Crashed Product', categoryName: 'IT' },
    };

    mockAssetCategoryFindMany.mockResolvedValue([{ id: 'cat-IT', name: 'IT', code: 'IT' }]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);
    mockProductFindMany.mockResolvedValue([]);

    const dbCrashError = new Error('connection pool timeout');

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      // Partially execute: product.create "succeeds" inside the callback, then crash
      const fakeTx = {
        product: {
          create: vi.fn().mockResolvedValue({ id: 'would-be-orphan', name: 'Crashed Product' }),
        },
        asset: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        $queryRaw: vi.fn().mockImplementation(() => {
          // Blow up here — simulates crash mid-transaction after product was created
          throw dbCrashError;
        }),
      };
      // Run the callback (which throws inside), then let the rejection bubble
      return cb(fakeTx);
    });

    // bulkImport must re-throw the error — no partial BulkImportResult returned
    await expect(bulkImport([rowWithSpec], USER_ID)).rejects.toThrow('connection pool timeout');

    // prisma.asset.update (barcode post-processing) must not have been reached
    const mockAssetUpdate = prisma.asset.update as ReturnType<typeof vi.fn>;
    expect(mockAssetUpdate).not.toHaveBeenCalled();
  });

  it('P2002 on serial_number during import $transaction is translated to a plain Error', async () => {
    // bulkImport's contract doesn't expose AppError — it wraps the P2002 in a generic Error.
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    mockAssetFindMany.mockResolvedValue([]);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`serial_number`)',
      { code: 'P2002', clientVersion: '5.0', meta: { target: ['serial_number'] } },
    );
    mockTransaction.mockRejectedValue(p2002);

    const row = makeRow({ rowIndex: 2, serialNumber: 'SN-RACE' });

    await expect(bulkImport([row], USER_ID)).rejects.toThrow(
      'A serial number collision occurred during the import.',
    );
  });
});
