import { Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'depreciation';
const BATCH_SIZE = 50;

function computeMonthsElapsed(purchaseDate: Date, now: Date): number {
  return (
    (now.getFullYear() - purchaseDate.getFullYear()) * 12 +
    (now.getMonth() - purchaseDate.getMonth())
  );
}

export const depreciationWorker = new Worker<Record<string, never>>(
  QUEUE_NAME,
  async () => {
    const now = new Date();
    let skip = 0;
    let totalAssets = 0;
    let batchesProcessed = 0;

    let hasMore = true;
    while (hasMore) {
      const assets = await prisma.asset.findMany({
        where: {
          deletedAt: null,
          status: { notIn: ['DISPOSED'] },
          purchaseDate: { not: null },
          purchasePrice: { not: null },
          usefulLifeMonths: { not: null },
        },
        include: {
          product: {
            include: {
              category: {
                select: {
                  depreciationMethod: true,
                  defaultDepreciationRate: true,
                },
              },
            },
          },
        },
        take: BATCH_SIZE,
        skip,
      });

      if (assets.length === 0) break;

      let assetsUpdated = 0;

      for (const asset of assets) {
        const method = asset.product?.category?.depreciationMethod ?? 'NONE';
        if (method === 'NONE') continue;
        if (!asset.purchaseDate || !asset.purchasePrice || !asset.usefulLifeMonths) continue;

        const monthsElapsed = computeMonthsElapsed(asset.purchaseDate, now);
        const purchasePrice = new Prisma.Decimal(asset.purchasePrice.toString());

        let newBookValue: Prisma.Decimal;

        if (method === 'STRAIGHT_LINE') {
          // max(0, purchasePrice - (purchasePrice / usefulLifeMonths) * monthsElapsed)
          const depreciated = purchasePrice
            .div(asset.usefulLifeMonths)
            .mul(monthsElapsed);
          const raw = purchasePrice.minus(depreciated);
          newBookValue = raw.lessThan(0) ? new Prisma.Decimal(0) : raw;
        } else {
          // DECLINING_BALANCE: purchasePrice * (1 - rate/100)^yearsElapsed
          const rate = asset.product?.category?.defaultDepreciationRate ?? 0;
          const yearsElapsed = monthsElapsed / 12;
          const factor = Math.pow(1 - Number(rate) / 100, yearsElapsed);
          newBookValue = purchasePrice.mul(new Prisma.Decimal(factor));
        }

        const rounded = newBookValue.toDecimalPlaces(2);

        await prisma.asset.update({
          where: { id: asset.id },
          data: { currentBookValue: rounded },
        });

        assetsUpdated++;
      }

      // One audit log per batch
      await prisma.auditLog.create({
        data: {
          userId: null,
          action: 'UPDATE',
          resourceType: 'Asset',
          resourceId: `batch-${batchesProcessed + 1}`,
          newValues: {
            batchSize: assets.length,
            assetsUpdated,
            batchIndex: batchesProcessed,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      totalAssets += assets.length;
      batchesProcessed++;
      skip += BATCH_SIZE;

      if (assets.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    console.log(`[depreciation] Updated ${totalAssets} assets in ${batchesProcessed} batches`);
    return { totalAssets, batchesProcessed };
  },
  {
    connection: redis as unknown as ConnectionOptions,
    concurrency: 1,
  },
);

depreciationWorker.on('failed', (job, err) => {
  console.error(`[depreciation] Job ${job?.id} failed:`, err.message);
});
