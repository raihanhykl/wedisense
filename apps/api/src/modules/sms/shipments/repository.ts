/**
 * Data-access layer for the shipments slice.
 *
 * All multi-table writes go through the transaction client passed in by the
 * service layer. Read-only helpers may use the global Prisma client directly.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type { PrismaTransactionClient } from '../lib/types.js';
import type { ShipmentCounts } from './types.js';

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function findShipmentById(id: string) {
  return prisma.smsShipment.findUnique({
    where: { id },
    include: {
      destinationLocation: { select: { id: true, name: true, type: true } },
      originLocation: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

export async function findShipmentByKey(
  destinationLocationId: string,
  batchNumber: string,
  deliveryNoteNumber: string,
) {
  return prisma.smsShipment.findUnique({
    where: {
      destinationLocationId_batchNumber_deliveryNoteNumber: {
        destinationLocationId,
        batchNumber,
        deliveryNoteNumber,
      },
    },
  });
}

export async function findLinesByShipmentId(shipmentId: string) {
  return prisma.smsShipmentLine.findMany({
    where: { shipmentId },
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          color: true,
          model: { select: { code: true, name: true } },
        },
      },
      unit: { select: { id: true, status: true } },
      receivedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** Check which of `vins` already exist as lines in the given shipment. */
export async function findExistingLinesInShipment(
  shipmentId: string,
  vins: string[],
) {
  return prisma.smsShipmentLine.findMany({
    where: { shipmentId, vin: { in: vins } },
    select: { vin: true },
  });
}

/** Check which of `vins` already exist as lines in OTHER shipments. */
export async function findLinesInOtherShipments(
  excludeShipmentId: string | null,
  vins: string[],
) {
  return prisma.smsShipmentLine.findMany({
    where: {
      vin: { in: vins },
      ...(excludeShipmentId ? { shipmentId: { not: excludeShipmentId } } : {}),
    },
    select: {
      vin: true,
      shipment: {
        select: {
          batchNumber: true,
          destinationLocation: { select: { name: true } },
        },
      },
    },
  });
}

/** Check which of `vins` already exist as SmsUnit rows. */
export async function findExistingUnits(vins: string[]) {
  return prisma.smsUnit.findMany({
    where: { vin: { in: vins } },
    select: { vin: true, status: true },
  });
}

export async function findAllVariantsForMatching() {
  return prisma.smsVehicleVariant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      color: true,
      model: { select: { code: true, name: true } },
    },
  });
}

export async function findDestinationLocation(locationId: string) {
  return prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, type: true, isActive: true },
  });
}

// ── List query ────────────────────────────────────────────────────────────────

