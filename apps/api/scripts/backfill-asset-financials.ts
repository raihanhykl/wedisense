/**
 * One-off backfill: fill the NULL purchase date / unit price / vendor /
 * invoice number of every asset that was received under a procurement
 * batch, using the batch + purchase order as the source of truth.
 *
 * Needed once after deploying batch→asset financial inheritance: assets
 * added through "Add Assets" before that change carry no financials even
 * though their PO knows every one of them. Safe to re-run — the sync is a
 * gap-filler and never overwrites a value already on an asset. Every
 * asset it touches gets an audit row (actor = system, user_id NULL).
 *
 * Usage (from the repo root, against the DATABASE_URL in apps/api/.env):
 *   pnpm --filter api exec tsx scripts/backfill-asset-financials.ts
 *   pnpm --filter api exec tsx scripts/backfill-asset-financials.ts --dry-run
 */

import { prisma } from '../src/lib/prisma.js';
import { syncBatchAssetFinancials } from '../src/modules/procurement-batches/service.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const batches = await prisma.procurementBatch.findMany({
    where: { deletedAt: null, assets: { some: { deletedAt: null } } },
    select: { id: true, batchNumber: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`[backfill] ${batches.length} batch(es) with linked assets${dryRun ? ' (dry run)' : ''}`);

  if (dryRun) {
    const missing = await prisma.asset.count({
      where: {
        deletedAt: null,
        procurementBatchId: { not: null },
        OR: [
          { purchaseDate: null },
          { purchasePrice: null },
          { vendorId: null },
          { invoiceNumber: null },
        ],
      },
    });
    console.log(`[backfill] ${missing} batch-linked asset(s) have at least one empty financial field`);
    return;
  }

  let checked = 0;
  let updated = 0;
  for (const batch of batches) {
    const result = await syncBatchAssetFinancials(batch.id, null);
    checked += result.assetsChecked;
    updated += result.assetsUpdated;
    console.log(
      `[backfill] ${batch.batchNumber}: ${result.assetsUpdated}/${result.assetsChecked} asset(s) updated`,
    );
  }
  console.log(`[backfill] done — checked ${checked} asset(s), updated ${updated}`);
}

main()
  .catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
