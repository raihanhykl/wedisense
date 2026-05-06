import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { generateBarcode, generateQrCode } from '../../lib/barcode.js';
import * as repo from './repository.js';
import type { CreateAssetInput, UpdateAssetInput } from './schema.js';
import type { AssetListFilters, AssetSortField, PrismaTransactionClient } from './types.js';
import type { PaginationQuery } from '@wedisense/shared';
import { randomUUID } from 'crypto';

// ── Asset Number Generation (thread-safe) ────────────────────────────

async function generateAssetNumber(categoryCode: string, tx: PrismaTransactionClient): Promise<string> {
  const year = new Date().getFullYear();

  const result = await (tx as unknown as { $queryRaw: typeof prisma.$queryRaw }).$queryRaw<
    Array<{ current_sequence: number }>
  >`
    INSERT INTO asset_number_sequences (id, category_code, year, current_sequence)
    VALUES (gen_random_uuid(), ${categoryCode}, ${year}, 1)
    ON CONFLICT (category_code, year)
    DO UPDATE SET current_sequence = asset_number_sequences.current_sequence + 1
    RETURNING current_sequence
  `;

  const seq = result[0]!.current_sequence;
  return `WDS-${categoryCode}-${year}-${String(seq).padStart(5, '0')}`;
}

function generateReferenceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomUUID().slice(0, 6).toUpperCase();
  return `MOV-${ts}-${rand}`;
}

// ── Build where clause ───────────────────────────────────────────────

