import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { generateBarcode, generateQrCode } from '../../lib/barcode.js';
import { generateMovementRef } from '../../utils/movement-ref.js';
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

// Resolve a location id to itself + every descendant in the tree. Used by
// the list filter so picking a parent location ("Pondok Indah") includes
// assets at every floor / sub-area without the caller enumerating each id.
// The CTE materialises in one round-trip; the parameter is bound through
// Prisma's tagged template so SQL injection is impossible.
async function getLocationAndDescendantIds(rootId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE descendants AS (
      SELECT id FROM locations WHERE id = ${rootId}::uuid AND deleted_at IS NULL
      UNION ALL
      SELECT l.id FROM locations l
      INNER JOIN descendants d ON l.parent_id = d.id
      WHERE l.deleted_at IS NULL
    )
    SELECT id FROM descendants
  `;
  return rows.map((r) => r.id);
}

function buildWhereClause(
  filters: AssetListFilters,
  accessibleLocationIds: string[],
  expandedLocationIds?: string[],
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
    // Tree-aware: intersect the requested location's descendant set with
    // the caller's accessible-location scope so role-based location
    // restrictions still apply. If the intersection is empty (e.g. user
    // picked a location they don't have access to), the result is "no
    // matches" rather than a permissions error — same as the rest of the
    // filter UX.
    const allowed = new Set(accessibleLocationIds);
    const expanded = expandedLocationIds ?? [filters.locationId];
    const intersected = expanded.filter((id) => allowed.has(id));
    where.locationId = { in: intersected };
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
    purchasePrice: { purchasePrice: order ?? 'desc' },
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

  // Pre-expand the location filter to a descendant set before building the
  // WHERE clause. Doing it here (instead of inside buildWhereClause) keeps
  // that helper sync and easy to test.
  const expandedLocationIds = query.locationId
    ? await getLocationAndDescendantIds(query.locationId)
    : undefined;

  const where = buildWhereClause(query, accessibleLocationIds, expandedLocationIds);
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

  const categoryCode = product.category.code;

  let asset;
  try {
    asset = await prisma.$transaction(async (tx) => {
      // Serial uniqueness check inside the transaction — pairing this with
      // the catch on P2002 below closes the TOCTOU window where two
      // concurrent inserts could both pass an outside-tx check and then
      // collide at INSERT time.
      if (input.serialNumber) {
        const conflict = await tx.asset.findFirst({
          where: { serialNumber: input.serialNumber, deletedAt: null },
        });
        if (conflict) {
          throw new AppError(
            409,
            'SERIAL_NUMBER_EXISTS',
            'An asset with this serial number already exists',
          );
        }
        // Free up the serial if a soft-deleted asset still holds it.
        // PostgreSQL's UNIQUE allows multiple NULLs so this clears the way
        // for the new row. Idempotent — no-op when no match.
        await tx.asset.updateMany({
          where: { serialNumber: input.serialNumber, deletedAt: { not: null } },
          data: { serialNumber: null },
        });
      }

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

      // Audit log INSIDE the transaction so the asset and its trail commit
      // (or roll back) atomically. Previously this was after the transaction
      // — a crash between commit and audit-write left an unaudited asset.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          resourceType: 'Asset',
          resourceId: created.id,
          newValues: { assetNumber: created.assetNumber, name: created.name },
        },
      });

      return created;
    });
  } catch (err: unknown) {
    // Defense in depth: even with the in-tx check above, a parallel
    // transaction can commit a conflicting row between our check and our
    // insert. Translating the raw Prisma P2002 to a friendly 409 means the
    // caller sees the same shape regardless of timing.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      Array.isArray(err.meta?.['target']) &&
      (err.meta['target'] as string[]).includes('serial_number')
    ) {
      throw new AppError(
        409,
        'SERIAL_NUMBER_EXISTS',
        'An asset with this serial number already exists',
      );
    }
    throw err;
  }

  // Generate barcode and QR code images (outside transaction — non-critical).
  // Failures here don't roll back the asset; the audit row already exists.
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

  // Inside-transaction serial uniqueness check + cleanup + audit log,
  // mirroring the createAsset hardening. P2002 from a concurrent insert is
  // translated to a clean 409 after the transaction by the catch below.
  let assets;
  try {
    assets = await prisma.$transaction(async (tx) => {
      const serialsRequested = inputs
        .map((i) => i.serialNumber)
        .filter((s): s is string => typeof s === 'string' && s.length > 0);

      if (serialsRequested.length > 0) {
        // (a) Live conflicts: hard-stop the whole batch.
        const liveConflicts = await tx.asset.findMany({
          where: { serialNumber: { in: serialsRequested }, deletedAt: null },
          select: { serialNumber: true },
        });
        if (liveConflicts.length > 0) {
          const collided = liveConflicts
            .map((c) => c.serialNumber)
            .filter(Boolean)
            .join(', ');
          throw new AppError(
            409,
            'SERIAL_NUMBER_EXISTS',
            `Serial number(s) already exist on live assets: ${collided}`,
          );
        }

        // (b) Soft-deleted holders: free them up so the new INSERT doesn't
        //     collide on the column-level UNIQUE constraint.
        await tx.asset.updateMany({
          where: {
            serialNumber: { in: serialsRequested },
            deletedAt: { not: null },
          },
          data: { serialNumber: null },
        });
      }

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

      // Audit log INSIDE the transaction — see createAsset for rationale.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          resourceType: 'Asset',
          resourceId: createdAssets.map((a) => a.id).join(','),
          newValues: {
            count: createdAssets.length,
            assetNumbers: createdAssets.map((a) => a.assetNumber),
          },
        },
      });

      return createdAssets;
    });
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      Array.isArray(err.meta?.['target']) &&
      (err.meta['target'] as string[]).includes('serial_number')
    ) {
      throw new AppError(
        409,
        'SERIAL_NUMBER_EXISTS',
        'One or more serial numbers in the batch already exist',
      );
    }
    throw err;
  }

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

  return assets;
}

// ── Update Asset ─────────────────────────────────────────────────────

// Statuses that must only be reached through the movements module, never by
// editing the asset directly. Mapping them here keeps the error message in
// sync with the actual movement types and avoids stringly-typed checks.
const MOVEMENT_ONLY_STATUS_TRANSITIONS: Record<string, string> = {
  LOST: 'Use POST /api/movements with type LOST to set this status.',
  DISPOSED: 'Use POST /api/movements with type DISPOSAL to set this status.',
  IN_MAINTENANCE: 'Use POST /api/movements with type SEND_TO_MAINTENANCE to set this status.',
  BORROWED: 'Use POST /api/movements with type LOAN_OUT to set this status.',
  IDLE: 'Use POST /api/movements (UNASSIGNMENT / LOAN_RETURN / RETURN_FROM_MAINTENANCE) to set this status.',
};

export async function updateAsset(id: string, input: UpdateAssetInput, userId: string) {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  // Detect changes that require an implicit movement to keep the audit
  // trail honest. We compute these up-front so the status-transition guard
  // below can permit an "implied" IDLE/ACTIVE that comes from our own
  // implicit unassign/assign rather than from the user trying to bypass
  // the movements module.
  const locationChanging =
    input.locationId !== undefined && input.locationId !== existing.locationId;
  const userChanging =
    input.assignedToUserId !== undefined &&
    input.assignedToUserId !== existing.assignedToUserId;
  const isAssign = userChanging && input.assignedToUserId !== null;
  const isUnassign = userChanging && input.assignedToUserId === null;

  // Block direct status transitions for movement-driven statuses. Setting
  // the same status again is a no-op and allowed. Exception: when the
  // user's edit also triggers an implicit unassign (→ IDLE) or assign
  // (→ ACTIVE), allow those specific statuses — the system itself is the
  // movement source, which is exactly what the guard exists to enforce.
  if (
    input.status !== undefined &&
    existing.status !== input.status &&
    Object.prototype.hasOwnProperty.call(MOVEMENT_ONLY_STATUS_TRANSITIONS, input.status)
  ) {
    const impliedStatus: string | undefined = isUnassign
      ? 'IDLE'
      : isAssign
        ? 'ACTIVE'
        : undefined;
    if (input.status !== impliedStatus) {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        MOVEMENT_ONLY_STATUS_TRANSITIONS[input.status]!,
      );
    }
  }

  // Validate location if changed
  if (locationChanging) {
    const location = await prisma.location.findUnique({
      where: { id: input.locationId!, deletedAt: null },
    });
    if (!location) {
      throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
    }
  }

  // Check serial number uniqueness on update — live assets only (same
  // rationale as createAsset). The transaction below also frees the serial
  // if a soft-deleted asset still holds it.
  if (input.serialNumber && input.serialNumber !== existing.serialNumber) {
    const duplicate = await prisma.asset.findFirst({
      where: { serialNumber: input.serialNumber, deletedAt: null },
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

  // When we're auto-generating a movement, the implied status takes
  // precedence — the user's explicit `status` in the same edit is
  // intentionally overridden so a single PUT can't desync the asset's
  // status from its assignment (e.g. assigned-to=user but status=IDLE).
  if (isUnassign) {
    updateData.status = 'IDLE';
  } else if (isAssign) {
    updateData.status = 'ACTIVE';
  }

  return prisma.$transaction(async (tx) => {
    // If the serial is changing, free up any soft-deleted asset that still
    // holds the new value so the UNIQUE constraint doesn't reject us.
    if (input.serialNumber && input.serialNumber !== existing.serialNumber) {
      await tx.asset.updateMany({
        where: { serialNumber: input.serialNumber, deletedAt: { not: null } },
        data: { serialNumber: null },
      });
    }
    const updated = await repo.update(id, updateData, tx as PrismaTransactionClient);

    // ── Auto-create movements for location / user changes ─────────────
    // Mirrors the patterns in modules/movements/service.ts so an edit
    // through the asset form leaves the same audit shape as a movement
    // created via the movements module. Status updates are already part
    // of `updateData` above so we don't have to update the asset again.
    if (locationChanging) {
      await repo.createMovementInTransaction(tx as PrismaTransactionClient, {
        referenceNumber: generateMovementRef(),
        movementType: 'LOCATION_TRANSFER',
        status: 'COMPLETED',
        asset: { connect: { id } },
        fromLocation: { connect: { id: existing.locationId } },
        toLocation: { connect: { id: input.locationId! } },
        performedBy: { connect: { id: userId } },
        notes: 'Location updated via asset edit',
      });
    }

    if (isAssign) {
      await repo.createMovementInTransaction(tx as PrismaTransactionClient, {
        referenceNumber: generateMovementRef(),
        movementType: 'ASSIGNMENT',
        status: 'COMPLETED',
        asset: { connect: { id } },
        ...(existing.assignedToUserId && {
          fromUser: { connect: { id: existing.assignedToUserId } },
        }),
        toUser: { connect: { id: input.assignedToUserId! } },
        performedBy: { connect: { id: userId } },
        notes: 'Assignment via asset edit',
      });
    } else if (isUnassign) {
      await repo.createMovementInTransaction(tx as PrismaTransactionClient, {
        referenceNumber: generateMovementRef(),
        movementType: 'UNASSIGNMENT',
        status: 'COMPLETED',
        asset: { connect: { id } },
        ...(existing.assignedToUserId && {
          fromUser: { connect: { id: existing.assignedToUserId } },
        }),
        performedBy: { connect: { id: userId } },
        notes: 'Unassignment via asset edit',
      });
    }

    // Build a diff that only includes fields that actually changed. Comparison
    // is done in-process against `existing` (pre-update) and `updated` (post)
    // so a no-op edit produces empty diff and no audit row.
    const { oldValues, newValues } = buildAssetAuditDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );

    if (Object.keys(newValues).length > 0) {
      await tx.auditLog.create({
        data: {
          userId,
          action: 'UPDATE',
          resourceType: 'Asset',
          resourceId: id,
          oldValues: oldValues as unknown as Prisma.InputJsonValue,
          newValues: newValues as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return updated;
  });
}

// Fields tracked in the audit diff. Anything not in this list will not be
// captured if it changes — add new entries as new mutable fields land.
const AUDIT_TRACKED_ASSET_FIELDS = [
  'name',
  'serialNumber',
  'status',
  'condition',
  'locationId',
  'assignedToUserId',
  'purchaseDate',
  'purchasePrice',
  'currency',
  'vendor',
  'invoiceNumber',
  'invoiceUrl',
  'warrantyStartDate',
  'warrantyEndDate',
  'usefulLifeMonths',
  'notes',
] as const;

type TrackedField = (typeof AUDIT_TRACKED_ASSET_FIELDS)[number];

function buildAssetAuditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const field of AUDIT_TRACKED_ASSET_FIELDS as readonly TrackedField[]) {
    const a = normaliseAuditValue(before[field]);
    const b = normaliseAuditValue(after[field]);
    if (a !== b) {
      oldValues[field] = a;
      newValues[field] = b;
    }
  }
  return { oldValues, newValues };
}

function normaliseAuditValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  // Prisma.Decimal exposes a stable toString() — compare in canonical form.
  if (v && typeof v === 'object' && 'toString' in v && typeof (v as { toString(): string }).toString === 'function') {
    const ctorName = (v as { constructor?: { name?: string } }).constructor?.name;
    if (ctorName === 'Decimal') {
      return (v as { toString(): string }).toString();
    }
  }
  return v;
}

// ── Delete Asset (soft) ──────────────────────────────────────────────

export async function deleteAsset(id: string, userId: string) {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  // Delete is allowed when the asset has reached a terminal lifecycle state
  // (DISPOSED or LOST — both set via the movements module) OR when the asset
  // has no real history yet (only the auto-created INITIAL movement). In
  // every other case the user must first dispose the asset properly so the
  // history isn't orphaned silently.
  const isTerminal = existing.status === 'DISPOSED' || existing.status === 'LOST';
  if (!isTerminal) {
    const nonInitialMovementCount = await prisma.assetMovement.count({
      where: {
        assetId: id,
        movementType: { not: 'INITIAL' },
      },
    });
    if (nonInitialMovementCount > 0) {
      throw new AppError(
        409,
        'ASSET_HAS_MOVEMENTS',
        `This asset has ${nonInitialMovementCount} movement record(s). Use the Movements page to record DISPOSAL or LOST before deleting.`,
      );
    }
  }

  // Soft delete: set deletedAt AND null out serialNumber. The unique constraint
  // on serial_number is column-level, which would block any future row from
  // re-using the serial — even when the original is soft-deleted and no longer
  // visible. PostgreSQL allows multiple NULLs in a UNIQUE column, so blanking
  // the serial here is the simplest way to free it for re-import. The original
  // value is preserved in the audit log below.
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id },
      data: { deletedAt: new Date(), serialNumber: null },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'Asset',
        resourceId: id,
        oldValues: {
          assetNumber: existing.assetNumber,
          name: existing.name,
          serialNumber: existing.serialNumber,
        },
      },
    });
  });
}

// ── Bulk actions ─────────────────────────────────────────────────────
// Shared contract: every bulk operation reports back per-asset success or
// failure. We deliberately use per-asset transactions (not a single big
// one) so a 200-item batch can land 198 results when 2 rows have stale
// data — that's a much better UX than "the whole batch rolled back".
//
// The handlers below all mirror updateAsset's behaviour: location/user
// changes auto-create the corresponding movement records, status flips
// implied by assignment changes are applied, and an audit log row is
// emitted per asset. None of this duplicates updateAsset — they all
// delegate to its transaction body via small inline copies of the
// movement-creation snippet, which is short enough to inline.

export interface BulkActionResult {
  succeeded: string[]; // asset IDs
  failed: Array<{ assetId: string; reason: string }>;
  skipped: Array<{ assetId: string; reason: string }>;
}

// Bulk move to a new location — each affected asset gets a
// LOCATION_TRANSFER movement row. Rows whose locationId already matches
// the target are counted as "skipped" (no-op) rather than rolled back.
export async function bulkMoveAssets(
  assetIds: string[],
  toLocationId: string,
  performedByUserId: string,
  accessibleLocationIds: string[],
): Promise<BulkActionResult> {
  // Validate target location once, up front — same as the per-asset path.
  const target = await prisma.location.findUnique({
    where: { id: toLocationId, deletedAt: null },
  });
  if (!target) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Target location not found');
  }
  const accessibleSet = new Set(accessibleLocationIds);
  if (!accessibleSet.has(toLocationId)) {
    throw new AppError(403, 'LOCATION_FORBIDDEN', 'You do not have access to the target location');
  }

  const result: BulkActionResult = { succeeded: [], failed: [], skipped: [] };

  for (const assetId of assetIds) {
    try {
      const existing = await repo.findById(assetId);
      if (!existing) {
        result.failed.push({ assetId, reason: 'Not found' });
        continue;
      }
      // Out-of-scope assets stay invisible — same as the list query's
      // accessible-locations guard.
      if (!accessibleSet.has(existing.locationId)) {
        result.failed.push({ assetId, reason: 'Not in your accessible locations' });
        continue;
      }
      if (existing.locationId === toLocationId) {
        result.skipped.push({ assetId, reason: 'Already at target location' });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await repo.update(
          assetId,
          { location: { connect: { id: toLocationId } } },
          tx as PrismaTransactionClient,
        );
        await repo.createMovementInTransaction(tx as PrismaTransactionClient, {
          referenceNumber: generateMovementRef(),
          movementType: 'LOCATION_TRANSFER',
          status: 'COMPLETED',
          asset: { connect: { id: assetId } },
          fromLocation: { connect: { id: existing.locationId } },
          toLocation: { connect: { id: toLocationId } },
          performedBy: { connect: { id: performedByUserId } },
          notes: 'Bulk location change',
        });
        await tx.auditLog.create({
          data: {
            userId: performedByUserId,
            action: 'UPDATE',
            resourceType: 'Asset',
            resourceId: assetId,
            oldValues: { locationId: existing.locationId } as unknown as Prisma.InputJsonValue,
            newValues: { locationId: toLocationId } as unknown as Prisma.InputJsonValue,
          },
        });
      });
      result.succeeded.push(assetId);
    } catch (err) {
      result.failed.push({
        assetId,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

// Bulk assign / unassign. `toUserId === null` is the unassignment path; the
// per-asset behaviour matches updateAsset (status flips to IDLE on
// unassign, ACTIVE on assign).
export async function bulkAssignAssets(
  assetIds: string[],
  toUserId: string | null,
  performedByUserId: string,
  accessibleLocationIds: string[],
): Promise<BulkActionResult> {
  if (toUserId) {
    const user = await prisma.user.findUnique({
      where: { id: toUserId, deletedAt: null },
    });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Target user not found');
    }
  }
  const accessibleSet = new Set(accessibleLocationIds);
  const result: BulkActionResult = { succeeded: [], failed: [], skipped: [] };

  for (const assetId of assetIds) {
    try {
      const existing = await repo.findById(assetId);
      if (!existing) {
        result.failed.push({ assetId, reason: 'Not found' });
        continue;
      }
      if (!accessibleSet.has(existing.locationId)) {
        result.failed.push({ assetId, reason: 'Not in your accessible locations' });
        continue;
      }
      if (existing.assignedToUserId === toUserId) {
        result.skipped.push({
          assetId,
          reason: toUserId ? 'Already assigned to this user' : 'Already unassigned',
        });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const updateData: Prisma.AssetUpdateInput = {};
        if (toUserId === null) {
          updateData.assignedTo = { disconnect: true };
          updateData.status = 'IDLE';
        } else {
          updateData.assignedTo = { connect: { id: toUserId } };
          updateData.status = 'ACTIVE';
        }
        await repo.update(assetId, updateData, tx as PrismaTransactionClient);

        await repo.createMovementInTransaction(tx as PrismaTransactionClient, {
          referenceNumber: generateMovementRef(),
          movementType: toUserId === null ? 'UNASSIGNMENT' : 'ASSIGNMENT',
          status: 'COMPLETED',
          asset: { connect: { id: assetId } },
          ...(existing.assignedToUserId && {
            fromUser: { connect: { id: existing.assignedToUserId } },
          }),
          ...(toUserId && { toUser: { connect: { id: toUserId } } }),
          performedBy: { connect: { id: performedByUserId } },
          notes: toUserId ? 'Bulk assignment' : 'Bulk unassignment',
        });

        await tx.auditLog.create({
          data: {
            userId: performedByUserId,
            action: 'UPDATE',
            resourceType: 'Asset',
            resourceId: assetId,
            oldValues: { assignedToUserId: existing.assignedToUserId } as unknown as Prisma.InputJsonValue,
            newValues: { assignedToUserId: toUserId } as unknown as Prisma.InputJsonValue,
          },
        });
      });
      result.succeeded.push(assetId);
    } catch (err) {
      result.failed.push({
        assetId,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

// Bulk condition change. Pure field update — no movements involved (the
// asset's location and assignee don't change), so this is the simplest of
// the three.
export async function bulkChangeAssetCondition(
  assetIds: string[],
  condition: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED',
  performedByUserId: string,
  accessibleLocationIds: string[],
): Promise<BulkActionResult> {
  const accessibleSet = new Set(accessibleLocationIds);
  const result: BulkActionResult = { succeeded: [], failed: [], skipped: [] };

  for (const assetId of assetIds) {
    try {
      const existing = await repo.findById(assetId);
      if (!existing) {
        result.failed.push({ assetId, reason: 'Not found' });
        continue;
      }
      if (!accessibleSet.has(existing.locationId)) {
        result.failed.push({ assetId, reason: 'Not in your accessible locations' });
        continue;
      }
      if (existing.condition === condition) {
        result.skipped.push({ assetId, reason: 'Condition unchanged' });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await repo.update(
          assetId,
          { condition },
          tx as PrismaTransactionClient,
        );
        await tx.auditLog.create({
          data: {
            userId: performedByUserId,
            action: 'UPDATE',
            resourceType: 'Asset',
            resourceId: assetId,
            oldValues: { condition: existing.condition } as unknown as Prisma.InputJsonValue,
            newValues: { condition } as unknown as Prisma.InputJsonValue,
          },
        });
      });
      result.succeeded.push(assetId);
    } catch (err) {
      result.failed.push({
        assetId,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

// Bulk soft delete. Mirrors deleteAsset's preconditions — block when the
// asset has non-INITIAL movements unless it's in a terminal status. The
// loop is sequential because each delete checks live movements; running
// these in parallel risks DB contention with no real benefit at typical
// batch sizes.
export async function bulkDeleteAssets(
  assetIds: string[],
  performedByUserId: string,
  accessibleLocationIds: string[],
): Promise<BulkActionResult> {
  const accessibleSet = new Set(accessibleLocationIds);
  const result: BulkActionResult = { succeeded: [], failed: [], skipped: [] };

  for (const assetId of assetIds) {
    try {
      const existing = await repo.findById(assetId);
      if (!existing) {
        result.failed.push({ assetId, reason: 'Not found' });
        continue;
      }
      if (!accessibleSet.has(existing.locationId)) {
        result.failed.push({ assetId, reason: 'Not in your accessible locations' });
        continue;
      }

      // Re-use the existing delete service so the safety checks (terminal
      // status / no non-INITIAL movements) live in exactly one place.
      await deleteAsset(assetId, performedByUserId);
      result.succeeded.push(assetId);
    } catch (err) {
      // deleteAsset throws AppError with a useful code/message.
      result.failed.push({
        assetId,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
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
