import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { generateBarcode, generateQrCode } from '../../lib/barcode.js';
import * as repo from './repository.js';
import { resolveInitialStatus } from './service.js';
import {
  assertBatchAcceptsAssets,
  bumpBatchAssetCountWithCascade,
} from '../procurement-batches/service.js';
import { AppError } from '../../middleware/error-handler.js';
import { loadCategoryCodePathResolver } from '../../utils/category-code-path.js';
import type { AssetImportRow } from '../../lib/excel.js';
import type { PrismaTransactionClient } from './types.js';

export interface ImportError {
  rowIndex: number;
  field: string;
  message: string;
  value?: unknown;
}

export interface ImportSkip {
  rowIndex: number;
  /** Why this row was skipped — "duplicate_serial" today, room for more later. */
  reason: 'duplicate_serial';
  /** Asset that already exists (so the UI can offer a "view existing" link). */
  existing: { id: string; assetNumber: string; name: string; serialNumber: string };
}

export interface BulkImportResult {
  created: Array<{ id: string; assetNumber: string; name: string }>;
  /** Rows that were intentionally skipped because the asset already exists.
   *  Treated as success, not failure — re-running the same import file is
   *  idempotent. */
  skipped: ImportSkip[];
  failed: ImportError[];
}

/**
 * Pre-flight: tell the caller which of the resolved rows would be created
 * vs skipped, without performing any inserts. Used by the preview endpoint
 * so the user sees "3 already exist, 1 new" in the Review step instead of
 * being surprised at the Result step.
 */
export async function previewImportDedup(
  rows: AssetImportRow[],
): Promise<{ willSkip: ImportSkip[] }> {
  const serialNumbers = rows
    .filter((r) => r.serialNumber)
    .map((r) => r.serialNumber as string);
  if (serialNumbers.length === 0) {
    return { willSkip: [] };
  }
  const existing = await prisma.asset.findMany({
    where: { serialNumber: { in: serialNumbers }, deletedAt: null },
    select: { id: true, assetNumber: true, name: true, serialNumber: true },
  });
  const bySerial = new Map<string, (typeof existing)[number]>();
  for (const a of existing) {
    if (a.serialNumber) bySerial.set(a.serialNumber, a);
  }
  const willSkip: ImportSkip[] = [];
  for (const r of rows) {
    if (!r.serialNumber) continue;
    const hit = bySerial.get(r.serialNumber);
    if (hit) {
      willSkip.push({
        rowIndex: r.rowIndex,
        reason: 'duplicate_serial',
        existing: {
          id: hit.id,
          assetNumber: hit.assetNumber,
          name: hit.name,
          serialNumber: hit.serialNumber!,
        },
      });
    }
  }
  return { willSkip };
}