function buildWhereClause(
  filters: AssetListFilters,
  accessibleLocationIds: string[],
): Prisma.AssetWhereInput {
  const where: Prisma.AssetWhereInput = {
    deletedAt: null,
    locationId: { in: accessibleLocationIds },
  };

  if (filters.status) {
    where.status = filters.status as Prisma.EnumAssetStatusFilter;
  }

  if (filters.condition) {
    where.condition = filters.condition as Prisma.EnumAssetConditionFilter;
  }

  if (filters.categoryId) {
    where.product = { categoryId: filters.categoryId };
  }

  if (filters.locationId) {
    // Further scope within accessible locations
    where.locationId = filters.locationId;
  }

  if (filters.assignedToUserId) {
    where.assignedToUserId = filters.assignedToUserId;
  }

  if (filters.purchaseDateFrom || filters.purchaseDateTo) {
    where.purchaseDate = {
      ...(filters.purchaseDateFrom && { gte: filters.purchaseDateFrom }),
      ...(filters.purchaseDateTo && { lte: filters.purchaseDateTo }),
    };
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { assetNumber: { contains: filters.search, mode: 'insensitive' } },
      { serialNumber: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

function buildOrderBy(sort?: string, order?: 'asc' | 'desc'): Prisma.AssetOrderByWithRelationInput {
  const validSorts: Record<AssetSortField, Prisma.AssetOrderByWithRelationInput> = {
    assetNumber: { assetNumber: order ?? 'desc' },
    name: { name: order ?? 'desc' },
    status: { status: order ?? 'desc' },
    purchaseDate: { purchaseDate: order ?? 'desc' },
    createdAt: { createdAt: order ?? 'desc' },
  };

  if (sort && sort in validSorts) {
    return validSorts[sort as AssetSortField];
  }

  return { createdAt: order ?? 'desc' };
}

// ── List Assets ──────────────────────────────────────────────────────

export async function listAssets(
  query: PaginationQuery & AssetListFilters,
  accessibleLocationIds: string[],
) {
  const { skip, take, page, limit } = parsePagination(query);
  const where = buildWhereClause(query, accessibleLocationIds);
  const orderBy = buildOrderBy(query.sort, query.order);

  const [assets, total] = await Promise.all([
    repo.findMany({ skip, take, where, orderBy }),
    repo.count(where),
  ]);

  return { assets, meta: buildPaginationMeta(page, limit, total) };
}

// ── Get Asset ────────────────────────────────────────────────────────

export async function getAsset(id: string) {
  const asset = await repo.findById(id);
  if (!asset) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }
  return asset;
}

// ── Get Asset by Barcode ─────────────────────────────────────────────

export async function getAssetByBarcode(barcodeValue: string) {
  const asset = await repo.findByBarcodeValue(barcodeValue);
  if (!asset) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found for the given barcode');
  }
  return asset;
}

// ── Create Asset ─────────────────────────────────────────────────────

export async function createAsset(input: CreateAssetInput, userId: string) {
  // Validate product exists and get category code
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { category: { select: { code: true } } },
  });
  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  // Validate location exists
  const location = await prisma.location.findUnique({
    where: { id: input.locationId, deletedAt: null },
  });
  if (!location) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }

  // Check serial number uniqueness
  if (input.serialNumber) {
    const existing = await prisma.asset.findUnique({
      where: { serialNumber: input.serialNumber },
    });
    if (existing) {
      throw new AppError(409, 'SERIAL_NUMBER_EXISTS', 'An asset with this serial number already exists');
    }
  }

  const categoryCode = product.category.code;

  const asset = await prisma.$transaction(async (tx) => {
    const assetNumber = await generateAssetNumber(categoryCode, tx);
    const assetId = randomUUID();

    const created = await repo.createInTransaction(tx, {
      id: assetId,
      assetNumber,
      barcodeValue: assetNumber,
      barcodeType: 'CODE128',
      name: input.name,
      status: input.status ?? 'ACTIVE',
      condition: input.condition ?? 'NEW',
      product: { connect: { id: input.productId } },
      location: { connect: { id: input.locationId } },
      ...(input.assignedToUserId && { assignedTo: { connect: { id: input.assignedToUserId } } }),
      ...(input.serialNumber && { serialNumber: input.serialNumber }),
      purchaseDate: input.purchaseDate ?? null,
      purchasePrice: input.purchasePrice != null ? new Prisma.Decimal(input.purchasePrice) : null,
      currency: input.currency ?? 'IDR',
      vendor: input.vendor ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      warrantyStartDate: input.warrantyStartDate ?? null,
      warrantyEndDate: input.warrantyEndDate ?? null,
      usefulLifeMonths: input.usefulLifeMonths ?? null,
      notes: input.notes ?? null,
      customFields: input.customFields
        ? (input.customFields as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      createdBy: { connect: { id: userId } },
    });

    // Create INITIAL movement
    await repo.createMovementInTransaction(tx, {
      referenceNumber: generateReferenceNumber(),
      movementType: 'INITIAL',
      status: 'COMPLETED',
      asset: { connect: { id: created.id } },
      toLocation: { connect: { id: input.locationId } },
      ...(input.assignedToUserId && { toUser: { connect: { id: input.assignedToUserId } } }),
      performedBy: { connect: { id: userId } },
      notes: 'Initial asset registration',
    });

    return created;
  });

  // Generate barcode and QR code images (outside transaction - non-critical)
  try {
    const [barcodeUrl, qrUrl] = await Promise.all([
      generateBarcode(asset.id, asset.assetNumber),
      generateQrCode(asset.id),
    ]);
    await prisma.asset.update({
      where: { id: asset.id },
      data: { barcodeImageUrl: `${barcodeUrl}|${qrUrl}` },
    });
  } catch {
    // Non-critical: barcode/QR generation failure should not fail the request
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      resourceType: 'Asset',
      resourceId: asset.id,
      newValues: { assetNumber: asset.assetNumber, name: asset.name },
    },
  });

  return asset;
}

// ── Bulk Create Assets ───────────────────────────────────────────────

