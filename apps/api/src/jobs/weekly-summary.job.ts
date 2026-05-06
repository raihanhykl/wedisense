import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { sendNotificationEmail } from '../lib/mailer.js';
import { t } from '../lib/l10n.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'weekly-summary';

export const weeklySummaryWorker = new Worker<Record<string, never>>(
  QUEUE_NAME,
  async () => {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalAssets, newAssetsThisWeek, totalMovementsThisWeek, overdueLoans, dueMaintenance] =
      await Promise.all([
        prisma.asset.count({ where: { deletedAt: null, status: { notIn: ['DISPOSED'] } } }),
        prisma.asset.count({ where: { deletedAt: null, createdAt: { gte: weekStart } } }),
        prisma.assetMovement.count({ where: { createdAt: { gte: weekStart } } }),
        prisma.assetMovement.count({
          where: {
            movementType: 'LOAN_OUT',
            status: 'COMPLETED',
            expectedReturnDate: { lt: now },
            actualReturnDate: null,
          },
        }),
        prisma.maintenanceSchedule.count({
          where: {
            isActive: true,
            nextDueDate: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    const weekStartStr = weekStart.toISOString().split('T')[0] ?? weekStart.toISOString();

    // Fetch all ADMIN users for email
    const adminUsers = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: { some: { role: { name: 'ADMIN' } } },
      },
      select: { id: true, name: true, email: true, preferredLanguage: true },
    });

    for (const user of adminUsers) {
      const lang = user.preferredLanguage ?? 'id';
      const vars: Record<string, string | number> = {
        name: user.name,
        weekStart: weekStartStr,
        totalAssets,
        newMovements: totalMovementsThisWeek,
        newAssetsThisWeek,
        overdueLoans,
        dueMaintenance,
      };
      const subject = t(lang, 'email.weekly_summary.subject', vars);

      void sendNotificationEmail({
        to: user.email,
        templateName: 'weekly-summary',
        lang,
        vars,
        subject,
      }).catch((err: unknown) => {
        console.error('[weekly-summary] Email error:', err instanceof Error ? err.message : err);
      });
    }

    console.log(`[weekly-summary] Sent summary emails to ${adminUsers.length} admins`);
    return {
      totalAssets,
      newAssetsThisWeek,
      totalMovementsThisWeek,
      overdueLoans,
      dueMaintenance,
      emailsSent: adminUsers.length,
    };
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 1 },
);

weeklySummaryWorker.on('failed', (job, err) => {
  console.error(`[weekly-summary] Job ${job?.id} failed:`, err.message);
});