export async function listShipments(opts: {
  destinationIds: 'ALL' | string[];
  destinationLocationId?: string;
  state?: 'open' | 'complete' | 'all';
  search?: string;
  skip: number;
  take: number;
}) {
  const locationFilter =
    opts.destinationIds === 'ALL'
      ? opts.destinationLocationId
        ? { destinationLocationId: opts.destinationLocationId }
        : {}
      : {
          destinationLocationId: {
            in: opts.destinationIds,
            ...(opts.destinationLocationId
              ? { equals: opts.destinationLocationId }
              : {}),
          },
        };

  // If the caller has no access anywhere, return empty
  if (opts.destinationIds !== 'ALL' && opts.destinationIds.length === 0) {
    return { shipments: [], total: 0 };
  }

  const stateFilter =
    opts.state === 'open'
      ? { lines: { some: { receiptStatus: 'PENDING' as const } } }
      : opts.state === 'complete'
        ? { lines: { none: { receiptStatus: 'PENDING' as const } } }
        : {};

  const searchFilter = opts.search
    ? {
        OR: [
          { batchNumber: { contains: opts.search, mode: 'insensitive' as const } },
          { deliveryNoteNumber: { contains: opts.search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const where: Prisma.SmsShipmentWhereInput = {
    ...locationFilter,
    ...stateFilter,
    ...searchFilter,
  };

  const [shipments, total] = await Promise.all([
    prisma.smsShipment.findMany({
      where,
      include: {
        destinationLocation: { select: { name: true } },
        originLocation: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.smsShipment.count({ where }),
  ]);

  return { shipments, total };
}

/** Compute counts for a set of shipment IDs in one grouped query. */
export async function getShipmentCounts(
  shipmentIds: string[],
  // Pass the transaction client when counting inside a mutation: the global
  // client reads from another connection and would not see the uncommitted
  // changes, so the response would report the counts from BEFORE the write.
  client: Pick<PrismaTransactionClient, 'smsShipmentLine'> = prisma,
): Promise<Map<string, ShipmentCounts>> {
  if (shipmentIds.length === 0) return new Map();

  const rows = await client.smsShipmentLine.groupBy({
    by: ['shipmentId', 'receiptStatus'],
    _count: { _all: true },
    where: { shipmentId: { in: shipmentIds } },
  });

  const result = new Map<string, ShipmentCounts>();

  for (const id of shipmentIds) {
    result.set(id, {
      expected: 0,
      receivedOk: 0,
      receivedDamaged: 0,
      discrepancy: 0,
      pending: 0,
    });
  }

  for (const row of rows) {
    const counts = result.get(row.shipmentId);
    if (!counts) continue;
    const n = row._count._all;
    counts.expected += n;
    switch (row.receiptStatus) {
      case 'RECEIVED_OK':
        counts.receivedOk += n;
        break;
      case 'RECEIVED_DAMAGED':
        counts.receivedDamaged += n;
        break;
      case 'DISCREPANCY':
        counts.discrepancy += n;
        break;
      case 'PENDING':
        counts.pending += n;
        break;
    }
  }

  return result;
}

// ── Write helpers (require a transaction client) ──────────────────────────────

export async function createShipment(
  tx: PrismaTransactionClient,
  data: {
    batchNumber: string;
    deliveryNoteNumber: string;
    destinationLocationId: string;
    originLocationId?: string | null;
    dispatchDate?: Date | null;
    notes?: string | null;
    sourceFileName?: string | null;
    columnMapping?: Prisma.InputJsonValue;
    createdByUserId: string;
  },
) {
  return tx.smsShipment.create({ data });
}

export async function appendLines(
  tx: PrismaTransactionClient,
  lines: Prisma.SmsShipmentLineCreateManyInput[],
) {
  return tx.smsShipmentLine.createMany({ data: lines, skipDuplicates: true });
}

export async function findLineById(
  tx: PrismaTransactionClient,
  lineId: string,
) {
  return tx.smsShipmentLine.findUnique({ where: { id: lineId } });
}

/** Lock line rows FOR UPDATE in sorted id order to prevent deadlocks. */
export async function lockLines(
  tx: PrismaTransactionClient,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const sorted = [...new Set(lineIds)].sort();
  await tx.$queryRaw`
    SELECT id FROM sms_shipment_lines
    WHERE id IN (${Prisma.join(sorted.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function findLockedLines(
  tx: PrismaTransactionClient,
  lineIds: readonly string[],
) {
  return tx.smsShipmentLine.findMany({
    where: { id: { in: [...lineIds] } },
  });
}

export async function updateLine(
  tx: PrismaTransactionClient,
  lineId: string,
  data: Prisma.SmsShipmentLineUncheckedUpdateInput,
) {
  return tx.smsShipmentLine.update({ where: { id: lineId }, data });
}

export async function createLine(
  tx: PrismaTransactionClient,
  data: Prisma.SmsShipmentLineUncheckedCreateInput,
) {
  return tx.smsShipmentLine.create({ data });
}

export async function createInspection(
  tx: PrismaTransactionClient,
  data: {
    unitId: string;
    reason: 'RECEIPT_DAMAGE' | 'IDENTITY_MISMATCH';
    findings: string | null;
    createdByUserId: string;
  },
) {
  return tx.smsInspection.create({
    data: {
      unitId: data.unitId,
      reason: data.reason,
      result: 'PENDING',
      findings: data.findings,
      createdByUserId: data.createdByUserId,
    },
  });
}
