import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { businessToday } from '../lib/ledger.js';
import type {
  DashboardTotals,
  DashboardVariantRow,
  OpenShipmentTask,
  InspectionTask,
  IdentityMismatchTask,
  StaleBookingTask,
  AwaitingPickupTask,
  OverdueShowUnitTask,
} from './types.js';

// ── Summary ──────────────────────────────────────────────────────────────────

/**
 * Per-variant counts for all views, computed entirely in the database.
 *
 * Uses a single raw SQL query with conditional aggregation to avoid N+1
 * and keep the dashboard latency minimal.
 */
export async function getVariantCounts(
  showroomId: string,
): Promise<DashboardVariantRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      variant_id: string;
      variant_name: string;
      battery_variant: string | null;
      color: string;
      model_id: string;
      model_code: string;
      model_name: string;
      physical: bigint;
      ready: bigint;
      booked: bigint;
      sold_pending_pickup: bigint;
      inspection: bigint;
      custody: bigint;
      identity_mismatch: bigint;
      outside: bigint;
      show_unit: bigint;
    }>
  >`
    SELECT
      v.id                                                                                 AS variant_id,
      v.name                                                                               AS variant_name,
      v.battery_variant,
      v.color,
      m.id                                                                                 AS model_id,
      m.code                                                                               AS model_code,
      m.name                                                                               AS model_name,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid)                                                        AS physical,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid AND u.status = 'AVAILABLE')                            AS ready,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid AND u.status = 'BOOKED')                               AS booked,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid AND u.status = 'SOLD_PENDING_PICKUP')                  AS sold_pending_pickup,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid AND u.status = 'INSPECTION')                           AS inspection,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid AND u.status = 'CUSTODY')                              AS custody,
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid AND u.status = 'IDENTITY_MISMATCH')                    AS identity_mismatch,
      COUNT(u.id) FILTER (WHERE u.responsible_showroom_id = ${showroomId}::uuid AND u.physical_location_id IS NULL AND u.status IN ('SHOW_UNIT', 'ACTIVE_RTO')) AS outside,
      COUNT(u.id) FILTER (WHERE u.responsible_showroom_id = ${showroomId}::uuid AND u.physical_location_id IS NULL AND u.status = 'SHOW_UNIT') AS show_unit
    FROM sms_vehicle_variants v
    JOIN sms_vehicle_models m ON m.id = v.model_id
    LEFT JOIN sms_units u ON u.variant_id = v.id
      AND (
        u.physical_location_id = ${showroomId}::uuid
        OR (u.responsible_showroom_id = ${showroomId}::uuid AND u.physical_location_id IS NULL AND u.status IN ('SHOW_UNIT', 'ACTIVE_RTO'))
      )
    GROUP BY v.id, v.name, v.battery_variant, v.color, m.id, m.code, m.name
    HAVING
      COUNT(u.id) FILTER (WHERE u.physical_location_id = ${showroomId}::uuid) > 0
      OR COUNT(u.id) FILTER (WHERE u.responsible_showroom_id = ${showroomId}::uuid AND u.physical_location_id IS NULL AND u.status IN ('SHOW_UNIT', 'ACTIVE_RTO')) > 0
    ORDER BY m.name, v.name, v.color
  `;

  return rows.map((r) => ({
    variantId: r.variant_id,
    variantName: r.variant_name,
    batteryVariant: r.battery_variant,
    color: r.color,
    modelId: r.model_id,
    modelCode: r.model_code,
    modelName: r.model_name,
    physical: Number(r.physical),
    ready: Number(r.ready),
    booked: Number(r.booked),
    soldPendingPickup: Number(r.sold_pending_pickup),
    inspection: Number(r.inspection),
    custody: Number(r.custody),
    identityMismatch: Number(r.identity_mismatch),
    outside: Number(r.outside),
    showUnit: Number(r.show_unit),
  }));
}

/** Count pending shipment lines (expected VINs) for a destination showroom. */
export async function countExpected(showroomId: string): Promise<number> {
  return prisma.smsShipmentLine.count({
    where: {
      receiptStatus: 'PENDING',
      shipment: { destinationLocationId: showroomId },
    },
  });
}