// Thread-safe asset number generator (same pattern as main service).
// `categoryCodePath` is the full hierarchical code path (e.g. "IT/NB") —
// see utils/category-code-path.ts. Sequences are keyed per (path, year).
async function generateAssetNumber(categoryCodePath: string, tx: PrismaTransactionClient): Promise<string> {
  // Defensive: an empty path would mint a malformed "WDS--YYYY-NNNNN".
  if (!categoryCodePath) {
    throw new AppError(500, 'CATEGORY_PATH_EMPTY', 'Could not resolve category code path for asset numbering');
  }
  const year = new Date().getFullYear();

  const result = await (tx as unknown as { $queryRaw: typeof prisma.$queryRaw }).$queryRaw<
    Array<{ current_sequence: number }>
  >`
    INSERT INTO asset_number_sequences (id, category_code, year, current_sequence)
    VALUES (gen_random_uuid(), ${categoryCodePath}, ${year}, 1)
    ON CONFLICT (category_code, year)
    DO UPDATE SET current_sequence = asset_number_sequences.current_sequence + 1
    RETURNING current_sequence
  `;

  const seq = result[0]!.current_sequence;
  return `WDS-${categoryCodePath}-${year}-${String(seq).padStart(5, '0')}`;
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
export interface BulkImportProgressUpdate {
  /** Rows that have been classified (created, skipped, or failed) so far. */
  processed: number;
  /** Total rows the caller submitted. */
  total: number;
  /** Live tallies for richer progress UIs. */
  created: number;
  skipped: number;
  failed: number;
}

export interface BulkImportOptions {
  /** Invoked at coarse-grained checkpoints during processing — once after
   *  the new-product pre-pass and once per asset insertion. The async job
   *  wires this to Redis so the frontend can poll progress; sync callers
   *  typically don't pass it. Throwing here cancels the import. */
  onProgress?: (update: BulkImportProgressUpdate) => Promise<void> | void;
  /** Phase 17: optional procurement batch to link every created asset to.
   *  The batch is validated inside the same transaction that inserts the
   *  assets, and its assetCount counter (plus the parent PO's, if any)
   *  bumps by the number of created assets atomically with the inserts. */
  procurementBatchId?: string;
}

export async function bulkImport(
  rows: AssetImportRow[],
  userId: string,
  options: BulkImportOptions = {},
): Promise<BulkImportResult> {
  const { onProgress, procurementBatchId } = options;
  const total = rows.length;
  if (total === 0) {
    return { created: [], skipped: [], failed: [] };
  }

  // Lightweight helper so we don't repeat the same call shape. Swallows
  // progress-callback errors — a failing UI hook must never bring down a
  // successful import.
  async function reportProgress(processed: number, created: number, skipped: number, failed: number) {
    if (!onProgress) return;
    try {
      await onProgress({ processed, total, created, skipped, failed });
    } catch {
      // Intentionally ignored.
    }
  }

  // ── Read-only pre-flight: resolve categories so we can decide which
  //    new-product rows are creatable. The actual product INSERTS happen
  //    inside the single asset-creation transaction below — keeping them
  //    in the same atom prevents the previous "products committed but
  //    asset transaction rolled back" orphan scenario.
  const earlyFailed: ImportError[] = [];
  const newProductRows = rows.filter((r) => r.newProductSpec);

  type Spec = NonNullable<AssetImportRow['newProductSpec']>;
  // bucket carries everything the transaction needs to insert the product
  // and resolve the asset's category-code dependency.
  const newProductBuckets = new Map<
    string,
    { spec: Spec; rowIndices: number[]; categoryId: string }
  >();
  const newProductRowKey = new Map<number, string>(); // rowIndex → dedupe-key

  if (newProductRows.length > 0) {
    const provisionalBuckets = new Map<string, { spec: Spec; rowIndices: number[] }>();
    for (const r of newProductRows) {
      const spec = r.newProductSpec!;
      const key = `${spec.name.toLowerCase()}|${spec.categoryName.toLowerCase()}`;
      const bucket = provisionalBuckets.get(key);
      if (bucket) {
        bucket.rowIndices.push(r.rowIndex);
      } else {
        provisionalBuckets.set(key, { spec, rowIndices: [r.rowIndex] });
      }
      newProductRowKey.set(r.rowIndex, key);
    }

    const categoryNames = Array.from(new Set(Array.from(provisionalBuckets.values()).map((b) => b.spec.categoryName)));
    const categories = await prisma.assetCategory.findMany({
      where: {
        OR: [
          { name: { in: categoryNames, mode: 'insensitive' } },
          { code: { in: categoryNames, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, code: true },
    });
    const categoryByName = new Map<string, { id: string; code: string }>();
    for (const c of categories) {
      categoryByName.set(c.name.toLowerCase(), { id: c.id, code: c.code });
      categoryByName.set(c.code.toLowerCase(), { id: c.id, code: c.code });
    }

    // Either stash for later insertion (resolved category) or attribute
    // failure to every row that referenced it (unresolvable category).
    for (const [key, { spec, rowIndices }] of provisionalBuckets) {
      const category = categoryByName.get(spec.categoryName.toLowerCase());
      if (!category) {
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
      newProductBuckets.set(key, {
        spec,
        rowIndices,
        categoryId: category.id,
      });
    }
  }

  // Filter out rows that failed the new-product pre-flight.
  const failedRowIndices = new Set(earlyFailed.map((e) => e.rowIndex));
  const remainingRows = rows.filter((r) => !failedRowIndices.has(r.rowIndex));

  // Checkpoint after pre-flight.
  await reportProgress(earlyFailed.length, 0, 0, earlyFailed.length);

  if (remainingRows.length === 0) {
    return { created: [], skipped: [], failed: earlyFailed };
  }

  // Pre-load all referenced existing products and locations. Rows that
  // request a brand new product have a natural-key string in `productId` —
  // they don't show up in this lookup; their category id comes from the
  // bucket resolved above. All lookups (including the category code-path
  // resolver) are read-only and safe to do outside the transaction.
  const existingProductIds = [
    ...new Set(
      remainingRows
        .filter((r) => !newProductRowKey.has(r.rowIndex))
        .map((r) => r.productId),
    ),
  ];
  const locationIds = [...new Set(remainingRows.map((r) => r.locationId))];

  // Note: `findMany({ where: { id: { in: [] } } })` is a no-op fast-path in
  // Prisma — no DB round-trip when the array is empty — so unconditionally
  // calling it keeps the return type uniform without adding latency for
  // the all-new-products case.
  const [products, locations, resolveCategoryCodePath] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: existingProductIds } },
    }),
    prisma.location.findMany({
      where: { id: { in: locationIds }, deletedAt: null },
    }),
    loadCategoryCodePathResolver(prisma),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const locationSet = new Set(locations.map((l) => l.id));

  // Pre-fetch live assets that already hold any of the serial numbers in this
  // import. These are NOT errors — re-running the same file should be
  // idempotent, so we classify those rows as "skipped" and present them to the
  // user as informational. Soft-deleted assets are excluded; their serials are
  // also nulled out on delete (see deleteAsset), so the unique constraint
  // does not block re-import of the same serial after disposal.
  const serialNumbers = remainingRows
    .filter((r) => r.serialNumber)
    .map((r) => r.serialNumber as string);
  const existingAssetsBySerial = serialNumbers.length > 0
    ? await prisma.asset.findMany({
        where: {
          serialNumber: { in: serialNumbers },
          deletedAt: null,
        },
        select: { id: true, assetNumber: true, name: true, serialNumber: true },
      })
    : [];
  const existingBySerial = new Map<string, (typeof existingAssetsBySerial)[number]>();
  for (const a of existingAssetsBySerial) {
    if (a.serialNumber) existingBySerial.set(a.serialNumber, a);
  }

  const failed: ImportError[] = [...earlyFailed];
  const skipped: ImportSkip[] = [];
  const validRows: Array<{ row: AssetImportRow; categoryCodePath: string; newProductKey?: string }> = [];
  // Within-file dedupe: if two rows share the same serial, only the first
  // succeeds — the second is reported as duplicate without hitting the DB.
  const seenSerialsInFile = new Set<string>();

  // Validate each row against pre-loaded data
  for (const row of remainingRows) {
    // Resolve the category code path: existing-product rows lookup against
    // productMap; new-product rows pull from the bucket we resolved before
    // entering the transaction.
    const newProductKey = newProductRowKey.get(row.rowIndex);
    let categoryCodePath: string;
    if (newProductKey) {
      const bucket = newProductBuckets.get(newProductKey);
      if (!bucket) {
        // Should be unreachable — earlyFailed already covered missing
        // categories — but defensive in case bucket logic changes.
        failed.push({
          rowIndex: row.rowIndex,
          field: 'productCategory',
          message: 'New-product spec resolution failed unexpectedly',
          value: row.productId,
        });
        continue;
      }
      categoryCodePath = resolveCategoryCodePath(bucket.categoryId);
    } else {
      const product = productMap.get(row.productId);
      if (!product) {
        failed.push({ rowIndex: row.rowIndex, field: 'productId', message: `Product not found: ${row.productId}`, value: row.productId });
        continue;
      }
      categoryCodePath = resolveCategoryCodePath(product.categoryId);
    }

    if (!locationSet.has(row.locationId)) {
      failed.push({ rowIndex: row.rowIndex, field: 'locationId', message: `Location not found: ${row.locationId}`, value: row.locationId });
      continue;
    }

    if (row.serialNumber) {
      // Already-imported in a previous run — skip without erroring.
      const existing = existingBySerial.get(row.serialNumber);
      if (existing) {
        skipped.push({
          rowIndex: row.rowIndex,
          reason: 'duplicate_serial',
          existing: {
            id: existing.id,
            assetNumber: existing.assetNumber,
            name: existing.name,
            serialNumber: existing.serialNumber!,
          },
        });
        continue;
      }
      // Duplicate serial *within this file* — still an error since both rows
      // are claiming the same physical asset.
      if (seenSerialsInFile.has(row.serialNumber)) {
        failed.push({
          rowIndex: row.rowIndex,
          field: 'serialNumber',
          message: `Serial number "${row.serialNumber}" appears more than once in this file.`,
          value: row.serialNumber,
        });
        continue;
      }
      seenSerialsInFile.add(row.serialNumber);
    }

    validRows.push({ row, categoryCodePath, ...(newProductKey && { newProductKey }) });
  }

  // Checkpoint after pre-validation: skipped & failed are now final, only
  // the actual inserts remain to be reported.
  await reportProgress(
    earlyFailed.length + skipped.length + (failed.length - earlyFailed.length),
    0,
    skipped.length,
    failed.length,
  );

  if (validRows.length === 0) {
    return { created: [], skipped, failed };
  }

  // Single transaction: create new products, free stale serials, insert
  // assets + initial movements, write audit log. If any step fails, ALL
  // get rolled back — no more orphaned products from a partial import.
  const createdAssets: BulkImportResult['created'] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // Phase 17: validate batch acceptance up-front, inside the tx, so
      // a rejection rolls back any sequence bumps below. One round-trip
      // for the whole import — much better than per-row.
      if (procurementBatchId) {
        await assertBatchAcceptsAssets(procurementBatchId, tx as PrismaTransactionClient);
      }

      // Step A: materialise new products in this transaction.
      const newProductIds = new Map<string, string>(); // bucketKey → productId
      for (const [key, { spec, categoryId }] of newProductBuckets) {
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
        newProductIds.set(key, product.id);
      }

      // Step B: free up serial numbers held by soft-deleted assets so the
      // new INSERTs don't collide with the column-level UNIQUE constraint.
      const serialsToFreeUp = validRows
        .filter((v) => v.row.serialNumber)
        .map((v) => v.row.serialNumber as string);
      if (serialsToFreeUp.length > 0) {
        await tx.asset.updateMany({
          where: {
            serialNumber: { in: serialsToFreeUp },
            deletedAt: { not: null },
          },
          data: { serialNumber: null },
        });
      }

      // Step C: insert assets + initial movements.
      for (const { row, categoryCodePath, newProductKey } of validRows) {
        // Resolve the productId for new-product rows from the freshly
        // inserted product. Existing-product rows already have a UUID.
        const productId = newProductKey
          ? newProductIds.get(newProductKey)!
          : row.productId;

        const assetId = randomUUID();
        const assetNumber = await generateAssetNumber(categoryCodePath, tx as PrismaTransactionClient);

        const created = await repo.createInTransaction(tx as PrismaTransactionClient, {
          id: assetId,
          assetNumber,
          barcodeValue: assetNumber,
          barcodeType: 'CODE128',
          name: row.name,
          status: resolveInitialStatus(row.assignedToUserId),
          condition: row.condition ?? 'NEW',
          product: { connect: { id: productId } },
          location: { connect: { id: row.locationId } },
          ...(row.assignedToUserId && { assignedTo: { connect: { id: row.assignedToUserId } } }),
          ...(row.serialNumber && { serialNumber: row.serialNumber }),
          ...(procurementBatchId && {
            procurementBatch: { connect: { id: procurementBatchId } },
          }),
          purchaseDate: row.purchaseDate ?? null,
          purchasePrice: row.purchasePrice != null ? new Prisma.Decimal(row.purchasePrice) : null,
          currency: row.currency ?? 'IDR',
          // Phase 17 v2 — Excel import stays on the legacy free-text
          // column. A future tier will resolve names to vendor FKs
          // (similar to product matching) and populate vendorId here.
          vendorLegacy: row.vendor ?? null,
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

        // Per-row progress callback. The transaction is held open during the
        // callback's `await`, which is fine for the Redis writes the async
        // job performs — they're sub-millisecond and don't touch the DB.
        await reportProgress(
          skipped.length + failed.length + createdAssets.length,
          createdAssets.length,
          skipped.length,
          failed.length,
        );
      }

      // Phase 17: cascade asset count to the batch + parent PO in one
      // shot — bulkImport ships rows by the hundred, so a per-row bump
      // would issue hundreds of UPDATEs. Single increment with the final
      // delta keeps the tx tight.
      if (procurementBatchId && createdAssets.length > 0) {
        await bumpBatchAssetCountWithCascade(
          procurementBatchId,
          createdAssets.length,
          tx as PrismaTransactionClient,
        );
      }

      // Step D: audit log INSIDE the transaction so the asset records and
      // the audit trail commit/roll-back as one. Previously this lived
      // outside the transaction and could leave assets unaudited.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'IMPORT',
          resourceType: 'Asset',
          resourceId: createdAssets.map((a) => a.id).join(',') || 'bulk',
          newValues: {
            created: createdAssets.length,
            skipped: skipped.length,
            failed: failed.length,
            assetNumbers: createdAssets.map((a) => a.assetNumber),
            ...(procurementBatchId && { procurementBatchId }),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  } catch (err: unknown) {
    // Translate P2002 (concurrent serial conflict) to a clean error class.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      Array.isArray(err.meta?.['target']) &&
      (err.meta['target'] as string[]).includes('serial_number')
    ) {
      // Re-thrown as a generic error — the caller (import-router) will
      // surface it; bulkImport's contract doesn't expose AppError here.
      throw new Error('A serial number collision occurred during the import. Please retry.');
    }
    throw err;
  }

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

  return { created: createdAssets, skipped, failed };
}
