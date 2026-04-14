import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from './types.js';

// ── Include presets ──────────────────────────────────────────────────

const scheduleListInclude = {
  asset: { select: { id: true, name: true, assetNumber: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
} as const;

const scheduleDetailInclude = {
  asset: { select: { id: true, name: true, assetNumber: true, status: true, condition: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  logs: {
    orderBy: { performedAt: 'desc' as const },
    take: 10,
    select: {
      id: true,
      performedAt: true,
      description: true,
      conditionBefore: true,
      conditionAfter: true,
      cost: true,
      performedBy: { select: { id: true, name: true } },
      createdAt: true,
    },
  },
} as const;

const logListInclude = {
  asset: { select: { id: true, name: true, assetNumber: true } },
  schedule: { select: { id: true, title: true, frequencyType: true } },
  performedBy: { select: { id: true, name: true, email: true } },
} as const;

// ── Schedule queries ────────────────────────────────────────────────

export function findManySchedules(args: {
  skip: number;
  take: number;
  where?: Prisma.MaintenanceScheduleWhereInput;
  orderBy?: Prisma.MaintenanceScheduleOrderByWithRelationInput;
}) {
  return prisma.maintenanceSchedule.findMany({
    skip: args.skip,
    take: args.take,
    where: args.where,
    orderBy: args.orderBy ?? { nextDueDate: 'asc' },
    include: scheduleListInclude,
  });
}

export function countSchedules(where?: Prisma.MaintenanceScheduleWhereInput) {
  return prisma.maintenanceSchedule.count({ where });
}

export function findScheduleById(id: string) {
  return prisma.maintenanceSchedule.findUnique({
    where: { id },
    include: scheduleDetailInclude,
  });
}

export function createSchedule(data: Prisma.MaintenanceScheduleCreateInput) {
  return prisma.maintenanceSchedule.create({
    data,
    include: scheduleListInclude,
  });
}

export function updateSchedule(id: string, data: Prisma.MaintenanceScheduleUpdateInput) {
  return prisma.maintenanceSchedule.update({
    where: { id },
    data,
    include: scheduleDetailInclude,
  });
}

export function deleteSchedule(id: string) {
  return prisma.maintenanceSchedule.delete({ where: { id } });
}

export function updateScheduleInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.MaintenanceScheduleUpdateInput,
) {
  return (tx as unknown as { maintenanceSchedule: typeof prisma.maintenanceSchedule }).maintenanceSchedule.update({
    where: { id },
    data,
  });
}

// ── Log queries ─────────────────────────────────────────────────────

export function findManyLogs(args: {
  skip: number;
  take: number;
  where?: Prisma.MaintenanceLogWhereInput;
  orderBy?: Prisma.MaintenanceLogOrderByWithRelationInput;
}) {
  return prisma.maintenanceLog.findMany({
    skip: args.skip,
    take: args.take,
    where: args.where,
    orderBy: args.orderBy ?? { performedAt: 'desc' },
    include: logListInclude,
  });
}

export function countLogs(where?: Prisma.MaintenanceLogWhereInput) {
  return prisma.maintenanceLog.count({ where });
}

export function createLogInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.MaintenanceLogCreateInput,
) {
  return (tx as unknown as { maintenanceLog: typeof prisma.maintenanceLog }).maintenanceLog.create({
    data,
    include: logListInclude,
  });
}

// ── Audit log ───────────────────────────────────────────────────────

export function createAuditLogInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.AuditLogCreateInput,
) {
  return (tx as unknown as { auditLog: typeof prisma.auditLog }).auditLog.create({ data });
}

// ── Due schedules ───────────────────────────────────────────────────

export function findDueSchedules(dueBefore: Date) {
  return prisma.maintenanceSchedule.findMany({
    where: {
      isActive: true,
      nextDueDate: { lte: dueBefore },
    },
    orderBy: { nextDueDate: 'asc' },
    include: scheduleListInclude,
  });
}
