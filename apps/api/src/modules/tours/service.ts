import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { tourSyncQueue } from '../../lib/queue.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { parseStep, toStorageStep, type TourDto, type TourProgressDto } from './types.js';
import type { CreateTourInput, UpdateTourInput, UpdateProgressInput } from './schema.js';
import * as repo from './repository.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';

// ── Internal helpers ─────────────────────────────────────────────────────────

function buildProgressDto(row: {
  completedSteps: Prisma.JsonValue;
  isCompleted: boolean;
  isSkipped: boolean;
  lastSeenAt: Date | null;
}): TourProgressDto {
  const completedSteps = Array.isArray(row.completedSteps)
    ? (row.completedSteps as number[])
    : [];
  const lastStepIndex =
    completedSteps.length > 0
      ? Math.max(...completedSteps)
      : 0;
  return {
    completedSteps,
    lastStepIndex,
    isCompleted: row.isCompleted,
    isSkipped: row.isSkipped,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
  };
}

// ── Exported for auth/service.ts to check first-run flag ─────────────────────

/**
 * Returns true when the user has at least one applicable active tour where
 * progress is absent or not yet completed/skipped.
 *
 * Intentionally a lightweight query (IDs only) so it adds minimal latency to
 * every `GET /api/auth/me` call.
 */
export async function hasIncompleteTourForUser(user: AuthenticatedUser): Promise<boolean> {
  const roleIds = user.roles.map((r) => r.id);
  if (roleIds.length === 0) return false;

  const tours = await repo.findToursForUser(roleIds);
  if (tours.length === 0) return false;

  const tourIds = tours.map((t) => t.id);
  const progressMap = await repo.findProgressForUser(user.id, tourIds);

  for (const tour of tours) {
    const progress = progressMap.get(tour.id);
    if (!progress) return true; // no row → not started → incomplete
    if (!progress.isCompleted && !progress.isSkipped) return true;
  }
  return false;
}

// ── User-facing (GET /my) ────────────────────────────────────────────────────

