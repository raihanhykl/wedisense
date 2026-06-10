import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ── Module mocks ─────────────────────────────────────────────────────────────
// Must be declared before importing the module under test. Vitest hoists these.

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    location: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    asset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    assetMovement: {
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/barcode.js', () => ({
  generateBarcode: vi.fn(),
  generateQrCode: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  findById: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  findByBarcodeValue: vi.fn(),
  createInTransaction: vi.fn(),
  createMovementInTransaction: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  findMovements: vi.fn(),
  countMovements: vi.fn(),
  findMaintenanceLogs: vi.fn(),
  countMaintenanceLogs: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import { generateBarcode, generateQrCode } from '../../lib/barcode.js';
import * as repo from './repository.js';
import type { CreateAssetInput } from './schema.js';
import {
  createAsset,
  updateAsset,
  deleteAsset,
  bulkCreateAssets,
} from './service.js';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockProductFindUnique = prisma.product.findUnique as ReturnType<typeof vi.fn>;
const mockProductFindMany = prisma.product.findMany as ReturnType<typeof vi.fn>;
const mockLocationFindUnique = prisma.location.findUnique as ReturnType<typeof vi.fn>;
const mockLocationFindMany = prisma.location.findMany as ReturnType<typeof vi.fn>;
const mockAssetFindFirst = prisma.asset.findFirst as ReturnType<typeof vi.fn>;
const mockAssetUpdate = prisma.asset.update as ReturnType<typeof vi.fn>;
const mockAssetMovementCount = prisma.assetMovement.count as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockGenerateBarcode = generateBarcode as ReturnType<typeof vi.fn>;
const mockGenerateQrCode = generateQrCode as ReturnType<typeof vi.fn>;
const mockRepoFindById = repo.findById as ReturnType<typeof vi.fn>;
const mockRepoCreateInTx = repo.createInTransaction as ReturnType<typeof vi.fn>;
const mockRepoCreateMovementInTx = repo.createMovementInTransaction as ReturnType<typeof vi.fn>;
const mockRepoUpdate = repo.update as ReturnType<typeof vi.fn>;

// ── Shared test fixtures ──────────────────────────────────────────────────────

const PRODUCT = {
  id: 'prod-1',
  name: 'MacBook Pro',
  category: { code: 'IT' },
};

const LOCATION = {
  id: 'loc-1',
  name: 'Head Office',
  deletedAt: null,
};

const CREATED_ASSET = {
  id: 'asset-1',
  assetNumber: 'WDS-IT-2026-00001',
  name: 'MacBook Pro 14',
  status: 'ACTIVE',
  serialNumber: 'SN-001',
  locationId: 'loc-1',
  assignedToUserId: null,
  purchaseDate: null,
  purchasePrice: null,
  currency: 'IDR',
  vendor: null,
  invoiceNumber: null,
  invoiceUrl: null,
  warrantyStartDate: null,
  warrantyEndDate: null,
  usefulLifeMonths: null,
  notes: null,
  condition: 'NEW',
};

// Full `CreateAssetInput` shape. Zod defaults make these "optional in input"
// at parse time, but the resolved type (z.infer) requires them — so the
// test inputs need to satisfy the resolved type to compile.
const VALID_CREATE_INPUT: CreateAssetInput = {
  productId: 'prod-1',
  locationId: 'loc-1',
  name: 'MacBook Pro 14',
  serialNumber: 'SN-001',
  status: 'ACTIVE',
  condition: 'NEW',
  currency: 'IDR',
};

const USER_ID = 'user-1';

/**
 * Wire up the $transaction mock to run the callback with a mock tx.
 * The tx mirrors the prisma shape we need inside asset service callbacks:
 *   - tx.asset.findFirst   (in-tx serial uniqueness check — createAsset)
 *   - tx.asset.findMany    (in-tx batch serial conflict check — bulkCreateAssets)
 *   - tx.asset.updateMany  (free soft-deleted serial holders)
 *   - tx.auditLog.create   (audit log moved inside the transaction)
 *   - tx.$queryRaw         (thread-safe asset-number generation)
 */
function mockTxThatRuns(overrides: Record<string, unknown> = {}) {
  const tx = {
    asset: {
      findFirst: vi.fn().mockResolvedValue(null),   // no serial conflict by default
      findMany: vi.fn().mockResolvedValue([]),       // no live conflicts by default
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: 1 }]),
    ...overrides,
  };
  mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(tx));
  return tx;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('createAsset()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns the created asset with detail include', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    mockAssetFindFirst.mockResolvedValue(null); // no serial conflict
    mockTxThatRuns();
    mockRepoCreateInTx.mockResolvedValue(CREATED_ASSET);
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockResolvedValue('/uploads/barcodes/asset-1.png');
    mockGenerateQrCode.mockResolvedValue('/uploads/qrcodes/asset-1.png');
    mockAssetUpdate.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});

    const result = await createAsset(VALID_CREATE_INPUT, USER_ID);

    expect(result).toEqual(CREATED_ASSET);
    expect(mockRepoCreateInTx).toHaveBeenCalledOnce();
    expect(mockRepoCreateMovementInTx).toHaveBeenCalledOnce();
    // Confirm asset number format (WDS-{CODE}-{YEAR}-{SEQ5})
    const txCall = mockRepoCreateInTx.mock.calls[0]![1] as { assetNumber: string };
    expect(txCall.assetNumber).toMatch(/^WDS-IT-\d{4}-\d{5}$/);
  });

  it('throws PRODUCT_NOT_FOUND when product is missing', async () => {
    mockProductFindUnique.mockResolvedValue(null);

    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws LOCATION_NOT_FOUND when location does not exist', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(null);

    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'LOCATION_NOT_FOUND',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws SERIAL_NUMBER_EXISTS when a live asset already holds that serial', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    // Serial check now happens INSIDE the transaction via tx.asset.findFirst
    mockTxThatRuns({
      asset: {
        findFirst: vi.fn().mockResolvedValue({ id: 'other-asset', serialNumber: 'SN-001' }),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SERIAL_NUMBER_EXISTS',
    });
    // $transaction IS called — the check is now inside the callback
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('succeeds when only a soft-deleted asset holds the serial, and nulls the soft-deleted serial', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    mockAssetFindFirst.mockResolvedValue(null); // no LIVE conflict
    const tx = mockTxThatRuns();
    mockRepoCreateInTx.mockResolvedValue(CREATED_ASSET);
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockResolvedValue('/uploads/barcodes/asset-1.png');
    mockGenerateQrCode.mockResolvedValue('/uploads/qrcodes/asset-1.png');
    mockAssetUpdate.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});

    await createAsset(VALID_CREATE_INPUT, USER_ID);

    // updateMany should have been called inside tx to free the soft-deleted serial
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { serialNumber: 'SN-001', deletedAt: { not: null } },
      data: { serialNumber: null },
    });
  });

  it('builds asset number from category code + year + zero-padded sequence', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    mockAssetFindFirst.mockResolvedValue(null);
    const tx = mockTxThatRuns();
    // Sequence 42 → should produce WDS-IT-{year}-00042
    tx.$queryRaw.mockResolvedValue([{ current_sequence: 42 }]);
    mockRepoCreateInTx.mockResolvedValue({ ...CREATED_ASSET, assetNumber: 'WDS-IT-2026-00042' });
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockResolvedValue('/barcodes/a.png');
    mockGenerateQrCode.mockResolvedValue('/qrcodes/a.png');
    mockAssetUpdate.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});

    await createAsset(VALID_CREATE_INPUT, USER_ID);

    const created = mockRepoCreateInTx.mock.calls[0]![1] as { assetNumber: string };
    const year = new Date().getFullYear();
    expect(created.assetNumber).toBe(`WDS-IT-${year}-00042`);
  });

  it('calls generateBarcode and generateQrCode after transaction', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    mockAssetFindFirst.mockResolvedValue(null);
    mockTxThatRuns();
    mockRepoCreateInTx.mockResolvedValue(CREATED_ASSET);
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockResolvedValue('/uploads/barcodes/asset-1.png');
    mockGenerateQrCode.mockResolvedValue('/uploads/qrcodes/asset-1.png');
    mockAssetUpdate.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});

    await createAsset(VALID_CREATE_INPUT, USER_ID);

    expect(mockGenerateBarcode).toHaveBeenCalledWith('asset-1', 'WDS-IT-2026-00001');
    expect(mockGenerateQrCode).toHaveBeenCalledWith('asset-1');
  });

  it('silently swallows barcode/QR generation failure (does not throw)', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    mockAssetFindFirst.mockResolvedValue(null);
    mockTxThatRuns();
    mockRepoCreateInTx.mockResolvedValue(CREATED_ASSET);
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockRejectedValue(new Error('disk full'));
    mockGenerateQrCode.mockRejectedValue(new Error('disk full'));
    mockAuditLogCreate.mockResolvedValue({});

    // Should not throw despite barcode failure
    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).resolves.toEqual(CREATED_ASSET);
  });

  it('writes audit log with action=CREATE after successful creation', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    const tx = mockTxThatRuns();
    mockRepoCreateInTx.mockResolvedValue(CREATED_ASSET);
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockResolvedValue('/b.png');
    mockGenerateQrCode.mockResolvedValue('/q.png');
    mockAssetUpdate.mockResolvedValue({});

    await createAsset(VALID_CREATE_INPUT, USER_ID);

    // Audit log is now written INSIDE the transaction via tx.auditLog.create
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        action: 'CREATE',
        resourceType: 'Asset',
        resourceId: 'asset-1',
        newValues: expect.objectContaining({
          assetNumber: 'WDS-IT-2026-00001',
          name: 'MacBook Pro 14',
        }),
      }),
    });
    // prisma.auditLog.create (outside tx) must NOT be called
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('skips serial uniqueness check when no serialNumber provided', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    const tx = mockTxThatRuns();
    mockRepoCreateInTx.mockResolvedValue({ ...CREATED_ASSET, serialNumber: null });
    mockRepoCreateMovementInTx.mockResolvedValue({});
    mockGenerateBarcode.mockResolvedValue('/b.png');
    mockGenerateQrCode.mockResolvedValue('/q.png');
    mockAssetUpdate.mockResolvedValue({});

    const input = { ...VALID_CREATE_INPUT, serialNumber: undefined };
    await createAsset(input, USER_ID);

    // Neither outer prisma.asset.findFirst nor tx.asset.findFirst should be called
    expect(mockAssetFindFirst).not.toHaveBeenCalled();
    expect(tx.asset.findFirst).not.toHaveBeenCalled();
  });

  it('P2002 on serial_number from $transaction is translated to AppError(409, SERIAL_NUMBER_EXISTS)', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`serial_number`)',
      { code: 'P2002', clientVersion: '5.0', meta: { target: ['serial_number'] } },
    );
    // $transaction throws P2002 (simulates concurrent-insert race)
    mockTransaction.mockRejectedValue(p2002);

    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SERIAL_NUMBER_EXISTS',
    });
  });

  it('P2002 on a different field passes through unchanged', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);

    const p2002Other = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`asset_number`)',
      { code: 'P2002', clientVersion: '5.0', meta: { target: ['asset_number'] } },
    );
    mockTransaction.mockRejectedValue(p2002Other);

    // Must re-throw as-is, NOT converted to AppError
    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('non-P2002 Prisma errors pass through unchanged', async () => {
    mockProductFindUnique.mockResolvedValue(PRODUCT);
    mockLocationFindUnique.mockResolvedValue(LOCATION);

    const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.0',
    });
    mockTransaction.mockRejectedValue(p2025);

    await expect(createAsset(VALID_CREATE_INPUT, USER_ID)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateAsset()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Widen the field types so individual tests can override `assignedToUserId`
  // with a string user ID via spread. Without the explicit `: string | null`
  // TypeScript narrows it to `null` from the fixture's literal.
  const EXISTING_ASSET: {
    id: string;
    name: string;
    status: string;
    condition: string;
    locationId: string;
    assignedToUserId: string | null;
    serialNumber: string | null;
    purchaseDate: Date | null;
    purchasePrice: number | null;
    currency: string;
    vendor: string | null;
    invoiceNumber: string | null;
    invoiceUrl: string | null;
    warrantyStartDate: Date | null;
    warrantyEndDate: Date | null;
    usefulLifeMonths: number | null;
    notes: string | null;
  } = {
    id: 'asset-1',
    name: 'Old Name',
    status: 'ACTIVE',
    condition: 'NEW',
    locationId: 'loc-1',
    assignedToUserId: null,
    serialNumber: 'SN-OLD',
    purchaseDate: null,
    purchasePrice: null,
    currency: 'IDR',
    vendor: null,
    invoiceNumber: null,
    invoiceUrl: null,
    warrantyStartDate: null,
    warrantyEndDate: null,
    usefulLifeMonths: null,
    notes: null,
  };

  const UPDATED_ASSET = {
    ...EXISTING_ASSET,
    name: 'New Name',
  };

  function makeTxForUpdate(updateResult = UPDATED_ASSET) {
    const tx = {
      asset: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
      mockRepoUpdate.mockResolvedValue(updateResult);
      return cb(tx);
    });
    return tx;
  }

  it('happy path: runs in $transaction and returns the updated asset', async () => {
    mockRepoFindById.mockResolvedValue(EXISTING_ASSET);
    mockLocationFindUnique.mockResolvedValue(LOCATION);
    makeTxForUpdate();

    const result = await updateAsset('asset-1', { name: 'New Name' }, USER_ID);

    expect(result).toEqual(UPDATED_ASSET);
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockRepoUpdate).toHaveBeenCalledOnce();
  });

  it.each(['LOST', 'DISPOSED', 'IN_MAINTENANCE', 'BORROWED', 'IDLE'])(
    'blocks direct transition to %s (MOVEMENT_ONLY)',
    async (status) => {
      mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, status: 'ACTIVE' });

      await expect(
        updateAsset('asset-1', { status: status as 'LOST' | 'DISPOSED' | 'IN_MAINTENANCE' | 'BORROWED' | 'IDLE' }, USER_ID),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    },
  );

  it('allows same-status no-op (ACTIVE → ACTIVE)', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, status: 'ACTIVE' });
    makeTxForUpdate(EXISTING_ASSET);

    await expect(
      updateAsset('asset-1', { status: 'ACTIVE' }, USER_ID),
    ).resolves.toBeDefined();
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('audit diff includes only changed fields', async () => {
    mockRepoFindById.mockResolvedValue(EXISTING_ASSET);
    const tx = makeTxForUpdate(UPDATED_ASSET);

    await updateAsset('asset-1', { name: 'New Name' }, USER_ID);

    // The auditLog.create call on tx should have name in newValues
    const auditCall = tx.auditLog.create.mock.calls[0]![0] as {
      data: { oldValues: Record<string, unknown>; newValues: Record<string, unknown> };
    };
    expect(auditCall.data.newValues).toHaveProperty('name', 'New Name');
    expect(auditCall.data.oldValues).toHaveProperty('name', 'Old Name');
    // Unchanged fields should NOT appear in newValues
    expect(auditCall.data.newValues).not.toHaveProperty('status');
    expect(auditCall.data.newValues).not.toHaveProperty('currency');
  });

  it('writes no audit row when no field actually changes (no-op edit)', async () => {
    const sameAsset = { ...EXISTING_ASSET };
    mockRepoFindById.mockResolvedValue(sameAsset);
    const tx = makeTxForUpdate(sameAsset);

    // Sending the same name as existing
    await updateAsset('asset-1', { name: 'Old Name' }, USER_ID);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws ASSET_NOT_FOUND when asset does not exist', async () => {
    mockRepoFindById.mockResolvedValue(null);

    await expect(updateAsset('no-such-id', { name: 'X' }, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ASSET_NOT_FOUND',
    });
  });

  it('throws SERIAL_NUMBER_EXISTS when serial collides with a live OTHER asset', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, serialNumber: 'SN-OLD' });
    mockAssetFindFirst.mockResolvedValue({ id: 'other-asset', serialNumber: 'SN-NEW' });

    await expect(
      updateAsset('asset-1', { serialNumber: 'SN-NEW' }, USER_ID),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SERIAL_NUMBER_EXISTS',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('allows serial update when soft-deleted asset holds it, and frees the soft-deleted serial in tx', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, serialNumber: 'SN-OLD' });
    // findFirst only returns live assets — a soft-deleted match means findFirst returns null
    mockAssetFindFirst.mockResolvedValue(null);
    const tx = makeTxForUpdate({ ...EXISTING_ASSET, serialNumber: 'SN-NEW' });

    await updateAsset('asset-1', { serialNumber: 'SN-NEW' }, USER_ID);

    // tx.asset.updateMany called to free soft-deleted serial
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { serialNumber: 'SN-NEW', deletedAt: { not: null } },
      data: { serialNumber: null },
    });
  });

  // ── Auto-create movements on location / assignment change ─────────
  // Closes the audit gap where editing an asset's location or assigned
  // user via PUT used to write only an audit_log row, leaving the
  // movements timeline (which the asset detail page reads from) silently
  // out of sync with the asset's actual state.

  it('creates a LOCATION_TRANSFER movement when locationId changes', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, locationId: 'loc-1' });
    mockLocationFindUnique.mockResolvedValue({ id: 'loc-2', deletedAt: null });
    makeTxForUpdate({ ...EXISTING_ASSET, locationId: 'loc-2' });

    await updateAsset('asset-1', { locationId: 'loc-2' }, USER_ID);

    expect(mockRepoCreateMovementInTx).toHaveBeenCalledTimes(1);
    const call = mockRepoCreateMovementInTx.mock.calls[0]![1] as {
      movementType: string;
      fromLocation: { connect: { id: string } };
      toLocation: { connect: { id: string } };
      asset: { connect: { id: string } };
    };
    expect(call.movementType).toBe('LOCATION_TRANSFER');
    expect(call.fromLocation.connect.id).toBe('loc-1');
    expect(call.toLocation.connect.id).toBe('loc-2');
    expect(call.asset.connect.id).toBe('asset-1');
  });

  it('does NOT create a movement when locationId is sent but unchanged', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, locationId: 'loc-1' });
    makeTxForUpdate();

    // Same locationId — should be a no-op for movement creation
    await updateAsset('asset-1', { locationId: 'loc-1' }, USER_ID);

    expect(mockRepoCreateMovementInTx).not.toHaveBeenCalled();
  });

  it('does NOT create a movement when only non-movement fields (name/notes) change', async () => {
    mockRepoFindById.mockResolvedValue(EXISTING_ASSET);
    makeTxForUpdate(UPDATED_ASSET);

    await updateAsset('asset-1', { name: 'New Name', notes: 'updated' }, USER_ID);

    expect(mockRepoCreateMovementInTx).not.toHaveBeenCalled();
  });

  it('creates ASSIGNMENT movement when user is added (null → user-X)', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, assignedToUserId: null });
    makeTxForUpdate({ ...EXISTING_ASSET, assignedToUserId: 'user-x' });

    await updateAsset('asset-1', { assignedToUserId: 'user-x' }, USER_ID);

    expect(mockRepoCreateMovementInTx).toHaveBeenCalledTimes(1);
    const call = mockRepoCreateMovementInTx.mock.calls[0]![1] as {
      movementType: string;
      toUser: { connect: { id: string } };
      fromUser?: { connect: { id: string } };
    };
    expect(call.movementType).toBe('ASSIGNMENT');
    expect(call.toUser.connect.id).toBe('user-x');
    // No previous assignee → no fromUser
    expect(call.fromUser).toBeUndefined();
  });

  it('creates UNASSIGNMENT movement when user is removed (user-X → null)', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, assignedToUserId: 'user-x' });
    makeTxForUpdate({ ...EXISTING_ASSET, assignedToUserId: null });

    await updateAsset('asset-1', { assignedToUserId: null }, USER_ID);

    expect(mockRepoCreateMovementInTx).toHaveBeenCalledTimes(1);
    const call = mockRepoCreateMovementInTx.mock.calls[0]![1] as {
      movementType: string;
      fromUser?: { connect: { id: string } };
    };
    expect(call.movementType).toBe('UNASSIGNMENT');
    expect(call.fromUser?.connect.id).toBe('user-x');
  });

  it('creates ASSIGNMENT (with fromUser) when user changes A → B', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, assignedToUserId: 'user-a' });
    makeTxForUpdate({ ...EXISTING_ASSET, assignedToUserId: 'user-b' });

    await updateAsset('asset-1', { assignedToUserId: 'user-b' }, USER_ID);

    expect(mockRepoCreateMovementInTx).toHaveBeenCalledTimes(1);
    const call = mockRepoCreateMovementInTx.mock.calls[0]![1] as {
      movementType: string;
      fromUser?: { connect: { id: string } };
      toUser: { connect: { id: string } };
    };
    expect(call.movementType).toBe('ASSIGNMENT');
    expect(call.fromUser?.connect.id).toBe('user-a');
    expect(call.toUser.connect.id).toBe('user-b');
  });

  it('creates TWO movements when both location AND user change in the same edit', async () => {
    mockRepoFindById.mockResolvedValue({
      ...EXISTING_ASSET,
      locationId: 'loc-1',
      assignedToUserId: null,
    });
    mockLocationFindUnique.mockResolvedValue({ id: 'loc-2', deletedAt: null });
    makeTxForUpdate({ ...EXISTING_ASSET, locationId: 'loc-2', assignedToUserId: 'user-x' });

    await updateAsset(
      'asset-1',
      { locationId: 'loc-2', assignedToUserId: 'user-x' },
      USER_ID,
    );

    expect(mockRepoCreateMovementInTx).toHaveBeenCalledTimes(2);
    const types = mockRepoCreateMovementInTx.mock.calls.map(
      (c) => (c[1] as { movementType: string }).movementType,
    );
    expect(types).toEqual(expect.arrayContaining(['LOCATION_TRANSFER', 'ASSIGNMENT']));
  });

  it('forces status=IDLE when implicit unassign occurs (overrides form value)', async () => {
    mockRepoFindById.mockResolvedValue({
      ...EXISTING_ASSET,
      status: 'ACTIVE',
      assignedToUserId: 'user-x',
    });
    // status IDLE is normally MOVEMENT_ONLY-blocked, but because we're
    // also unassigning, the guard permits IDLE as the implied status.
    makeTxForUpdate({ ...EXISTING_ASSET, status: 'IDLE', assignedToUserId: null });

    await updateAsset(
      'asset-1',
      { assignedToUserId: null },
      USER_ID,
    );

    // repo.update should have received status=IDLE in the update data.
    expect(mockRepoUpdate).toHaveBeenCalledOnce();
    const updateCallArgs = mockRepoUpdate.mock.calls[0]!;
    const updateData = updateCallArgs[1] as { status?: string };
    expect(updateData.status).toBe('IDLE');
  });

  it('forces status=ACTIVE when implicit assign occurs (overrides form value)', async () => {
    mockRepoFindById.mockResolvedValue({
      ...EXISTING_ASSET,
      status: 'IDLE',
      assignedToUserId: null,
    });
    makeTxForUpdate({ ...EXISTING_ASSET, status: 'ACTIVE', assignedToUserId: 'user-x' });

    await updateAsset(
      'asset-1',
      { assignedToUserId: 'user-x' },
      USER_ID,
    );

    expect(mockRepoUpdate).toHaveBeenCalledOnce();
    const updateData = mockRepoUpdate.mock.calls[0]![1] as { status?: string };
    expect(updateData.status).toBe('ACTIVE');
  });

  it('still blocks setting status=LOST directly when no implicit movement is happening', async () => {
    mockRepoFindById.mockResolvedValue({ ...EXISTING_ASSET, status: 'ACTIVE' });

    await expect(
      updateAsset('asset-1', { status: 'LOST' }, USER_ID),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_STATUS_TRANSITION',
    });
  });

  it('permits status=IDLE in the form when the same edit unassigns (system is the movement source)', async () => {
    mockRepoFindById.mockResolvedValue({
      ...EXISTING_ASSET,
      status: 'ACTIVE',
      assignedToUserId: 'user-x',
    });
    makeTxForUpdate({ ...EXISTING_ASSET, status: 'IDLE', assignedToUserId: null });

    // Form sends status=IDLE *and* assignedToUserId=null — the guard
    // should let this through because the implicit UNASSIGNMENT is exactly
    // what justifies IDLE.
    await expect(
      updateAsset('asset-1', { status: 'IDLE', assignedToUserId: null }, USER_ID),
    ).resolves.toBeDefined();
  });

  it('updates makeTxForUpdate to expose assetMovement.create — sanity check that the helper still works post-refactor', async () => {
    // No-op test that just ensures the existing fixture doesn't crash after
    // the implicit-movement changes.
    mockRepoFindById.mockResolvedValue(EXISTING_ASSET);
    makeTxForUpdate();
    await updateAsset('asset-1', { name: 'Whatever' }, USER_ID);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteAsset()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDeleteTx() {
    const tx = {
      asset: {
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    return tx;
  }

  it('allows deletion of a DISPOSED asset without checking movements', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'asset-1', status: 'DISPOSED', assetNumber: 'WDS-IT-2026-00001', name: 'X', serialNumber: null });
    mockAssetMovementCount.mockResolvedValue(0);
    makeDeleteTx();

    await expect(deleteAsset('asset-1', USER_ID)).resolves.toBeUndefined();
    // Movement count should NOT be called for terminal statuses
    expect(mockAssetMovementCount).not.toHaveBeenCalled();
  });

  it('allows deletion of a LOST asset without checking movements', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'asset-1', status: 'LOST', assetNumber: 'WDS-IT-2026-00001', name: 'X', serialNumber: null });
    makeDeleteTx();

    await expect(deleteAsset('asset-1', USER_ID)).resolves.toBeUndefined();
    expect(mockAssetMovementCount).not.toHaveBeenCalled();
  });

  it('allows deletion of an ACTIVE asset that has only INITIAL movement', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'asset-1', status: 'ACTIVE', assetNumber: 'WDS-IT-2026-00001', name: 'X', serialNumber: null });
    mockAssetMovementCount.mockResolvedValue(0); // no non-INITIAL movements
    makeDeleteTx();

    await expect(deleteAsset('asset-1', USER_ID)).resolves.toBeUndefined();
  });

  it('blocks deletion of ACTIVE asset with non-INITIAL movements → 409 ASSET_HAS_MOVEMENTS', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'asset-1', status: 'ACTIVE', assetNumber: 'WDS-IT-2026-00001', name: 'X', serialNumber: null });
    mockAssetMovementCount.mockResolvedValue(2); // has LOCATION_TRANSFER etc.

    await expect(deleteAsset('asset-1', USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_HAS_MOVEMENTS',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('nulls serialNumber AND sets deletedAt in the same transaction', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'asset-1', status: 'ACTIVE', assetNumber: 'WDS-IT-2026-00001', name: 'X', serialNumber: 'SN-123' });
    mockAssetMovementCount.mockResolvedValue(0);
    const tx = makeDeleteTx();

    await deleteAsset('asset-1', USER_ID);

    expect(tx.asset.update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { deletedAt: expect.any(Date), serialNumber: null },
    });
  });

  it('audit log captures assetNumber, name, AND serialNumber in oldValues', async () => {
    const asset = { id: 'asset-1', status: 'ACTIVE', assetNumber: 'WDS-IT-2026-00001', name: 'My Asset', serialNumber: 'SN-XYZ' };
    mockRepoFindById.mockResolvedValue(asset);
    mockAssetMovementCount.mockResolvedValue(0);
    const tx = makeDeleteTx();

    await deleteAsset('asset-1', USER_ID);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        action: 'DELETE',
        resourceType: 'Asset',
        resourceId: 'asset-1',
        oldValues: {
          assetNumber: 'WDS-IT-2026-00001',
          name: 'My Asset',
          serialNumber: 'SN-XYZ',
        },
      }),
    });
  });

  it('throws ASSET_NOT_FOUND when asset does not exist', async () => {
    mockRepoFindById.mockResolvedValue(null);

    await expect(deleteAsset('no-such', USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ASSET_NOT_FOUND',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('bulkCreateAssets()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const BULK_INPUT = [
    { ...VALID_CREATE_INPUT, name: 'MacBook Pro 14 - Unit 1' },
    { ...VALID_CREATE_INPUT, name: 'MacBook Pro 14 - Unit 2', serialNumber: 'SN-002' },
  ];

  function makeBulkTx() {
    const tx = {
      asset: {
        findMany: vi.fn().mockResolvedValue([]),   // no live serial conflicts by default
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),     // audit log now inside the transaction
      },
      $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: 1 }]),
    };
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
      mockRepoCreateInTx.mockResolvedValue({ ...CREATED_ASSET, name: 'created' });
      mockRepoCreateMovementInTx.mockResolvedValue({});
      return cb(tx);
    });
    return tx;
  }

  it('pre-validates all products; throws PRODUCT_NOT_FOUND on first missing', async () => {
    mockProductFindMany.mockResolvedValue([]); // no products found
    mockLocationFindMany.mockResolvedValue([LOCATION]);

    await expect(bulkCreateAssets(BULK_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('pre-validates all locations; throws LOCATION_NOT_FOUND on first missing', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([]); // no locations found

    await expect(bulkCreateAssets(BULK_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'LOCATION_NOT_FOUND',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('inserts all valid inputs in a single $transaction', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    makeBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    await bulkCreateAssets(BULK_INPUT, USER_ID);

    expect(mockTransaction).toHaveBeenCalledOnce();
    // Both assets should be created in the same tx
    expect(mockRepoCreateInTx).toHaveBeenCalledTimes(BULK_INPUT.length);
  });

  it('frees soft-deleted serials in a batch updateMany inside the transaction', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    const tx = makeBulkTx();
    mockAuditLogCreate.mockResolvedValue({});

    await bulkCreateAssets(BULK_INPUT, USER_ID);

    // serialNumber from unit 2 is 'SN-002' (unit 1 has VALID_CREATE_INPUT.serialNumber = 'SN-001')
    expect(tx.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serialNumber: { in: expect.arrayContaining(['SN-001', 'SN-002']) },
          deletedAt: { not: null },
        }),
        data: { serialNumber: null },
      }),
    );
  });

  it('writes a single audit log row for the entire batch', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);
    const tx = makeBulkTx();

    await bulkCreateAssets(BULK_INPUT, USER_ID);

    // Audit log is written INSIDE the transaction via tx.auditLog.create
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    const auditData = tx.auditLog.create.mock.calls[0]![0] as {
      data: { action: string; newValues: { count: number } };
    };
    expect(auditData.data.action).toBe('CREATE');
    expect(auditData.data.newValues).toHaveProperty('count', BULK_INPUT.length);
    // prisma.auditLog.create (outside tx) must NOT be called
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('live serial conflict check (tx.asset.findMany) fires BEFORE any repo.createInTransaction call', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);

    const callOrder: string[] = [];

    const tx = {
      asset: {
        findMany: vi.fn().mockImplementation(() => {
          callOrder.push('findMany');
          // Return a conflict — this should abort before any insert
          return Promise.resolve([{ serialNumber: 'SN-001' }]);
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: 1 }]),
    };

    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
      mockRepoCreateInTx.mockImplementation(() => {
        callOrder.push('createInTransaction');
        return Promise.resolve({ ...CREATED_ASSET, name: 'created' });
      });
      return cb(tx);
    });

    await expect(bulkCreateAssets(BULK_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SERIAL_NUMBER_EXISTS',
    });

    // findMany ran, but no insert happened
    expect(callOrder).toContain('findMany');
    expect(callOrder).not.toContain('createInTransaction');
  });

  it('P2002 on serial_number from $transaction is translated to AppError(409, SERIAL_NUMBER_EXISTS)', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`serial_number`)',
      { code: 'P2002', clientVersion: '5.0', meta: { target: ['serial_number'] } },
    );
    mockTransaction.mockRejectedValue(p2002);

    await expect(bulkCreateAssets(BULK_INPUT, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SERIAL_NUMBER_EXISTS',
    });
  });

  it('P2002 on a different field passes through unchanged in bulkCreateAssets', async () => {
    mockProductFindMany.mockResolvedValue([PRODUCT]);
    mockLocationFindMany.mockResolvedValue([LOCATION]);

    const p2002Other = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`barcode_value`)',
      { code: 'P2002', clientVersion: '5.0', meta: { target: ['barcode_value'] } },
    );
    mockTransaction.mockRejectedValue(p2002Other);

    await expect(bulkCreateAssets(BULK_INPUT, USER_ID)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});
