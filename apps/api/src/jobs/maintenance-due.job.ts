import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { findDueSchedules } from '../modules/maintenance/repository.js';
import { notify, notifyRole } from '../modules/notifications/index.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'maintenance-due';

export const maintenanceDueWorker = new Worker<Record<string, never>>(
  QUEUE_NAME,
  async () => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const schedules = await findDueSchedules(sevenDaysFromNow);

    let notified = 0;

    for (const schedule of schedules) {
      if (!schedule.nextDueDate) continue;

      const daysUntil = Math.floor(
        (schedule.nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const vars = {
        assetName: schedule.asset.name,
        scheduleTitle: schedule.title,
        daysUntil: Math.max(0, daysUntil),
      };

      const data = {
        scheduleId: schedule.id,
        assetId: schedule.asset.id,
        url: `/admin/maintenance/schedules/${schedule.id}`,
      };

      const dedupeKey = `maintenance:${schedule.id}`;

      if (schedule.assignedToUserId) {
        await notify({
          userIds: [schedule.assignedToUserId],
          type: 'MAINTENANCE_DUE',
          titleKey: 'maintenance_due.title',
          messageKey: 'maintenance_due.message',
          vars,
          data,
          dedupeKey,
          dedupeWindow: 'day',
        });
      }

      await notifyRole('ADMIN', {
        type: 'MAINTENANCE_DUE',
        titleKey: 'maintenance_due.title',
        messageKey: 'maintenance_due.message',
        vars,
        data,
        dedupeKey: `${dedupeKey}:admin`,
        dedupeWindow: 'day',
      });

      notified++;
    }

    console.log(`[maintenance-due] Notified ${notified} maintenance due alerts`);
    return { notified };
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 1 },
);

maintenanceDueWorker.on('failed', (job, err) => {
  console.error(`[maintenance-due] Job ${job?.id} failed:`, err.message);
});
