import { prisma } from '../../lib/prisma.js';
import type { Prisma, ReportStatus, ReportType } from '@prisma/client';

// Tx-client subset for service-layer atomic writes (Phase 16 Tier 6).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const includePreset = {
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export function findMany(args: {
  skip: number;
  take: number;
  where?: Prisma.ReportWhereInput;
  orderBy?: Prisma.ReportOrderByWithRelationInput;
}) {
  return prisma.report.findMany({
    skip: args.skip,
    take: args.take,
    where: args.where,
    orderBy: args.orderBy ?? { createdAt: 'desc' },
    include: includePreset,
  });
}

export function count(where?: Prisma.ReportWhereInput) {
  return prisma.report.count({ where });
}

export function findById(id: string) {
  return prisma.report.findUnique({
    where: { id },
    include: includePreset,
  });
}

export function create(
  data: Prisma.ReportCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).report.create({
    data,
    include: includePreset,
  });
}

export function update(
  id: string,
  data: Prisma.ReportUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).report.update({
    where: { id },
    data,
    include: includePreset,
  });
}

export function remove(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).report.delete({ where: { id } });
}

export function updateStatus(
  id: string,
  status: ReportStatus,
  extra?: {
    fileUrl?: string;
    lastGeneratedAt?: Date;
  },
) {
  return prisma.report.update({
    where: { id },
    data: {
      status,
      ...(extra?.fileUrl !== undefined && { fileUrl: extra.fileUrl }),
      ...(extra?.lastGeneratedAt && { lastGeneratedAt: extra.lastGeneratedAt }),
    },
  });
}

export function findByType(type: ReportType) {
  return prisma.report.findMany({
    where: { type },
    include: includePreset,
  });
}
