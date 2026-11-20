import { Prisma } from '@prisma/client';
import { AppError } from '../../../middleware/error-handler.js';
import { objectDiff } from '../../../utils/diff.js';
import { smsTransaction } from '../lib/transaction.js';
import { createAuditLog } from '../lib/audit.js';
import type { SmsActor } from '../lib/types.js';
import * as repo from './repository.js';
import type {
  CreateVehicleModelInput,
  UpdateVehicleModelInput,
  ListVehicleModelsQuery,
  CreateVehicleVariantInput,
  UpdateVehicleVariantInput,
  ListVehicleVariantsQuery,
} from './schema.js';

// ── Vehicle models ───────────────────────────────────────────────────────────

export async function listVehicleModels(query: ListVehicleModelsQuery) {
  return repo.findManyModels(query.includeInactive ?? false);
}

export async function createVehicleModel(input: CreateVehicleModelInput, actor: SmsActor) {
  const conflict = await repo.findModelByCode(input.code);
  if (conflict) {
    throw new AppError(
      409,
      'SMS_MODEL_CODE_EXISTS',
      `A vehicle model with code "${input.code}" already exists.`,
    );
  }

  return smsTransaction(async (tx) => {
    let model: Awaited<ReturnType<typeof repo.createModel>>;
    try {
      model = await repo.createModel({ code: input.code, name: input.name }, tx);
    } catch (error) {
      // Two admins creating the same code at once: the pre-check above
      // passes for both and the unique index decides — answer like the
      // pre-check instead of a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          409,
          'SMS_MODEL_CODE_EXISTS',
          `A vehicle model with code "${input.code}" already exists.`,
        );
      }
      throw error;
    }
    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'CREATE',
      resourceType: 'SmsVehicleModel',
      resourceId: model.id,
      newValues: { code: model.code, name: model.name },
    });
    return model;
  });
}

export async function updateVehicleModel(
  id: string,
  input: UpdateVehicleModelInput,
  actor: SmsActor,
) {
  const existing = await repo.findModelById(id);
  if (!existing) {
    throw new AppError(404, 'SMS_MODEL_NOT_FOUND', 'Vehicle model not found.');
  }

  return smsTransaction(async (tx) => {
    const updated = await repo.updateModel(id, input, tx);
    const { oldValues, newValues } = objectDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'UPDATE',
      resourceType: 'SmsVehicleModel',
      resourceId: id,
      oldValues,
      newValues,
    });
    return updated;
  });
}

// ── Vehicle variants ─────────────────────────────────────────────────────────

export async function listVehicleVariants(query: ListVehicleVariantsQuery) {
  return repo.findManyVariants({
    modelId: query.modelId,
    includeInactive: query.includeInactive ?? false,
    search: query.search,
  });
}

export async function createVehicleVariant(input: CreateVehicleVariantInput, actor: SmsActor) {
  // Verify the model exists.
  const model = await repo.findModelById(input.modelId);
  if (!model) {
    throw new AppError(404, 'SMS_MODEL_NOT_FOUND', 'Vehicle model not found.');
  }

  // Case-insensitive uniqueness check for (modelId, name, color).
  const conflict = await repo.findVariantByCombo(input.modelId, input.name, input.color);
  if (conflict) {
    throw new AppError(
      409,
      'SMS_VARIANT_EXISTS',
      `A variant named "${input.name}" in colour "${input.color}" already exists for this model.`,
    );
  }

  return smsTransaction(async (tx) => {
    let variant;
    try {
      variant = await repo.createVariant(
        {
          modelId: input.modelId,
          name: input.name,
          batteryVariant: input.batteryVariant,
          color: input.color,
          colorHex: input.colorHex,
        },
        tx,
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(
          409,
          'SMS_VARIANT_EXISTS',
          `A variant named "${input.name}" in colour "${input.color}" already exists for this model.`,
        );
      }
      throw err;
    }
    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'CREATE',
      resourceType: 'SmsVehicleVariant',
      resourceId: variant.id,
      newValues: {
        modelId: variant.modelId,
        name: variant.name,
        batteryVariant: variant.batteryVariant,
        color: variant.color,
        colorHex: variant.colorHex,
      },
    });
    return variant;
  });
}

export async function updateVehicleVariant(
  id: string,
  input: UpdateVehicleVariantInput,
  actor: SmsActor,
) {
  const existing = await repo.findVariantById(id);
  if (!existing) {
    throw new AppError(404, 'SMS_VARIANT_NOT_FOUND', 'Vehicle variant not found.');
  }

  // If name or color is changing, re-check uniqueness (case-insensitive).
  const newName = input.name ?? existing.name;
  const newColor = input.color ?? existing.color;
  if (
    newName.toLowerCase() !== existing.name.toLowerCase() ||
    newColor.toLowerCase() !== existing.color.toLowerCase()
  ) {
    const conflict = await repo.findVariantByCombo(existing.modelId, newName, newColor, id);
    if (conflict) {
      throw new AppError(
        409,
        'SMS_VARIANT_EXISTS',
        `A variant named "${newName}" in colour "${newColor}" already exists for this model.`,
      );
    }
  }

  return smsTransaction(async (tx) => {
    let updated: Awaited<ReturnType<typeof repo.updateVariant>>;
    try {
      updated = await repo.updateVariant(id, input, tx);
    } catch (error) {
      // Same race as on create: a concurrent edit took the combination first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          409,
          'SMS_VARIANT_EXISTS',
          `A variant named "${newName}" in colour "${newColor}" already exists for this model.`,
        );
      }
      throw error;
    }
    const { oldValues, newValues } = objectDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'UPDATE',
      resourceType: 'SmsVehicleVariant',
      resourceId: id,
      oldValues,
      newValues,
    });
    return updated;
  });
}
