import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type { UnitListRow, UnitDetail, UnitSearchResult } from './types.js';
import type { UnitView } from './views.js';
import { unitViewWhere } from './views.js';

// ── Shared select fragments ──────────────────────────────────────────────────

const locationSelect = { id: true, code: true, name: true } as const;

const variantSelect = {
  id: true,
  name: true,
  batteryVariant: true,
  color: true,
  model: { select: { id: true, code: true, name: true } },
} as const;

const unitListSelect = {
  id: true,
  vin: true,
  engineNumber: true,
  licensePlate: true,
  status: true,
  wasRto: true,
  isOpeningBalance: true,
  receivedAt: true,
  updatedAt: true,
  variant: { select: variantSelect },
  physicalLocation: { select: locationSelect },
  responsibleShowroom: { select: locationSelect },
} as const;

// ── List ─────────────────────────────────────────────────────────────────────

type SortColumn = 'vin' | 'status' | 'receivedAt' | 'updatedAt';

function buildOrderBy(
  sortBy: SortColumn,
  sortOrder: 'asc' | 'desc',
): Prisma.SmsUnitOrderByWithRelationInput {
  return { [sortBy]: sortOrder };
}

export async function findMany(opts: {
  showroomId: string;
  view: UnitView;
  modelId?: string;
  variantId?: string;
  search?: string;
  sortBy: SortColumn;
  sortOrder: 'asc' | 'desc';
  skip: number;
  take: number;
}): Promise<{ data: UnitListRow[]; total: number }> {
  const baseWhere = unitViewWhere(opts.view, opts.showroomId);

  const extraFilters: Prisma.SmsUnitWhereInput = {};
  if (opts.variantId) {
    extraFilters.variantId = opts.variantId;
  } else if (opts.modelId) {
    extraFilters.variant = { modelId: opts.modelId };
  }
  if (opts.search) {
    extraFilters.OR = [
      { vin: { contains: opts.search, mode: 'insensitive' } },
      { engineNumber: { contains: opts.search, mode: 'insensitive' } },
      { licensePlate: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  const where: Prisma.SmsUnitWhereInput =
    Object.keys(extraFilters).length > 0 ? { AND: [baseWhere, extraFilters] } : baseWhere;

  const [rows, total] = await Promise.all([
    prisma.smsUnit.findMany({
      where,
      select: unitListSelect,
      orderBy: buildOrderBy(opts.sortBy, opts.sortOrder),
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.smsUnit.count({ where }),
  ]);

  return { data: rows as UnitListRow[], total };
}

// ── Detail (VIN card) ─────────────────────────────────────────────────────────

export async function findById(id: string): Promise<UnitDetail | null> {
  const unit = await prisma.smsUnit.findUnique({
    where: { id },
    select: {
      id: true,
      vin: true,
      engineNumber: true,
      licensePlate: true,
      status: true,
      wasRto: true,
      isOpeningBalance: true,
      notes: true,
      receivedAt: true,
      createdAt: true,
      updatedAt: true,
      activeOrderLineId: true,
      openRtoContractId: true,
      openReturnRequestId: true,
      variant: { select: variantSelect },
      physicalLocation: { select: locationSelect },
      responsibleShowroom: { select: locationSelect },
      // Shipment info comes from the linked shipment line's shipment.
      shipmentLine: {
        select: {
          shipment: {
            select: {
              id: true,
              batchNumber: true,
              deliveryNoteNumber: true,
              dispatchDate: true,
              destinationLocation: { select: locationSelect },
            },
          },
        },
      },
      // Also include direct shipment relation as fallback (e.g. opening balance).
      shipment: {
        select: {
          id: true,
          batchNumber: true,
          deliveryNoteNumber: true,
          dispatchDate: true,
          destinationLocation: { select: locationSelect },
        },
      },
      inspections: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reason: true,
          result: true,
          condition: true,
          odometer: true,
          findings: true,
          notes: true,
          inspector: { select: { id: true, name: true } },
          inspectedAt: true,
          createdAt: true,
        },
      },
      events: {
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          seq: true,
          eventType: true,
          eventDate: true,
          recordedAt: true,
          statusAfter: true,
          reason: true,
          notes: true,
          performedBy: { select: { id: true, name: true } },
          location: { select: locationSelect },
          // Non-null means this event is superseded / voided by another.
          supersededBy: { select: { id: true } },
          voidedBy: { select: { id: true } },
        },
      },
    },
  });

  if (!unit) return null;

  // Resolve shipment info: prefer the specific shipment line's shipment.
  const shipmentSource = unit.shipmentLine?.shipment ?? unit.shipment ?? null;

  return {
    id: unit.id,
    vin: unit.vin,
    engineNumber: unit.engineNumber,
    licensePlate: unit.licensePlate,
    status: unit.status,
    wasRto: unit.wasRto,
    isOpeningBalance: unit.isOpeningBalance,
    notes: unit.notes,
    receivedAt: unit.receivedAt,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
    // Forward the commitment pointers — the service uses them for action computation.
    // These are stripped before sending to the client.
    // We use a type assertion here because UnitDetail doesn't expose them directly;
    // the service extracts them separately before mapping to the final shape.
    variant: unit.variant,
    physicalLocation: unit.physicalLocation,
    responsibleShowroom: unit.responsibleShowroom,
    shipment: shipmentSource
      ? {
          id: shipmentSource.id,
          batchNumber: shipmentSource.batchNumber,
          deliveryNoteNumber: shipmentSource.deliveryNoteNumber,
          dispatchDate: shipmentSource.dispatchDate,
          destination: shipmentSource.destinationLocation,
        }
      : null,
    inspections: unit.inspections.map((i) => ({
      id: i.id,
      reason: i.reason,
      result: i.result,
      condition: i.condition,
      odometer: i.odometer,
      findings: i.findings,
      notes: i.notes,
      inspector: i.inspector,
      inspectedAt: i.inspectedAt,
      createdAt: i.createdAt,
    })),
    timeline: unit.events.map((e) => ({
      id: e.id,
      seq: e.seq,
      eventType: e.eventType,
      eventDate: e.eventDate,
      recordedAt: e.recordedAt,
      performedBy: e.performedBy,
      location: e.location,
      statusAfter: e.statusAfter,
      reason: e.reason,
      notes: e.notes,
      isSuperseded: e.supersededBy !== null,
      isVoided: e.voidedBy !== null,
    })),
    // Placeholder; computed in the service using the access map.
    availableActions: [],
    releaseBlockers: [],
  };
}

/** Raw unit fields needed for action computation and locking — no joins. */
export async function findRawById(id: string) {
  return prisma.smsUnit.findUnique({
    where: { id },
    select: {
      id: true,
      vin: true,
      status: true,
      physicalLocationId: true,
      responsibleShowroomId: true,
      activeOrderLineId: true,
      openRtoContractId: true,
      openReturnRequestId: true,
      engineNumber: true,
      licensePlate: true,
      notes: true,
    },
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Search registered units visible to the caller.
 *
 * A unit is visible when the caller holds STOCK_VIEW at its physicalLocationId
 * OR its responsibleShowroomId. The scope parameter is derived from
 * `locationScope(access, STOCK_VIEW)`.
 */
export async function searchUnits(
  q: string,
  scope: 'ALL' | string[],
): Promise<
  Array<{
    id: string;
    vin: string;
    engineNumber: string | null;
    licensePlate: string | null;
    status: import('@prisma/client').SmsUnitStatus;
    variant: { id: string; name: string; batteryVariant: string | null; color: string; model: { id: string; code: string; name: string } };
    physicalLocation: { id: string; code: string; name: string } | null;
    responsibleShowroom: { id: string; code: string; name: string };
  }>
> {
  const locationFilter: Prisma.SmsUnitWhereInput =
    scope === 'ALL'
      ? {}
      : {
          OR: [
            { physicalLocationId: { in: scope } },
            { responsibleShowroomId: { in: scope } },
          ],
        };

  return prisma.smsUnit.findMany({
    where: {
      AND: [
        locationFilter,
        {
          OR: [
            { vin: { contains: q, mode: 'insensitive' } },
            { engineNumber: { contains: q, mode: 'insensitive' } },
            { licensePlate: { contains: q, mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      vin: true,
      engineNumber: true,
      licensePlate: true,
      status: true,
      variant: { select: variantSelect },
      physicalLocation: { select: locationSelect },
      responsibleShowroom: { select: locationSelect },
    },
    // Over-fetch a bit so we can re-rank in JS; the final cap is 20.
    take: 60,
  });
}

/**
 * Search expected (pending) VINs from shipment lines.
 */
export async function searchExpectedVins(
  q: string,
  scope: 'ALL' | string[],
): Promise<
  Array<{
    vin: string;
    shipmentId: string;
    batchNumber: string;
    destination: { id: string; code: string; name: string };
  }>
> {
  const locationFilter: Prisma.SmsShipmentLineWhereInput =
    scope === 'ALL'
      ? {}
      : { shipment: { destinationLocationId: { in: scope } } };

  const rows = await prisma.smsShipmentLine.findMany({
    where: {
      AND: [
        locationFilter,
        { receiptStatus: 'PENDING' },
        { vin: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      vin: true,
      shipment: {
        select: {
          id: true,
          batchNumber: true,
          destinationLocation: { select: locationSelect },
        },
      },
    },
    take: 20,
  });

  return rows.map((row) => ({
    vin: row.vin,
    shipmentId: row.shipment.id,
    batchNumber: row.shipment.batchNumber,
    destination: row.shipment.destinationLocation,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Rank a unit result for search ordering.
 * 1 = exact VIN match, 2 = VIN suffix, 3 = VIN/field contains
 */
export function rankSearchResult(
  row: { vin: string; engineNumber: string | null; licensePlate: string | null },
  q: string,
): number {
  const lq = q.toLowerCase();
  const vin = row.vin.toLowerCase();
  if (vin === lq) return 1;
  if (vin.endsWith(lq)) return 2;
  return 3;
}

export function buildSearchResults(
  units: Awaited<ReturnType<typeof searchUnits>>,
  expected: Awaited<ReturnType<typeof searchExpectedVins>>,
  q: string,
  maxTotal = 20,
): UnitSearchResult[] {
  const ranked = units
    .map((u) => ({ ...u, rank: rankSearchResult(u, q) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxTotal);

  const results: UnitSearchResult[] = ranked.map((u) => ({
    kind: 'unit' as const,
    id: u.id,
    vin: u.vin,
    engineNumber: u.engineNumber,
    licensePlate: u.licensePlate,
    status: u.status,
    variant: u.variant,
    physicalLocation: u.physicalLocation,
    responsibleShowroom: u.responsibleShowroom,
  }));

  // Fill remaining slots (up to maxTotal) with expected VINs not already seen.
  const registeredVins = new Set(ranked.map((u) => u.vin.toLowerCase()));
  for (const e of expected) {
    if (results.length >= maxTotal) break;
    if (registeredVins.has(e.vin.toLowerCase())) continue;
    results.push({
      kind: 'expected' as const,
      vin: e.vin,
      shipmentId: e.shipmentId,
      batchNumber: e.batchNumber,
      destination: e.destination,
    });
  }

  return results;
}
