import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsVehicleModel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    smsVehicleVariant: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/transaction.js', async () => {
  const { prisma } = await import('../../../lib/prisma.js');
  return {
    smsTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
});

vi.mock('./repository.js', () => ({
  findManyModels: vi.fn(),
  findModelById: vi.fn(),
  findModelByCode: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  findManyVariants: vi.fn(),
  findVariantById: vi.fn(),
  findVariantByCombo: vi.fn(),
  createVariant: vi.fn(),
  updateVariant: vi.fn(),
}));

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

import * as repo from './repository.js';
import * as masterService from './service.js';

const mockFindModelByCode = repo.findModelByCode as ReturnType<typeof vi.fn>;
const mockFindModelById = repo.findModelById as ReturnType<typeof vi.fn>;
const mockCreateModel = repo.createModel as ReturnType<typeof vi.fn>;
const mockUpdateModel = repo.updateModel as ReturnType<typeof vi.fn>;
const mockFindVariantByCombo = repo.findVariantByCombo as ReturnType<typeof vi.fn>;
const mockFindVariantById = repo.findVariantById as ReturnType<typeof vi.fn>;
const mockCreateVariant = repo.createVariant as ReturnType<typeof vi.fn>;

const actor = { userId: 'user-1' };

const baseModel = {
  id: 'model-1',
  code: 'BEAT',
  name: 'Honda Beat',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  variantCount: 0,
  unitCount: 0,
};

const baseVariant = {
  id: 'variant-1',
  modelId: 'model-1',
  name: 'Beat Standard',
  batteryVariant: null,
  color: 'Black',
  colorHex: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  model: { id: 'model-1', code: 'BEAT', name: 'Honda Beat' },
  unitCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Vehicle model ─────────────────────────────────────────────────────────────

describe('createVehicleModel', () => {
  it('creates a model when the code is unique', async () => {
    mockFindModelByCode.mockResolvedValue(null);
    mockCreateModel.mockResolvedValue(baseModel);

    const result = await masterService.createVehicleModel(
      { code: 'BEAT', name: 'Honda Beat' },
      actor,
    );
    expect(result).toMatchObject({ id: 'model-1', code: 'BEAT' });
    expect(mockCreateModel).toHaveBeenCalledOnce();
  });

  it('throws SMS_MODEL_CODE_EXISTS when code is already taken', async () => {
    mockFindModelByCode.mockResolvedValue({ id: 'other-model', code: 'BEAT' });

    await expect(
      masterService.createVehicleModel({ code: 'BEAT', name: 'Honda Beat' }, actor),
    ).rejects.toMatchObject({ code: 'SMS_MODEL_CODE_EXISTS', statusCode: 409 });
  });

  it('trims and uppercases the code via schema transform', async () => {
    // Verify that the schema transforms code correctly.
    const { createVehicleModelSchema } = await import('./schema.js');
    const parsed = createVehicleModelSchema.parse({ code: '  beat  ', name: 'Honda Beat' });
    expect(parsed.code).toBe('BEAT');
  });
});

describe('updateVehicleModel', () => {
  it('throws SMS_MODEL_NOT_FOUND when model does not exist', async () => {
    mockFindModelById.mockResolvedValue(null);

    await expect(
      masterService.updateVehicleModel('nonexistent', { name: 'New Name' }, actor),
    ).rejects.toMatchObject({ code: 'SMS_MODEL_NOT_FOUND', statusCode: 404 });
  });

  it('updates name and isActive', async () => {
    const updated = { ...baseModel, name: 'New Name', isActive: false };
    mockFindModelById.mockResolvedValue(baseModel);
    mockUpdateModel.mockResolvedValue(updated);

    const result = await masterService.updateVehicleModel(
      'model-1',
      { name: 'New Name', isActive: false },
      actor,
    );
    expect(result.name).toBe('New Name');
    expect(result.isActive).toBe(false);
  });
});

// ── Vehicle variant ───────────────────────────────────────────────────────────

describe('createVehicleVariant', () => {
  it('creates a variant when combo is unique', async () => {
    mockFindModelById.mockResolvedValue(baseModel);
    mockFindVariantByCombo.mockResolvedValue(null);
    mockCreateVariant.mockResolvedValue(baseVariant);

    const result = await masterService.createVehicleVariant(
      { modelId: 'model-1', name: 'Beat Standard', color: 'Black' },
      actor,
    );
    expect(result.id).toBe('variant-1');
  });

  it('throws SMS_MODEL_NOT_FOUND when model does not exist', async () => {
    mockFindModelById.mockResolvedValue(null);

    await expect(
      masterService.createVehicleVariant(
        { modelId: 'nonexistent', name: 'Beat Standard', color: 'Black' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SMS_MODEL_NOT_FOUND', statusCode: 404 });
  });

  it('throws SMS_VARIANT_EXISTS when (modelId, name, color) combo conflicts', async () => {
    mockFindModelById.mockResolvedValue(baseModel);
    mockFindVariantByCombo.mockResolvedValue({ id: 'existing-variant' });

    await expect(
      masterService.createVehicleVariant(
        { modelId: 'model-1', name: 'Beat Standard', color: 'Black' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SMS_VARIANT_EXISTS', statusCode: 409 });
  });

  it('translates P2002 from the DB to SMS_VARIANT_EXISTS', async () => {
    mockFindModelById.mockResolvedValue(baseModel);
    mockFindVariantByCombo.mockResolvedValue(null);
    mockCreateVariant.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['model_id', 'name', 'color'] },
      }),
    );

    await expect(
      masterService.createVehicleVariant(
        { modelId: 'model-1', name: 'Beat Standard', color: 'Black' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SMS_VARIANT_EXISTS', statusCode: 409 });
  });
});

describe('updateVehicleVariant', () => {
  it('throws SMS_VARIANT_NOT_FOUND when variant does not exist', async () => {
    mockFindVariantById.mockResolvedValue(null);

    await expect(
      masterService.updateVehicleVariant('nonexistent', { name: 'New' }, actor),
    ).rejects.toMatchObject({ code: 'SMS_VARIANT_NOT_FOUND', statusCode: 404 });
  });
});
