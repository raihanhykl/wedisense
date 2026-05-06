import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { notify, notifyRole } from '../modules/notifications/index.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'warranty-check';

// Buckets for notifications: notify at 30d, 14d, and any time <=7d
const NOTIFY_BUCKETS = new Set([30, 14]);

export const warrantyCheckWorker = new Worker<Record<string, never>>(
  QUEUE_NAME,
  async () => {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const assets = await prisma.asset.findMany({
      where: {
        deletedAt: null,
        warrantyEndDate: {
          gte: now,
          lte: thirtyDaysFromNow,
        },
        status: { notIn: ['DISPOSED', 'LOST'] },
        assignedToUserId: { not: null },
      },
      select: {
        id: true,
        name: true,
        assetNumber: true,
        warrantyEndDate: true,
        assignedToUserId: true,
      },
    });

    let notified = 0;

    for (const asset of assets) {
      if (!asset.warrantyEndDate || !asset.assignedToUserId) continue;

      const daysUntil = Math.floor(
        (asset.warrantyEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Notify at exact buckets or any day <=7
      if (!NOTIFY_BUCKETS.has(daysUntil) && daysUntil > 7) {
        continue;
      }

      const vars = {
        assetName: asset.name,
        daysUntil,
      };

      const dedupeKey = `warranty:${asset.id}`;
      const data = { assetId: asset.id, url: `/admin/assets/${asset.id}` };

      await notify({
        userIds: [asset.assignedToUserId],
        type: 'WARRANTY_EXPIRING',
        titleKey: 'warranty_expiring.title',
        messageKey: 'warranty_expiring.message',
        vars,
        data,
        dedupeKey,
        dedupeWindow: 'day',
      });

      // For critical (<=7 days): also notify admins (separate dedupeKey
      // so admin alerts don't collide with the assignee notification).
      if (daysUntil <= 7) {
        await notifyRole('ADMIN', {
          type: 'WARRANTY_EXPIRING',
          titleKey: 'warranty_expiring.title',
          messageKey: 'warranty_expiring.message',
          vars,
          data,
          dedupeKey: `${dedupeKey}:admin`,
          dedupeWindow: 'day',
        });
      }

      notified++;
    }

    console.log(`[warranty-check] Notified ${notified} warranty expiry alerts`);
    return { notified };
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 1 },
);

warrantyCheckWorker.on('failed', (job, err) => {
  console.error(`[warranty-check] Job ${job?.id} failed:`, err.message);
});
