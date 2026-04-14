import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import * as repo from './repository.js';
import type { CreateScheduleInput, UpdateScheduleInput, CreateLogInput } from './schema.js';
import type { ScheduleListFilters, LogListFilters, PrismaTransactionClient } from './types.js';
import type { PaginationQuery } from '@wedisense/shared';

// ── Build where clauses ─────────────────────────────────────────────

function buildScheduleWhereClause(
  filters: ScheduleListFilters,
): Prisma.MaintenanceScheduleWhereInput {
  const where: Prisma.MaintenanceScheduleWhereInput = {};

  if (filters.assetId) {
    where.assetId = filters.assetId;
  }

  if (filters.frequencyType) {
    where.frequencyType = filters.frequencyType as Prisma.EnumFrequencyTypeFilter;
  }

  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }

  return where;
}

function buildScheduleOrderBy(
  sort?: string,
  order?: 'asc' | 'desc',
): Prisma.MaintenanceScheduleOrderByWithRelationInput {
  const dir = order ?? 'asc';
  const validSorts: Record<string, Prisma.MaintenanceScheduleOrderByWithRelationInput> = {
    nextDueDate: { nextDueDate: dir },
    createdAt: { createdAt: dir },
    title: { title: dir },
  };

  if (sort && sort in validSorts) {
    return validSorts[sort]!;
  }

  return { nextDueDate: dir };
}

function buildLogWhereClause(
  filters: LogListFilters,
): Prisma.MaintenanceLogWhereInput {
  const where: Prisma.MaintenanceLogWhereInput = {};

  if (filters.assetId) {
    where.assetId = filters.assetId;
  }

  if (filters.scheduleId) {
    where.maintenanceScheduleId = filters.scheduleId;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.performedAt = {
      ...(filters.dateFrom && { gte: filters.dateFrom }),
      ...(filters.dateTo && { lte: filters.dateTo }),
    };
  }

  return where;
}

function buildLogOrderBy(
  sort?: string,
  order?: 'asc' | 'desc',
): Prisma.MaintenanceLogOrderByWithRelationInput {
  const dir = order ?? 'desc';
  const validSorts: Record<string, Prisma.MaintenanceLogOrderByWithRelationInput> = {
    performedAt: { performedAt: dir },
    createdAt: { createdAt: dir },
    cost: { cost: dir },
  };

  if (sort && sort in validSorts) {
    return validSorts[sort]!;
  }

  return { performedAt: dir };
}

// ── List Schedules ──────────────────────────────────────────────────

export async function listSchedules(
  query: PaginationQuery & ScheduleListFilters,
) {
  const { skip, take, page, limit } = parsePagination(query);
  const where = buildScheduleWhereClause(query);
  const orderBy = buildScheduleOrderBy(query.sort, query.order);

  const [schedules, total] = await Promise.all([
    repo.findManySchedules({ skip, take, where, orderBy }),
    repo.countSchedules(where),
  ]);

  return { schedules, meta: buildPaginationMeta(page, limit, total) };
}

// ── Get Schedule ────────────────────────────────────────────────────

export async function getSchedule(id: string) {
  const schedule = await repo.findScheduleById(id);
  if (!schedule) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', 'Maintenance schedule not found');
  }
  return schedule;
}

// ── Create Schedule ─────────────────────────────────────────────────

export async function createSchedule(input: CreateScheduleInput, userId: string) {
  const schedule = await repo.createSchedule({
    title: input.title,
    description: input.description ?? null,
    frequencyType: input.frequencyType,
    nextDueDate: input.nextDueDate,
    isActive: input.isActive,
    asset: { connect: { id: input.assetId } },
    ...(input.assignedToUserId && {
      assignedTo: { connect: { id: input.assignedToUserId } },
    }),
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      resourceType: 'MaintenanceSchedule',
      resourceId: schedule.id,
      newValues: {
        title: input.title,
        assetId: input.assetId,
        frequencyType: input.frequencyType,
      },
    },
  });

  return schedule;
}

// ── Update Schedule ─────────────────────────────────────────────────