export async function getMyTours(user: AuthenticatedUser): Promise<TourDto[]> {
  const roleIds = user.roles.map((r) => r.id);
  if (roleIds.length === 0) return [];

  const tours = await repo.findToursForUser(roleIds);
  if (tours.length === 0) return [];

  const tourIds = tours.map((t) => t.id);
  const [progressMap, roleNameMap] = await Promise.all([
    repo.findProgressForUser(user.id, tourIds),
    repo.getRoleNameMap(roleIds),
  ]);

  const dtos: TourDto[] = tours.map((tour) => {
    const rawSteps = Array.isArray(tour.steps) ? (tour.steps as unknown[]) : [];

    // Parse → filter inactive → filter steps requiring permissions the user lacks.
    // DECISION: do NOT reindex. stepIndex is an identity key (used by the frontend
    // to match progress.completedSteps). Filtering produces a sparse-but-stable list.
    const steps = rawSteps
      .map((raw) => {
        try {
          return parseStep(raw);
        } catch {
          return null;
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .filter((s) => s.isActive)
      .filter((s) => {
        if (!s.requiredPermission) return true;
        return user.permissions.includes(
          `${s.requiredPermission.resource}:${s.requiredPermission.action}`,
        );
      })
      .sort((a, b) => a.stepIndex - b.stepIndex);

    const progressRow = progressMap.get(tour.id);
    const progress = progressRow ? buildProgressDto(progressRow) : null;

    return {
      id: tour.id,
      name: tour.name,
      description: tour.description,
      isActive: tour.isActive,
      roleId: tour.roleId,
      roleName: roleNameMap.get(tour.roleId) ?? tour.roleId,
      steps,
      progress,
    };
  });

  // Sort: incomplete tours first (no progress row, or in-progress), then completed/skipped, then by name.
  dtos.sort((a, b) => {
    const aIncomplete =
      !a.progress || (!a.progress.isCompleted && !a.progress.isSkipped);
    const bIncomplete =
      !b.progress || (!b.progress.isCompleted && !b.progress.isSkipped);
    if (aIncomplete && !bIncomplete) return -1;
    if (!aIncomplete && bIncomplete) return 1;
    return a.name.localeCompare(b.name);
  });

  return dtos;
}

// ── Admin CRUD ───────────────────────────────────────────────────────────────

export async function getTourById(id: string): Promise<TourDto> {
  const tour = await repo.findTourById(id);
  if (!tour) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');

  const roleNameMap = await repo.getRoleNameMap([tour.roleId]);
  const rawSteps = Array.isArray(tour.steps) ? (tour.steps as unknown[]) : [];
  const steps = rawSteps
    .map((raw) => {
      try {
        return parseStep(raw);
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.stepIndex - b.stepIndex);

  return {
    id: tour.id,
    name: tour.name,
    description: tour.description,
    isActive: tour.isActive,
    roleId: tour.roleId,
    roleName: roleNameMap.get(tour.roleId) ?? tour.roleId,
    steps,
    progress: null, // admin view does not carry a single user's progress
  };
}

export async function listAllTours(query: { page?: number; limit?: number }) {
  const { skip, take, page, limit } = parsePagination(query);
  const { tours, total } = await repo.listAllTours(skip, take);

  const roleIds = [...new Set(tours.map((t) => t.roleId))];
  const roleNameMap = await repo.getRoleNameMap(roleIds);

  const dtos: TourDto[] = tours.map((tour) => {
    const rawSteps = Array.isArray(tour.steps) ? (tour.steps as unknown[]) : [];
    const steps = rawSteps
      .map((raw) => {
        try {
          return parseStep(raw);
        } catch {
          return null;
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => a.stepIndex - b.stepIndex);

    return {
      id: tour.id,
      name: tour.name,
      description: tour.description,
      isActive: tour.isActive,
      roleId: tour.roleId,
      roleName: roleNameMap.get(tour.roleId) ?? tour.roleId,
      steps,
      progress: null,
    };
  });

  return { dtos, meta: buildPaginationMeta(page, limit, total) };
}

export async function createTour(input: CreateTourInput, actorUserId: string): Promise<TourDto> {
  // Validate role exists
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');

  // 1-tour-per-role invariant
  const existing = await repo.countToursForRole(input.roleId);
  if (existing > 0) {
    throw new AppError(
      409,
      'TOUR_ALREADY_EXISTS_FOR_ROLE',
      `A tour already exists for role "${role.name}". Use PUT /:id to update it.`,
    );
  }

  const storageSteps = input.steps.map(toStorageStep);

  const tour = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingTour.create({
      data: {
        roleId: input.roleId,
        name: input.name,
        description: input.description ?? null,
        isActive: input.isActive,
        steps: storageSteps as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'CREATE',
        resourceType: 'OnboardingTour',
        resourceId: created.id,
        newValues: {
          name: created.name,
          roleId: created.roleId,
          stepsCount: storageSteps.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return created;
  });

  const dto = await getTourById(tour.id);
  return dto;
}

export async function updateTour(
  id: string,
  input: UpdateTourInput,
  actorUserId: string,
): Promise<TourDto> {
  const existing = await repo.findTourById(id);
  if (!existing) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');

  const updateData: Partial<{
    name: string;
    description: string | null;
    isActive: boolean;
    steps: Prisma.InputJsonValue;
  }> = {};

  // Track changed fields for audit diff
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (input.name !== undefined && input.name !== existing.name) {
    oldValues['name'] = existing.name;
    newValues['name'] = input.name;
    updateData.name = input.name;
  }
  if (input.description !== undefined && input.description !== existing.description) {
    oldValues['description'] = existing.description;
    newValues['description'] = input.description ?? null;
    updateData.description = input.description ?? null;
  }
  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    oldValues['isActive'] = existing.isActive;
    newValues['isActive'] = input.isActive;
    updateData.isActive = input.isActive;
  }
  if (input.steps !== undefined) {
    oldValues['stepsCount'] = Array.isArray(existing.steps)
      ? (existing.steps as unknown[]).length
      : 0;
    newValues['stepsCount'] = input.steps.length;
    updateData.steps = input.steps.map(toStorageStep) as unknown as Prisma.InputJsonValue;
  }

  if (Object.keys(updateData).length === 0) {
    // Nothing changed — return current state
    return getTourById(id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.onboardingTour.update({ where: { id }, data: updateData });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'UPDATE',
        resourceType: 'OnboardingTour',
        resourceId: id,
        oldValues: oldValues as unknown as Prisma.InputJsonValue,
        newValues: newValues as unknown as Prisma.InputJsonValue,
      },
    });
  });

  return getTourById(id);
}

export async function deleteTour(id: string, actorUserId: string): Promise<void> {
  const existing = await repo.findTourById(id);
  if (!existing) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');

  await prisma.$transaction(async (tx) => {
    await tx.onboardingTour.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'DELETE',
        resourceType: 'OnboardingTour',
        resourceId: id,
        oldValues: {
          name: existing.name,
          roleId: existing.roleId,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// ── Progress ─────────────────────────────────────────────────────────────────

export async function updateProgress(
  user: AuthenticatedUser,
  tourId: string,
  input: UpdateProgressInput,
): Promise<TourProgressDto> {
  // Verify tour exists and user has the matching role. Use 404 for both "not
  // found" and "role mismatch" — don't leak which tours exist for other roles.
  const tour = await repo.findTourById(tourId);
  if (!tour || !user.roles.some((r) => r.id === tour.roleId)) {
    throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');
  }

  // Load current progress (may be null for first interaction)
  const existing = await prisma.userTourProgress.findUnique({
    where: { userId_tourId: { userId: user.id, tourId } },
  });

  const prevCompleted: number[] = existing
    ? (Array.isArray(existing.completedSteps)
        ? (existing.completedSteps as number[])
        : [])
    : [];

  let completedSteps = prevCompleted;
  let isCompleted = existing?.isCompleted ?? false;
  let isSkipped = existing?.isSkipped ?? false;

  switch (input.action) {
    case 'next': {
      completedSteps = [...new Set([...prevCompleted, input.stepIndex])];
      break;
    }
    case 'prev': {
      // Navigation backward does NOT undo completions — "prev" is just travel.
      completedSteps = prevCompleted;
      break;
    }
    case 'skip': {
      isSkipped = true;
      break;
    }
    case 'complete': {
      completedSteps = [...new Set([...prevCompleted, input.stepIndex])];
      isCompleted = true;
      break;
    }
  }

  const saved = await repo.upsertProgress(user.id, tourId, {
    completedSteps: completedSteps as unknown as Prisma.InputJsonValue,
    isCompleted,
    isSkipped,
    lastSeenAt: new Date(),
  });

  return buildProgressDto(saved);
}

export async function restartTour(
  user: AuthenticatedUser,
  tourId: string,
): Promise<TourProgressDto> {
  const tour = await repo.findTourById(tourId);
  if (!tour || !user.roles.some((r) => r.id === tour.roleId)) {
    throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');
  }

  const saved = await repo.upsertProgress(user.id, tourId, {
    completedSteps: [] as unknown as Prisma.InputJsonValue,
    isCompleted: false,
    isSkipped: false,
    lastSeenAt: new Date(),
  });

  return buildProgressDto(saved);
}

// ── Sync trigger ─────────────────────────────────────────────────────────────

export async function triggerSync(tourId: string, actorUserId: string): Promise<void> {
  const tour = await repo.findTourById(tourId);
  if (!tour) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');

  await tourSyncQueue.add('tour-sync', { roleId: tour.roleId }, {
    jobId: `tour-sync-${tour.roleId}`,
  });

  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: 'UPDATE',
      resourceType: 'OnboardingTour',
      resourceId: tourId,
      newValues: { syncTriggered: true, roleId: tour.roleId } as unknown as Prisma.InputJsonValue,
    },
  });
}