/** Aggregate per-view totals from the per-variant rows. */
export function aggregateTotals(
  rows: DashboardVariantRow[],
  expected: number,
): DashboardTotals {
  const totals: DashboardTotals = {
    physical: 0,
    ready: 0,
    booked: 0,
    soldPendingPickup: 0,
    inspection: 0,
    custody: 0,
    identityMismatch: 0,
    outside: 0,
    showUnit: 0,
    expected,
  };
  for (const r of rows) {
    totals.physical += r.physical;
    totals.ready += r.ready;
    totals.booked += r.booked;
    totals.soldPendingPickup += r.soldPendingPickup;
    totals.inspection += r.inspection;
    totals.custody += r.custody;
    totals.identityMismatch += r.identityMismatch;
    totals.outside += r.outside;
    totals.showUnit += r.showUnit;
  }
  return totals;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

const TASK_LIMIT = 50;

/** Shipments destined for `showroomId` that still have at least one PENDING line. */
export async function getOpenShipments(
  showroomId: string,
): Promise<{ data: OpenShipmentTask[]; total: number }> {
  const where: Prisma.SmsShipmentWhereInput = {
    destinationLocationId: showroomId,
    lines: { some: { receiptStatus: 'PENDING' } },
  };

  const [shipments, total] = await Promise.all([
    prisma.smsShipment.findMany({
      where,
      take: TASK_LIMIT,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        batchNumber: true,
        deliveryNoteNumber: true,
        createdAt: true,
        lines: {
          select: { receiptStatus: true, isExpected: true },
        },
      },
    }),
    prisma.smsShipment.count({ where }),
  ]);

  const data: OpenShipmentTask[] = shipments.map((s) => {
    // Progress is measured against the manifest: unexpected arrivals are
    // extra and must not inflate "x of y received".
    const expectedLines = s.lines.filter((l) => l.isExpected);
    const pendingCount = expectedLines.filter((l) => l.receiptStatus === 'PENDING').length;
    const receivedCount = expectedLines.length - pendingCount;
    return {
      id: s.id,
      batchNumber: s.batchNumber,
      deliveryNoteNumber: s.deliveryNoteNumber,
      expectedCount: expectedLines.length,
      receivedCount,
      pendingCount,
      createdAt: s.createdAt,
    };
  });

  return { data, total };
}

/** Units physically at `showroomId` with status INSPECTION. */
export async function getInspectionUnits(
  showroomId: string,
): Promise<{ data: InspectionTask[]; total: number }> {
  const where: Prisma.SmsUnitWhereInput = {
    physicalLocationId: showroomId,
    status: 'INSPECTION',
  };

  const [units, total] = await Promise.all([
    prisma.smsUnit.findMany({
      where,
      take: TASK_LIMIT,
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        vin: true,
        variant: {
          select: {
            name: true,
            batteryVariant: true,
            color: true,
            model: { select: { name: true } },
          },
        },
        inspections: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { result: true },
        },
      },
    }),
    prisma.smsUnit.count({ where }),
  ]);

  const data: InspectionTask[] = units.map((u) => ({
    unitId: u.id,
    vin: u.vin,
    variantLabel: buildVariantLabel(u.variant),
    latestInspectionResult: u.inspections[0]?.result ?? null,
  }));

  return { data, total };
}

/** Units physically at `showroomId` with status IDENTITY_MISMATCH. */
export async function getIdentityMismatchUnits(
  showroomId: string,
): Promise<{ data: IdentityMismatchTask[]; total: number }> {
  const where: Prisma.SmsUnitWhereInput = {
    physicalLocationId: showroomId,
    status: 'IDENTITY_MISMATCH',
  };

  const [units, total] = await Promise.all([
    prisma.smsUnit.findMany({
      where,
      take: TASK_LIMIT,
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        vin: true,
        variant: {
          select: {
            name: true,
            batteryVariant: true,
            color: true,
            model: { select: { name: true } },
          },
        },
      },
    }),
    prisma.smsUnit.count({ where }),
  ]);

  const data: IdentityMismatchTask[] = units.map((u) => ({
    unitId: u.id,
    vin: u.vin,
    variantLabel: buildVariantLabel(u.variant),
  }));

  return { data, total };
}

