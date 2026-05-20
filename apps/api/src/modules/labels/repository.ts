import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

// Tx-client subset for service-layer atomic writes (Phase 16 Tier 6).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ── Template queries ───────────────────────────────────────────

const templateListInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export function findManyTemplates() {
  return prisma.labelTemplate.findMany({
    orderBy: { createdAt: 'desc' },
    include: templateListInclude,
  });
}

export function findTemplateById(id: string) {
  return prisma.labelTemplate.findUnique({
    where: { id },
    include: templateListInclude,
  });
}

export function createTemplate(
  data: Prisma.LabelTemplateCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).labelTemplate.create({
    data,
    include: templateListInclude,
  });
}

export function updateTemplate(
  id: string,
  data: Prisma.LabelTemplateUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).labelTemplate.update({
    where: { id },
    data,
    include: templateListInclude,
  });
}

export function deleteTemplate(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).labelTemplate.delete({ where: { id } });
}

// ── Print Job queries ──────────────────────────────────────────

const printJobInclude = {
  labelTemplate: { select: { id: true, name: true, paperWidthMm: true, paperHeightMm: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export function findPrintJobById(id: string) {
  return prisma.printJob.findUnique({
    where: { id },
    include: printJobInclude,
  });
}

export function createPrintJob(data: Prisma.PrintJobCreateInput) {
  return prisma.printJob.create({
    data,
    include: printJobInclude,
  });
}

export function updatePrintJob(id: string, data: Prisma.PrintJobUpdateInput) {
  return prisma.printJob.update({
    where: { id },
    data,
    include: printJobInclude,
  });
}

// ── Asset queries ──────────────────────────────────────────────

export function findAssetsByIds(ids: string[]) {
  return prisma.asset.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      location: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });
}

export function findAssetById(id: string) {
  return prisma.asset.findFirst({
    where: { id, deletedAt: null },
    include: {
      location: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });
}