export async function updateSchedule(id: string, input: UpdateScheduleInput, userId: string) {
  const existing = await repo.findScheduleById(id);
  if (!existing) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', 'Maintenance schedule not found');
  }

  const data: Prisma.MaintenanceScheduleUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.frequencyType !== undefined) data.frequencyType = input.frequencyType;
  if (input.nextDueDate !== undefined) data.nextDueDate = input.nextDueDate;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  if (input.assignedToUserId !== undefined) {
    if (input.assignedToUserId === null) {
      data.assignedTo = { disconnect: true };
    } else {
      data.assignedTo = { connect: { id: input.assignedToUserId } };
    }
  }

  const schedule = await repo.updateSchedule(id, data);

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'UPDATE',
      resourceType: 'MaintenanceSchedule',
      resourceId: id,
      newValues: input as unknown as Prisma.InputJsonValue,
    },
  });

  return schedule;
}

// ── Delete Schedule ─────────────────────────────────────────────────

export async function deleteSchedule(id: string, userId: string) {
  const existing = await repo.findScheduleById(id);
  if (!existing) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', 'Maintenance schedule not found');
  }

  await repo.deleteSchedule(id);

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'DELETE',
      resourceType: 'MaintenanceSchedule',
      resourceId: id,
      newValues: { title: existing.title, assetId: existing.assetId },
    },
  });
}

// ── List Logs ───────────────────────────────────────────────────────

export async function listLogs(
  query: PaginationQuery & LogListFilters,
) {
  const { skip, take, page, limit } = parsePagination(query);
  const where = buildLogWhereClause(query);
  const orderBy = buildLogOrderBy(query.sort, query.order);

  const [logs, total] = await Promise.all([
    repo.findManyLogs({ skip, take, where, orderBy }),
    repo.countLogs(where),
  ]);

  return { logs, meta: buildPaginationMeta(page, limit, total) };
}

// ── Create Log ──────────────────────────────────────────────────────

function computeNextDueDate(frequencyType: string, fromDate: Date): Date | null {
  const d = new Date(fromDate);
  switch (frequencyType) {
    case 'ONE_TIME':
      return null;
    case 'DAILY':
      d.setDate(d.getDate() + 1);
      return d;
    case 'WEEKLY':
      d.setDate(d.getDate() + 7);
      return d;
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      return d;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3);
      return d;
    case 'YEARLY':
      d.setFullYear(d.getFullYear() + 1);
      return d;
    default:
      return d;
  }
}

export async function createLog(input: CreateLogInput, userId: string) {
  return prisma.$transaction(async (tx: PrismaTransactionClient) => {
    const log = await repo.createLogInTransaction(tx, {
      asset: { connect: { id: input.assetId } },
      performedBy: { connect: { id: userId } },
      performedAt: input.performedAt,
      description: input.description,
      findings: input.findings ?? null,
      actionTaken: input.actionTaken ?? null,
      cost: input.cost ?? null,
      vendorName: input.vendorName ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      conditionBefore: input.conditionBefore,
      conditionAfter: input.conditionAfter,
      attachments: input.attachments ?? null,
      ...(input.maintenanceScheduleId && {
        schedule: { connect: { id: input.maintenanceScheduleId } },
      }),
    });

    // If linked to a schedule, update schedule dates
    if (input.maintenanceScheduleId) {
      const schedule = await repo.findScheduleById(input.maintenanceScheduleId);
      if (!schedule) {
        throw new AppError(404, 'SCHEDULE_NOT_FOUND', 'Maintenance schedule not found');
      }

      const now = new Date();
      const nextDue = computeNextDueDate(schedule.frequencyType, now);
      const updateData: Prisma.MaintenanceScheduleUpdateInput = {
        lastDoneDate: now,
      };

      if (nextDue === null) {
        // ONE_TIME: deactivate
        updateData.isActive = false;
      } else {
        updateData.nextDueDate = nextDue;
      }

      await repo.updateScheduleInTransaction(tx, input.maintenanceScheduleId, updateData);
    }

    // Audit log
    await repo.createAuditLogInTransaction(tx, {
      user: { connect: { id: userId } },
      action: 'CREATE',
      resourceType: 'MaintenanceLog',
      resourceId: log.id,
      newValues: {
        assetId: input.assetId,
        description: input.description,
        maintenanceScheduleId: input.maintenanceScheduleId ?? null,
      },
    });

    return log;
  });
}

// ── Due Schedules ───────────────────────────────────────────────────

export async function getDueSchedules() {
  const now = new Date();
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  return repo.findDueSchedules(sevenDaysFromNow);
}
