import { type Prisma, type SmsInspectionResult } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';

/**
 * Columns returned by list and detail queries.
 * Includes physicalLocationId / responsibleShowroomId on the unit so the service
 * can run the per-location auth check without a second query.
 */
const inspectionSelect = {
  id: true,
  unitId: true,
  unit: {
    select: {
      id: true,
      vin: true,
      status: true,
      physicalLocationId: true,
      responsibleShowroomId: true,
      variant: {
        select: {
          name: true,
          color: true,
          model: { select: { name: true } },
        },
      },
    },
  },
  reason: true,
  result: true,
  condition: true,
  odometer: true,
  findings: true,
  notes: true,
  photos: true,
  inspector: { select: { id: true, name: true } },
  inspectedAt: true,
  createdAt: true,
} as const;

export type InspectionFull = Prisma.SmsInspectionGetPayload<{ select: typeof inspectionSelect }>;

export interface ListFilters {
  showroomId: string;
  result?: SmsInspectionResult;
  unitId?: string;
}

export async function findMany(
  filters: ListFilters,
  skip: number,
  take: number,
): Promise<{ data: InspectionFull[]; total: number }> {
  const where: Prisma.SmsInspectionWhereInput = {
    unit: { physicalLocationId: filters.showroomId },
  };
  if (filters.result !== undefined) where.result = filters.result;
  if (filters.unitId !== undefined) where.unitId = filters.unitId;

  const [data, total] = await Promise.all([
    prisma.smsInspection.findMany({
      where,
      skip,
      take,
      select: inspectionSelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.smsInspection.count({ where }),
  ]);

  return { data, total };
}

export async function findById(id: string): Promise<InspectionFull | null> {
  return prisma.smsInspection.findUnique({ where: { id }, select: inspectionSelect });
}
