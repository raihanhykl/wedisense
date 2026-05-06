import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { notify, notifyRole } from '../modules/notifications/index.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'loan-overdue';

export const loanOverdueWorker = new Worker<Record<string, never>>(
  QUEUE_NAME,
  async () => {
    const now = new Date();

    const overdueMovements = await prisma.assetMovement.findMany({
      where: {
        movementType: 'LOAN_OUT',
        status: 'COMPLETED',
        expectedReturnDate: { lt: now },
        actualReturnDate: null,
      },
      include: {
        asset: { select: { id: true, name: true, assetNumber: true } },
      },
    });

    let notified = 0;

    for (const movement of overdueMovements) {
      if (!movement.expectedReturnDate || !movement.toUserId) continue;

      const daysOverdue = Math.floor(
        (now.getTime() - movement.expectedReturnDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      const vars = {
        assetName: movement.asset.name,
        assetNumber: movement.asset.assetNumber,
        daysOverdue,
      };

      const dedupeKey = `loan-overdue:${movement.id}`;
      const data = {
        assetId: movement.asset.id,
        movementId: movement.id,
        url: `/admin/assets/${movement.asset.id}`,
      };

      await notify({
        userIds: [movement.toUserId],
        type: 'LOAN_OVERDUE',
        titleKey: 'loan_overdue.title',
        messageKey: 'loan_overdue.message',
        vars,
        data,
        dedupeKey,
        dedupeWindow: 'day',
      });

      // Escalate to admins if overdue by 3+ days (separate dedupeKey)
      if (daysOverdue >= 3) {
        await notifyRole('ADMIN', {
          type: 'LOAN_OVERDUE',
          titleKey: 'loan_overdue.title',
          messageKey: 'loan_overdue.message',
          vars,
          data,
          dedupeKey: `${dedupeKey}:admin`,
          dedupeWindow: 'day',
        });
      }

      notified++;
    }

    console.log(`[loan-overdue] Notified ${notified} overdue loan alerts`);
    return { notified };
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 1 },
);

loanOverdueWorker.on('failed', (job, err) => {
  console.error(`[loan-overdue] Job ${job?.id} failed:`, err.message);
});
