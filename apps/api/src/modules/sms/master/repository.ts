import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type { PrismaTransactionClient } from '../lib/types.js';
import type { VehicleModelRow, VehicleVariantRow } from './types.js';

// ── Vehicle model selects ────────────────────────────────────────────────────

const variantWithUnitsSelect = {
  _count: { select: { units: true } },
} as const;

const modelBaseSelect = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { variants: true } },
  variants: { select: variantWithUnitsSelect },
} as const;

/** Map raw Prisma model row to the VehicleModelRow shape (adds unitCount). */
function toModelRow(
  row: Prisma.SmsVehicleModelGetPayload<{ select: typeof modelBaseSelect }>,
): VehicleModelRow {
  const unitCount = row.variants.reduce((sum, v) => sum + v._count.units, 0);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    variantCount: row._count.variants,
    unitCount,
  };
}

// ── Vehicle variant selects ──────────────────────────────────────────────────

const variantBaseSelect = {
  id: true,
  modelId: true,
  name: true,
  batteryVariant: true,
  color: true,
  colorHex: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  model: { select: { id: true, code: true, name: true } },
  _count: { select: { units: true } },
} as const;

function toVariantRow(
  row: Prisma.SmsVehicleVariantGetPayload<{ select: typeof variantBaseSelect }>,
): VehicleVariantRow {
  return {
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    batteryVariant: row.batteryVariant,
    color: row.color,
    colorHex: row.colorHex,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    model: row.model,
    unitCount: row._count.units,
  };
}

// ── Model queries ────────────────────────────────────────────────────────────

export async function findManyModels(
  includeInactive: boolean,
): Promise<VehicleModelRow[]> {
  const rows = await prisma.smsVehicleModel.findMany({
    where: includeInactive ? undefined : { isActive: true },
    select: modelBaseSelect,
    orderBy: { name: 'asc' },
  });
  return rows.map(toModelRow);
}

export async function findModelById(
  id: string,
  tx?: PrismaTransactionClient,
): Promise<VehicleModelRow | null> {
  const row = await (tx ?? prisma).smsVehicleModel.findUnique({
    where: { id },
    select: modelBaseSelect,
  });
  return row ? toModelRow(row) : null;
}

export async function findModelByCode(
  code: string,
  excludeId?: string,
): Promise<{ id: string; code: string } | null> {
  const where: Prisma.SmsVehicleModelWhereInput = {
    code: { equals: code, mode: 'insensitive' },
  };
  if (excludeId) where.id = { not: excludeId };
  return prisma.smsVehicleModel.findFirst({ where, select: { id: true, code: true } });
}

export async function createModel(
  data: { code: string; name: string },
  tx: PrismaTransactionClient,
): Promise<VehicleModelRow> {
  const row = await tx.smsVehicleModel.create({
    data: { code: data.code, name: data.name },
    select: modelBaseSelect,
  });
  return toModelRow(row);
}

export async function updateModel(
  id: string,
  data: { name?: string; isActive?: boolean },
  tx: PrismaTransactionClient,
): Promise<VehicleModelRow> {
  const row = await tx.smsVehicleModel.update({
    where: { id },
    data,
    select: modelBaseSelect,
  });
  return toModelRow(row);
}

// ── Variant queries ──────────────────────────────────────────────────────────

export async function findManyVariants(opts: {
  modelId?: string;
  includeInactive: boolean;
  search?: string;
}): Promise<VehicleVariantRow[]> {
  const where: Prisma.SmsVehicleVariantWhereInput = {};
  if (!opts.includeInactive) where.isActive = true;
  if (opts.modelId) where.modelId = opts.modelId;
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { batteryVariant: { contains: opts.search, mode: 'insensitive' } },
      { color: { contains: opts.search, mode: 'insensitive' } },
    ];
  }
  const rows = await prisma.smsVehicleVariant.findMany({
    where,
    select: variantBaseSelect,
    orderBy: [{ model: { name: 'asc' } }, { name: 'asc' }, { color: 'asc' }],
  });
  return rows.map(toVariantRow);
}

export async function findVariantById(
  id: string,
  tx?: PrismaTransactionClient,
): Promise<VehicleVariantRow | null> {
  const row = await (tx ?? prisma).smsVehicleVariant.findUnique({
    where: { id },
    select: variantBaseSelect,
  });
  return row ? toVariantRow(row) : null;
}

/** Case-insensitive uniqueness check for (modelId, name, color). */
export async function findVariantByCombo(
  modelId: string,
  name: string,
  color: string,
  excludeId?: string,
): Promise<{ id: string } | null> {
  const where: Prisma.SmsVehicleVariantWhereInput = {
    modelId,
    name: { equals: name, mode: 'insensitive' },
    color: { equals: color, mode: 'insensitive' },
  };
  if (excludeId) where.id = { not: excludeId };
  return prisma.smsVehicleVariant.findFirst({ where, select: { id: true } });
}

export async function createVariant(
  data: {
    modelId: string;
    name: string;
    batteryVariant?: string;
    color: string;
    colorHex?: string;
  },
  tx: PrismaTransactionClient,
): Promise<VehicleVariantRow> {
  const row = await tx.smsVehicleVariant.create({
    data: {
      modelId: data.modelId,
      name: data.name,
      batteryVariant: data.batteryVariant ?? null,
      color: data.color,
      colorHex: data.colorHex ?? null,
    },
    select: variantBaseSelect,
  });
  return toVariantRow(row);
}

export async function updateVariant(
  id: string,
  data: {
    name?: string;
    batteryVariant?: string | null;
    color?: string;
    colorHex?: string | null;
    isActive?: boolean;
  },
  tx: PrismaTransactionClient,
): Promise<VehicleVariantRow> {
  const row = await tx.smsVehicleVariant.update({
    where: { id },
    data,
    select: variantBaseSelect,
  });
  return toVariantRow(row);
}