function buildVariantLabel(variant: {
  name: string;
  batteryVariant: string | null;
  color: string;
  model: { name: string };
}): string {
  const parts = [variant.model.name, variant.name];
  if (variant.batteryVariant) parts.push(variant.batteryVariant);
  parts.push(variant.color);
  return parts.join(' · ');
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Stage 3 task queries ─────────────────────────────────────────────────────

/**
 * Order lines in BOOKED status whose follow-up date has passed at `showroomId`.
 * Oldest follow-up first so the most urgent items surface at the top.
 */
export async function getStaleBookings(
  showroomId: string,
  now: Date = new Date(),
): Promise<{ data: StaleBookingTask[]; total: number }> {
  const where: Prisma.SmsOrderLineWhereInput = {
    status: 'BOOKED',
    followUpAt: { lte: now },
    order: { showroomId },
  };

  const [lines, total] = await Promise.all([
    prisma.smsOrderLine.findMany({
      where,
      take: TASK_LIMIT,
      orderBy: { followUpAt: 'asc' },
      select: {
        id: true,
        orderId: true,
        bookedAt: true,
        followUpAt: true,
        unit: { select: { vin: true } },
        order: {
          select: {
            spkNumber: true,
            sales: { select: { name: true } },
          },
        },
      },
    }),
    prisma.smsOrderLine.count({ where }),
  ]);

  const data: StaleBookingTask[] = lines.map((l) => ({
    id: l.id,
    orderId: l.orderId,
    spk: l.order.spkNumber,
    vin: l.unit.vin,
    salesName: l.order.sales?.name ?? null,
    bookedAt: l.bookedAt,
    followUpAt: l.followUpAt,
    daysSinceBooking: Math.floor((now.getTime() - l.bookedAt.getTime()) / MS_PER_DAY),
  }));

  return { data, total };
}

/**
 * Order lines in SOLD status at `showroomId` — the customer has not yet
 * collected the motorcycle. Oldest sold date first.
 */
export async function getAwaitingPickup(
  showroomId: string,
  now: Date = new Date(),
): Promise<{ data: AwaitingPickupTask[]; total: number }> {
  const where: Prisma.SmsOrderLineWhereInput = {
    status: 'SOLD',
    order: { showroomId },
  };

  const [lines, total] = await Promise.all([
    prisma.smsOrderLine.findMany({
      where,
      take: TASK_LIMIT,
      orderBy: [{ soldAt: 'asc' }, { bookedAt: 'asc' }],
      select: {
        id: true,
        orderId: true,
        soldAt: true,
        unit: { select: { vin: true } },
        order: { select: { spkNumber: true } },
      },
    }),
    prisma.smsOrderLine.count({ where }),
  ]);

  const data: AwaitingPickupTask[] = lines.map((l) => ({
    id: l.id,
    orderId: l.orderId,
    spk: l.order.spkNumber,
    vin: l.unit.vin,
    soldAt: l.soldAt,
    daysWaiting: l.soldAt
      ? Math.floor((now.getTime() - l.soldAt.getTime()) / MS_PER_DAY)
      : 0,
  }));

  return { data, total };
}

/**
 * Open show loans of `showroomId` whose expected return date has passed.
 * Most overdue first.
 */
export async function getOverdueShowUnits(
  showroomId: string,
  now: Date = new Date(),
): Promise<{ data: OverdueShowUnitTask[]; total: number }> {
  const today = businessToday(now);

  const where: Prisma.SmsShowLoanWhereInput = {
    showroomId,
    returnedAt: null,
    expectedReturnDate: { lt: today },
  };

  const [loans, total] = await Promise.all([
    prisma.smsShowLoan.findMany({
      where,
      take: TASK_LIMIT,
      orderBy: { expectedReturnDate: 'asc' },
      select: {
        id: true,
        unit: { select: { vin: true } },
        eventName: true,
        pic: { select: { id: true, name: true } },
        expectedReturnDate: true,
      },
    }),
    prisma.smsShowLoan.count({ where }),
  ]);

  const data: OverdueShowUnitTask[] = loans.map((l) => ({
    loanId: l.id,
    vin: l.unit.vin,
    eventName: l.eventName,
    pic: l.pic ? { id: l.pic.id, name: l.pic.name } : null,
    expectedReturnDate: l.expectedReturnDate,
    daysOverdue: Math.floor((today.getTime() - l.expectedReturnDate.getTime()) / MS_PER_DAY),
  }));

  return { data, total };
}
