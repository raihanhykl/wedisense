import { Worker, type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { notifyRole } from '../modules/notifications/index.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'tour-sync';

interface TourStep {
  step_index: number;
  title: string;
  description: string;
  target_element: string;
  position: string;
  required_permission: { resource: string; action: string } | null;
  route: string;
  is_active?: boolean;
}

/**
 * Exported processor function so it can be unit-tested in isolation
 * without starting a real BullMQ Worker (which requires Redis).
 */
export async function processTourSync(
  job: Job<{ roleId: string }>,
): Promise<{ skipped: true } | { tourId: string; roleId: string; stepsCount: number }> {
  const { roleId } = job.data;

  // 1. Find the tour for this role
  const tour = await prisma.onboardingTour.findFirst({
    where: { roleId },
  });

  if (!tour) {
    console.warn(`[tour-sync] No tour found for role ${roleId} — skipping`);
    return { skipped: true };
  }

  // 2. Load current role permissions
  const rolePermissions = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: true },
  });

  const grantedSet = new Set<string>(
    rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
  );

  // 3. Parse and deduplicate steps
  const rawSteps = tour.steps as unknown as TourStep[];
  const seenIndices = new Map<number, TourStep>();

  for (const step of rawSteps) {
    if (seenIndices.has(step.step_index)) {
      console.warn(
        `[tour-sync] Duplicate step_index ${step.step_index} for tour ${tour.id} — keeping last occurrence`,
      );
    }
    seenIndices.set(step.step_index, step);
  }

  // 4. Update is_active per permission check
  const updatedSteps: TourStep[] = Array.from(seenIndices.values()).map((step) => {
    const isActive =
      step.required_permission === null || step.required_permission === undefined
        ? true
        : grantedSet.has(
            `${step.required_permission.resource}:${step.required_permission.action}`,
          );

    return { ...step, is_active: isActive };
  });

  // 5. Atomic transaction: update tour + create audit log
  await prisma.$transaction([
    prisma.onboardingTour.update({
      where: { id: tour.id },
      data: {
        steps: updatedSteps as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: null,
        action: 'UPDATE',
        resourceType: 'OnboardingTour',
        resourceId: tour.id,
        oldValues: rawSteps as unknown as Prisma.InputJsonValue,
        newValues: updatedSteps as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  // 6. Notify admins — best-effort, don't let notification failure roll back the tour update
  try {
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (role) {
      await notifyRole('ADMIN', {
        type: 'TOUR_UPDATED',
        titleKey: 'tour_updated.title',
        messageKey: 'tour_updated.message',
        vars: { roleName: role.name },
        data: { roleId, tourId: tour.id, url: '/admin/roles' },
      });
    }
  } catch (err) {
    console.error(
      '[tour-sync] Failed to notify admins (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }

  console.log(`[tour-sync] Synced tour ${tour.id} for role ${roleId}`);
  return { tourId: tour.id, roleId, stepsCount: updatedSteps.length };
}

export const tourSyncWorker = new Worker<{ roleId: string }>(
  QUEUE_NAME,
  processTourSync,
  { connection: redis as unknown as ConnectionOptions, concurrency: 5 },
);

tourSyncWorker.on('failed', (job, err) => {
  console.error(`[tour-sync] Job ${job?.id} failed:`, err.message);
});
