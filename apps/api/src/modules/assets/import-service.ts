import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { generateBarcode, generateQrCode } from '../../lib/barcode.js';
import * as repo from './repository.js';
import type { AssetImportRow } from '../../lib/excel.js';
import type { PrismaTransactionClient } from './types.js';

export interface ImportError {
  rowIndex: number;
  field: string;
  message: string;
  value?: unknown;
}

export interface BulkImportResult {
  created: Array<{ id: string; assetNumber: string; name: string }>;
  failed: ImportError[];
}

// Thread-safe asset number generator (same pattern as main service)
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

/**
 * Bulk import asset rows inside a transaction.
 * Continues past row-level errors; aborts only on DB-level errors.
 *
 * Rows can request creation of a brand new product via `newProductSpec`.
 * Pre-pass: dedupe new-product specs by lowercased name, look up the
 * referenced category by name, create the products in a single
 * transaction, then patch each row's `productId` to the resulting UUID.
 */
export async function bulkImport(
  rows: AssetImportRow[],
  userId: string,
): Promise<BulkImportResult> {
  if (rows.length === 0) {
    return { created: [], failed: [] };
  }

  // ── Pre-pass: materialise any new products referenced via newProductSpec
  // before we kick off the asset-creation transaction. We dedupe by
  // (lowercased name, lowercased category) so that 20 rows referencing
  // "Lenovo ThinkPad X1" produce one product, not twenty.
  const earlyFailed: ImportError[] = [];
  const newProductRows = rows.filter((r) => r.newProductSpec);
  if (newProductRows.length > 0) {
    // Group rows by a stable dedupe key.
    type Spec = NonNullable<AssetImportRow['newProductSpec']>;
    const byKey = new Map<string, { spec: Spec; rowIndices: number[] }>();
    for (const r of newProductRows) {
      const spec = r.newProductSpec!;
      const key = `${spec.name.toLowerCase()}|${spec.categoryName.toLowerCase()}`;
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.rowIndices.push(r.rowIndex);
      } else {
        byKey.set(key, { spec, rowIndices: [r.rowIndex] });
      }
    }

    // Resolve every referenced category by name in one query (case-insensitive).
    const categoryNames = Array.from(new Set(Array.from(byKey.values()).map((b) => b.spec.categoryName)));
    const categories = await prisma.assetCategory.findMany({
      where: {
        OR: [
          { name: { in: categoryNames, mode: 'insensitive' } },
          { code: { in: categoryNames, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, code: true },
    });
    const categoryByName = new Map<string, string>();
    for (const c of categories) {
      categoryByName.set(c.name.toLowerCase(), c.id);
      categoryByName.set(c.code.toLowerCase(), c.id);
    }

    // For each dedupe-bucket, either create the product or attribute the
    // failure to every row that referenced it.
    const productKeyToId = new Map<string, string>();
    await prisma.$transaction(async (tx) => {
      for (const [key, { spec, rowIndices }] of byKey) {
        const categoryId = categoryByName.get(spec.categoryName.toLowerCase());
        if (!categoryId) {
          for (const idx of rowIndices) {
            earlyFailed.push({
              rowIndex: idx,
              field: 'productCategory',
              message: `Category "${spec.categoryName}" not found. See the "Categories" sheet for valid names.`,
              value: spec.categoryName,
            });
          }
          continue;
        }
        const product = await tx.product.create({
          data: {
            name: spec.name,
            ...(spec.brand && { brand: spec.brand }),
            ...(spec.model && { model: spec.model }),
            ...(spec.eanCode && { eanCode: spec.eanCode }),
            category: { connect: { id: categoryId } },
            source: 'MANUAL',
          },
        });
        productKeyToId.set(key, product.id);
      }
    });

    // Patch productId on every row that requested a new product.
    for (const r of newProductRows) {
      const spec = r.newProductSpec!;
      const key = `${spec.name.toLowerCase()}|${spec.categoryName.toLowerCase()}`;
      const resolvedId = productKeyToId.get(key);
      if (resolvedId) {
        r.productId = resolvedId;
        delete r.newProductSpec;
      }
      // else: earlyFailed already has an entry; the row will be filtered out below
    }
  }

  // Filter out rows that we couldn't resolve a product for.
  const failedRowIndices = new Set(earlyFailed.map((e) => e.rowIndex));
  const remainingRows = rows.filter((r) => !failedRowIndices.has(r.rowIndex));

  if (remainingRows.length === 0) {
    return { created: [], failed: earlyFailed };
  }

  // Pre-load all referenced products and locations in two queries
  const productIds = [...new Set(remainingRows.map((r) => r.productId))];
  const locationIds = [...new Set(remainingRows.map((r) => r.locationId))];

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

  // Also pre-check serial number uniqueness for those rows that have them
  const serialNumbers = remainingRows.filter((r) => r.serialNumber).map((r) => r.serialNumber as string);
  const existingSerials = serialNumbers.length > 0
    ? await prisma.asset.findMany({
        where: { serialNumber: { in: serialNumbers } },
        select: { serialNumber: true },
      })
    : [];
  const takenSerials = new Set(existingSerials.map((a) => a.serialNumber as string));

  const failed: ImportError[] = [...earlyFailed];
  const validRows: Array<{ row: AssetImportRow; categoryCode: string }> = [];

  // Validate each row against pre-loaded data
  for (const row of remainingRows) {
    const product = productMap.get(row.productId);
    if (!product) {
      failed.push({ rowIndex: row.rowIndex, field: 'productId', message: `Product not found: ${row.productId}`, value: row.productId });
      continue;
    }

    if (!locationSet.has(row.locationId)) {
      failed.push({ rowIndex: row.rowIndex, field: 'locationId', message: `Location not found: ${row.locationId}`, value: row.locationId });
      continue;
    }

    if (row.serialNumber && takenSerials.has(row.serialNumber)) {
      failed.push({ rowIndex: row.rowIndex, field: 'serialNumber', message: `Serial number already exists: ${row.serialNumber}`, value: row.serialNumber });
      continue;
    }

    // Mark serial as taken so duplicate rows within the import file are caught
    if (row.serialNumber) {
      takenSerials.add(row.serialNumber);
    }

    validRows.push({ row, categoryCode: product.category.code });
  }

  if (validRows.length === 0) {
    return { created: [], failed };
  }

  // Create all valid rows in a single transaction
  const createdAssets: BulkImportResult['created'] = [];

  await prisma.$transaction(async (tx) => {
    for (const { row, categoryCode } of validRows) {
      const assetId = randomUUID();
      const assetNumber = await generateAssetNumber(categoryCode, tx as PrismaTransactionClient);

      const created = await repo.createInTransaction(tx as PrismaTransactionClient, {
        id: assetId,
        assetNumber,
        barcodeValue: assetNumber,
        barcodeType: 'CODE128',
        name: row.name,
        status: row.status ?? 'ACTIVE',
        condition: row.condition ?? 'NEW',
        product: { connect: { id: row.productId } },
        location: { connect: { id: row.locationId } },
        ...(row.assignedToUserId && { assignedTo: { connect: { id: row.assignedToUserId } } }),
        ...(row.serialNumber && { serialNumber: row.serialNumber }),
        purchaseDate: row.purchaseDate ?? null,
        purchasePrice: row.purchasePrice != null ? new Prisma.Decimal(row.purchasePrice) : null,
        currency: row.currency ?? 'IDR',
        vendor: row.vendor ?? null,
        invoiceNumber: row.invoiceNumber ?? null,
        warrantyStartDate: row.warrantyStartDate ?? null,
        warrantyEndDate: row.warrantyEndDate ?? null,
        usefulLifeMonths: row.usefulLifeMonths ?? null,
        notes: row.notes ?? null,
        customFields: Prisma.JsonNull,
        createdBy: { connect: { id: userId } },
      });

      await repo.createMovementInTransaction(tx as PrismaTransactionClient, {
        referenceNumber: generateReferenceNumber(),
        movementType: 'INITIAL',
        status: 'COMPLETED',
        asset: { connect: { id: assetId } },
        toLocation: { connect: { id: row.locationId } },
        ...(row.assignedToUserId && { toUser: { connect: { id: row.assignedToUserId } } }),
        performedBy: { connect: { id: userId } },
        notes: 'Initial asset registration (import)',
      });

      createdAssets.push({ id: assetId, assetNumber, name: created.name });
    }
  });

  // Audit log for the batch
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'IMPORT',
      resourceType: 'Asset',
      resourceId: createdAssets.map((a) => a.id).join(','),
      newValues: {
        count: createdAssets.length,
        assetNumbers: createdAssets.map((a) => a.assetNumber),
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // Generate barcode/QR images in the background — non-critical
  void Promise.allSettled(
    createdAssets.map(async (asset) => {
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
        // Non-critical: barcode generation failures should not propagate
      }
    }),
  );

  return { created: createdAssets, failed };
}
