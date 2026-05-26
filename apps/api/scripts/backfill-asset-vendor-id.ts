/**
 * Phase 17 v2 — standalone backfill entrypoint.
 *
 * Most of the time you don't need to run this manually: `pnpm prisma:seed`
 * now invokes the same backfill logic at the end of every seed run. Use
 * this standalone script only when you need to re-run the backfill
 * without re-running the full seed (e.g. after a manual data import or
 * a partial production migration).
 *
 * The actual logic lives in `prisma/seed-backfill.ts` so the seed and
 * this script can never drift.
 *
 * Usage:
 *   pnpm --filter api exec tsx scripts/backfill-asset-vendor-id.ts
 */

import { PrismaClient } from '@prisma/client';
import { backfillAssetVendorIds } from '../prisma/seed-backfill.js';

const prisma = new PrismaClient();

async function main() {
  console.log('[backfill] starting');
  const result = await backfillAssetVendorIds(prisma);
  console.log(
    `[backfill] done — checked ${result.assetsChecked} asset(s), ` +
      `created ${result.vendorsCreated} vendor(s), ` +
      `linked ${result.assetsLinked} asset(s)`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
