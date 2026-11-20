import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type { OrderDetail, OrderListRow, OrderSummary } from './types.js';
import type { ListOrdersQuery } from './schema.js';
import type { PrismaTransactionClient } from '../lib/types.js';

// ── Shared select fragments ──────────────────────────────────────────────────

const locationSelect = { id: true, code: true, name: true } as const;
const personSelect = { id: true, name: true } as const;
const variantSelect = {
  id: true,
  name: true,
  color: true,
  model: { select: { id: true, code: true, name: true } },
} as const;

const orderLineSummarySelect = {
  status: true,
} as const;

// ── Summary computation ──────────────────────────────────────────────────────

function computeSummary(lines: Array<{ status: string }>): OrderSummary {
  const summary: OrderSummary = { total: lines.length, booked: 0, sold: 0, pickedUp: 0, cancelled: 0 };
  for (const line of lines) {
    switch (line.status) {
      case 'BOOKED': summary.booked++; break;
      case 'SOLD': summary.sold++; break;
      case 'PICKED_UP': summary.pickedUp++; break;
      case 'CANCELLED': summary.cancelled++; break;
    }
  }
  return summary;
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function findMany(
  query: ListOrdersQuery,
  scope: 'ALL' | string[],
  skip: number,
  take: number,
): Promise<{ data: OrderListRow[]; total: number }> {
  const whereBase: Prisma.SmsOrderWhereInput = {};

  if (scope !== 'ALL') {
    whereBase.showroomId = { in: scope };
  }
  if (query.showroomId) {
    whereBase.showroomId = query.showroomId;
  }
  if (query.status === 'open') {
    whereBase.lines = {
      some: { status: { in: ['BOOKED', 'SOLD'] } },
    };
  }
  if (query.search) {
    whereBase.OR = [
      { spkNumber: { contains: query.search, mode: 'insensitive' } },
      { customerName: { contains: query.search, mode: 'insensitive' } },
      { lines: { some: { unit: { vin: { contains: query.search, mode: 'insensitive' } } } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.smsOrder.findMany({
      where: whereBase,
      select: {
        id: true,
        spkNumber: true,
        showroom: { select: locationSelect },
        sales: { select: personSelect },
        customerName: true,
        customerPhone: true,
        createdAt: true,
        lines: { select: orderLineSummarySelect },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.smsOrder.count({ where: whereBase }),
  ]);

  const data: OrderListRow[] = rows.map((row) => ({
    id: row.id,
    spkNumber: row.spkNumber,
    showroom: row.showroom,
    sales: row.sales,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    createdAt: row.createdAt,
    summary: computeSummary(row.lines),
  }));

  return { data, total };
}

// ── Detail ───────────────────────────────────────────────────────────────────

export async function findById(id: string): Promise<OrderDetail | null> {
  const order = await prisma.smsOrder.findUnique({
    where: { id },
    select: {
      id: true,
      spkNumber: true,
      showroom: { select: locationSelect },
      sales: { select: personSelect },
      createdBy: { select: personSelect },
      customerName: true,
      customerPhone: true,
      customerIdNumber: true,
      notes: true,
      isOpeningBalance: true,
      createdAt: true,
      updatedAt: true,
      lines: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          bookedAt: true,
          followUpAt: true,
          cancelledAt: true,
          cancelReason: true,
          soldAt: true,
          pickedUpAt: true,
          receiverName: true,
          handoverReference: true,
          rtoHandoverAt: true,
          returnReceivedAt: true,
          returnReason: true,
          returnCondition: true,
          returnDecision: true,
          returnDecidedAt: true,
          returnDecisionReason: true,
          unit: {
            select: {
              id: true,
              vin: true,
              variant: { select: variantSelect },
              physicalLocation: { select: locationSelect },
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    spkNumber: order.spkNumber,
    showroom: order.showroom,
    sales: order.sales,
    createdBy: order.createdBy,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerIdNumber: order.customerIdNumber,
    customerIdNumberMasked: false, // caller decides whether to mask
    notes: order.notes,
    isOpeningBalance: order.isOpeningBalance,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    lines: order.lines.map((line) => ({
      id: line.id,
      status: line.status,
      bookedAt: line.bookedAt,
      followUpAt: line.followUpAt,
      cancelledAt: line.cancelledAt,
      cancelReason: line.cancelReason,
      soldAt: line.soldAt,
      pickedUpAt: line.pickedUpAt,
      receiverName: line.receiverName,
      handoverReference: line.handoverReference,
      rtoHandoverAt: line.rtoHandoverAt,
      returnReceivedAt: line.returnReceivedAt,
      returnReason: line.returnReason,
      returnCondition: line.returnCondition,
      returnDecision: line.returnDecision,
      returnDecidedAt: line.returnDecidedAt,
      returnDecisionReason: line.returnDecisionReason,
      unit: line.unit,
    })),
    summary: computeSummary(order.lines),
  };
}

// ── SPK uniqueness check (non-locking) ───────────────────────────────────────

export async function findOrderBySpk(
  showroomId: string,
  spkNumber: string,
): Promise<{ id: string; showroomId: string } | null> {
  return prisma.smsOrder.findUnique({
    where: { showroomId_spkNumber: { showroomId, spkNumber } },
    select: { id: true, showroomId: true },
  });
}

// ── Line retrieval ───────────────────────────────────────────────────────────

export async function findOrderWithLine(
  tx: PrismaTransactionClient,
  orderId: string,
  lineId: string,
) {
  const order = await tx.smsOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      showroomId: true,
      spkNumber: true,
      isOpeningBalance: true,
    },
  });
  if (!order) return { order: null, line: null };

  const line = await tx.smsOrderLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      orderId: true,
      unitId: true,
      status: true,
      bookedAt: true,
      cancelledAt: true,
      soldAt: true,
      pickedUpAt: true,
      receiverName: true,
      handoverReference: true,
      followUpAt: true,
      rtoHandoverAt: true,
      returnReceivedAt: true,
      returnReason: true,
      returnCondition: true,
      returnDecision: true,
      returnDecidedAt: true,
      returnDecisionReason: true,
    },
  });
  if (!line || line.orderId !== orderId) return { order, line: null };
  return { order, line };
}

// ── Lines for record-sale ────────────────────────────────────────────────────

export async function findLinesByOrder(
  tx: PrismaTransactionClient,
  orderId: string,
  lineIds: string[],
) {
  return tx.smsOrderLine.findMany({
    where: { id: { in: lineIds }, orderId },
    select: {
      id: true,
      orderId: true,
      unitId: true,
      status: true,
      soldAt: true,
    },
  });
}

// ── Booking conflict helpers ─────────────────────────────────────────────────

/**
 * Load the order line info needed to build the `currentHolder` field of a
 * booking conflict: SPK number + sales person name.
 */
export async function findCurrentHolder(
  tx: PrismaTransactionClient,
  orderLineId: string,
): Promise<{ spkNumber: string; salesName: string | null } | null> {
  const line = await tx.smsOrderLine.findUnique({
    where: { id: orderLineId },
    select: {
      order: { select: { spkNumber: true, sales: { select: { name: true } } } },
    },
  });
  if (!line) return null;
  return {
    spkNumber: line.order.spkNumber,
    salesName: line.order.sales?.name ?? null,
  };
}

/**
 * Find up to `limit` alternative AVAILABLE units at the same showroom, same
 * variant (sorted: same color first by variant.color ordering, then by VIN).
 * Units whose IDs are in `excludeIds` are skipped.
 */
export async function findAlternatives(
  tx: PrismaTransactionClient,
  variantId: string,
  showroomId: string,
  excludeIds: string[],
  limit = 5,
): Promise<Array<{ id: string; vin: string; color: string; variantName: string; modelName: string }>> {
  const rows = await tx.smsUnit.findMany({
    where: {
      variantId,
      physicalLocationId: showroomId,
      status: 'AVAILABLE',
      activeOrderLineId: null,
      id: { notIn: excludeIds.length > 0 ? excludeIds : [''] },
    },
    select: {
      id: true,
      vin: true,
      variant: { select: { color: true, name: true, model: { select: { name: true } } } },
    },
    orderBy: [{ variant: { color: 'asc' } }, { vin: 'asc' }],
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    vin: r.vin,
    color: r.variant.color,
    variantName: r.variant.name,
    modelName: r.variant.model.name,
  }));
}

// ── Lock existing units for booking (handles NOT_FOUND gracefully) ────────────

/**
 * Lock the rows that exist and return them. Unlike `lockUnits` from ledger.ts,
 * this does NOT throw on a missing ID — missing IDs are returned as null so
 * the caller can build a complete per-VIN conflict report.
 */
export async function lockUnitsForBooking(
  tx: PrismaTransactionClient,
  unitIds: readonly string[],
): Promise<Map<string, import('@prisma/client').SmsUnit | null>> {
  const uniqueIds = [...new Set(unitIds)].sort();
  if (uniqueIds.length === 0) return new Map();

  // Lock only the rows that exist; missing IDs simply won't appear.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM sms_units WHERE id IN (${Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`,
  );

  const rows = await tx.smsUnit.findMany({ where: { id: { in: uniqueIds } } });
  const byId = new Map<string, import('@prisma/client').SmsUnit | null>(
    uniqueIds.map((id) => [id, null]),
  );
  for (const row of rows) byId.set(row.id, row);
  return byId;
}

// ── Validate salesUserId ─────────────────────────────────────────────────────

export async function validateSalesUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  return user !== null;
}
