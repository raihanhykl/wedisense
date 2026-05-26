/**
 * Phase 17 v2 — vendor FK backfill.
 *
 * Walks every Asset whose `vendorLegacy` (free-text) is populated but
 * whose `vendorId` (FK → Vendor) is null, and links them by
 * case-insensitive name match. Creates missing Vendor rows as needed.
 *
 * Idempotent + safe to run on every seed:
 *   - WHERE clause skips assets that already have vendorId set
 *   - Vendor find-or-create uses a case-insensitive name match
 *   - In-memory name cache eliminates duplicate round-trips within a run
 *
 * Why this is invoked from `seed.ts` (not standalone-only):
 *   A fresh DB seeded after Phase 17 v2 ships will have seed-demo set
 *   vendorId directly. But a production DB bootstrapped before this
 *   migration landed needs the backfill to repair legacy rows. Running
 *   it as part of every seed run makes that automatic.
 *
 * Standalone usage (kept for ad-hoc repair runs):
 *   pnpm --filter api exec tsx scripts/backfill-asset-vendor-id.ts
 */

import type { PrismaClient } from '@prisma/client';

export async function backfillAssetVendorIds(
  prisma: PrismaClient,
): Promise<{ assetsChecked: number; vendorsCreated: number; assetsLinked: number }> {
  const assets = await prisma.asset.findMany({
    where: {
      vendorLegacy: { not: null },
      vendorId: null,
      deletedAt: null,
    },
    select: { id: true, vendorLegacy: true },
  });

  if (assets.length === 0) {
    return { assetsChecked: 0, vendorsCreated: 0, assetsLinked: 0 };
  }

  let vendorsCreated = 0;
  let assetsLinked = 0;
  const vendorIdByName = new Map<string, string>();

  for (const asset of assets) {
    const rawName = asset.vendorLegacy;
    if (!rawName) continue;
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();

    let vendorId = vendorIdByName.get(key);
    if (!vendorId) {
      const existing = await prisma.vendor.findFirst({
        where: { name: { equals: trimmed, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        vendorId = existing.id;
      } else {
        const created = await prisma.vendor.create({
          data: { name: trimmed },
          select: { id: true },
        });
        vendorId = created.id;
        vendorsCreated++;
      }
      vendorIdByName.set(key, vendorId);
    }

    await prisma.asset.update({
      where: { id: asset.id },
      data: { vendorId },
    });
    assetsLinked++;
  }

  return { assetsChecked: assets.length, vendorsCreated, assetsLinked };
}