export async function bulkCreateAssets(inputs: CreateAssetInput[], userId: string) {
  // Pre-validate all products and locations
  const productIds = [...new Set(inputs.map((i) => i.productId))];
  const locationIds = [...new Set(inputs.map((i) => i.locationId))];

  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: { select: { code: true } } },
    }),
    prisma.location.findMany({
      where: { id: { in: locationIds }, deletedAt: null },
    }),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const locationSet = new Set(locations.map((l) => l.id));

  for (const input of inputs) {
    if (!productMap.has(input.productId)) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product not found: ${input.productId}`);
    }
    if (!locationSet.has(input.locationId)) {
      throw new AppError(404, 'LOCATION_NOT_FOUND', `Location not found: ${input.locationId}`);
    }
  }

  const assets = await prisma.$transaction(async (tx) => {
    const createdAssets = [];

    for (const input of inputs) {
      const product = productMap.get(input.productId)!;
      const categoryCode = product.category.code;
      const assetNumber = await generateAssetNumber(categoryCode, tx);
      const assetId = randomUUID();

      const created = await repo.createInTransaction(tx, {
        id: assetId,
        assetNumber,
        barcodeValue: assetNumber,
        barcodeType: 'CODE128',
        name: input.name,
        status: input.status ?? 'ACTIVE',
        condition: input.condition ?? 'NEW',
        product: { connect: { id: input.productId } },
        location: { connect: { id: input.locationId } },
        ...(input.assignedToUserId && { assignedTo: { connect: { id: input.assignedToUserId } } }),
        ...(input.serialNumber && { serialNumber: input.serialNumber }),
        purchaseDate: input.purchaseDate ?? null,
        purchasePrice: input.purchasePrice != null ? new Prisma.Decimal(input.purchasePrice) : null,
        currency: input.currency ?? 'IDR',
        vendor: input.vendor ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceUrl: input.invoiceUrl ?? null,
        warrantyStartDate: input.warrantyStartDate ?? null,
        warrantyEndDate: input.warrantyEndDate ?? null,
        usefulLifeMonths: input.usefulLifeMonths ?? null,
        notes: input.notes ?? null,
        customFields: input.customFields
          ? (input.customFields as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        createdBy: { connect: { id: userId } },
      });

      // Create INITIAL movement
      await repo.createMovementInTransaction(tx, {
        referenceNumber: generateReferenceNumber(),
        movementType: 'INITIAL',
        status: 'COMPLETED',
        asset: { connect: { id: created.id } },
        toLocation: { connect: { id: input.locationId } },
        ...(input.assignedToUserId && { toUser: { connect: { id: input.assignedToUserId } } }),
        performedBy: { connect: { id: userId } },
        notes: 'Initial asset registration (bulk)',
      });

      createdAssets.push(created);
    }

    return createdAssets;
  });

  // Generate barcode/QR images in background (non-critical)
  void Promise.allSettled(
    assets.map(async (asset) => {
      try {
        const [barcodeUrl, qrUrl] = await Promise.all([
          generateBarcode(asset.id, asset.assetNumber),
          generateQrCode(asset.id),
        ]);
        await prisma.asset.update({
          where: { id: asset.id },
          data: { barcodeImageUrl: `${barcodeUrl}|${qrUrl}` },
        });
      } catch {
        // Non-critical
      }
    }),
  );

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      resourceType: 'Asset',
      resourceId: assets.map((a) => a.id).join(','),
      newValues: { count: assets.length, assetNumbers: assets.map((a) => a.assetNumber) },
    },
  });

  return assets;
}

// ── Update Asset ─────────────────────────────────────────────────────

export async function updateAsset(id: string, input: UpdateAssetInput, userId: string) {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  // Block direct status transitions to LOST or DISPOSED — must go through movements module
  if (
    input.status !== undefined &&
    (input.status === 'LOST' || input.status === 'DISPOSED') &&
    existing.status !== input.status
  ) {
    throw new AppError(
      400,
      'INVALID_STATUS_TRANSITION',
      'Use POST /api/movements with type LOST or DISPOSAL to set this status',
    );
  }

  // Validate location if changed
  if (input.locationId && input.locationId !== existing.locationId) {
    const location = await prisma.location.findUnique({
      where: { id: input.locationId, deletedAt: null },
    });
    if (!location) {
      throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
    }
  }

  // Check serial number uniqueness on update
  if (input.serialNumber && input.serialNumber !== existing.serialNumber) {
    const duplicate = await prisma.asset.findUnique({
      where: { serialNumber: input.serialNumber },
    });
    if (duplicate && duplicate.id !== id) {
      throw new AppError(409, 'SERIAL_NUMBER_EXISTS', 'An asset with this serial number already exists');
    }
  }

  const updateData: Prisma.AssetUpdateInput = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.serialNumber !== undefined) updateData.serialNumber = input.serialNumber;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.condition !== undefined) updateData.condition = input.condition;
  if (input.locationId !== undefined) updateData.location = { connect: { id: input.locationId } };
  if (input.assignedToUserId !== undefined) {
    if (input.assignedToUserId === null) {
      updateData.assignedTo = { disconnect: true };
    } else {
      updateData.assignedTo = { connect: { id: input.assignedToUserId } };
    }
  }
  if (input.purchaseDate !== undefined) updateData.purchaseDate = input.purchaseDate;
  if (input.purchasePrice !== undefined) {
    updateData.purchasePrice = input.purchasePrice != null
      ? new Prisma.Decimal(input.purchasePrice)
      : null;
  }
  if (input.currency !== undefined) updateData.currency = input.currency;
  if (input.vendor !== undefined) updateData.vendor = input.vendor;
  if (input.invoiceNumber !== undefined) updateData.invoiceNumber = input.invoiceNumber;
  if (input.invoiceUrl !== undefined) updateData.invoiceUrl = input.invoiceUrl;
  if (input.warrantyStartDate !== undefined) updateData.warrantyStartDate = input.warrantyStartDate;
  if (input.warrantyEndDate !== undefined) updateData.warrantyEndDate = input.warrantyEndDate;
  if (input.usefulLifeMonths !== undefined) updateData.usefulLifeMonths = input.usefulLifeMonths;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.customFields !== undefined) {
    updateData.customFields = input.customFields
      ? (input.customFields as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }

  const updated = await repo.update(id, updateData);

  // Audit log with old/new values
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'UPDATE',
      resourceType: 'Asset',
      resourceId: id,
      oldValues: {
        name: existing.name,
        status: existing.status,
        condition: existing.condition,
        locationId: existing.locationId,
        assignedToUserId: existing.assignedToUserId,
      },
      newValues: {
        name: updated.name,
        status: updated.status,
        condition: updated.condition,
        locationId: updated.locationId,
        assignedToUserId: updated.assignedToUserId,
      },
    },
  });

  return updated;
}

// ── Delete Asset (soft) ──────────────────────────────────────────────

export async function deleteAsset(id: string, userId: string) {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  await repo.softDelete(id);

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'DELETE',
      resourceType: 'Asset',
      resourceId: id,
      oldValues: { assetNumber: existing.assetNumber, name: existing.name },
    },
  });
}

// ── Movement History ─────────────────────────────────────────────────

export async function getMovements(assetId: string, query: PaginationQuery) {
  // Verify asset exists
  const asset = await repo.findById(assetId);
  if (!asset) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  const { skip, take, page, limit } = parsePagination(query);

  const [movements, total] = await Promise.all([
    repo.findMovements({ assetId, skip, take }),
    repo.countMovements(assetId),
  ]);

  return { movements, meta: buildPaginationMeta(page, limit, total) };
}

// ── Maintenance History ──────────────────────────────────────────────

export async function getMaintenanceLogs(assetId: string, query: PaginationQuery) {
  const asset = await repo.findById(assetId);
  if (!asset) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  const { skip, take, page, limit } = parsePagination(query);

  const [logs, total] = await Promise.all([
    repo.findMaintenanceLogs({ assetId, skip, take }),
    repo.countMaintenanceLogs(assetId),
  ]);

  return { logs, meta: buildPaginationMeta(page, limit, total) };
}
