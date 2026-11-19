/**
 * The single write path for unit state.
 *
 * Nothing else in the codebase may insert into `sms_unit_events` or change a
 * unit's status / location columns. Going through here guarantees that:
 *
 *  - the unit row was locked first, so concurrent writers on the same VIN
 *    are serialised (two admins booking one VIN: exactly one wins);
 *  - the transition was validated by the pure reducer (unit-state.ts);
 *  - the ledger event and the unit projection are written together.
 *
 * Usage inside `smsTransaction`:
 *
 *   const [unit] = await lockUnits(tx, [unitId]);
 *   assertCan(access, SMS_PERMISSIONS.ORDERS_MANAGE, unit.physicalLocationId);
 *   const { unit: updated, event } = await recordUnitEvent(tx, unit, { ... });
 */
import { Prisma, type SmsUnit, type SmsUnitEvent } from '@prisma/client';
import { AppError } from '../../../middleware/error-handler.js';
import { applyUnitEvent, type SmsUnitEventInput, type SmsUnitState } from './unit-state.js';
import type { PrismaTransactionClient } from './types.js';

// ── Locking ────────────────────────────────────────────────────────────────

/**
 * Lock unit rows `FOR UPDATE` and return them fresh, in the order requested.
 *
 * Ids are locked in sorted order so two multi-unit operations that overlap
 * can never deadlock by taking the same locks in opposite order. The lock has
 * no status filter on purpose: the caller must always get the row, read its
 * CURRENT state, and decide — otherwise a blocked request would see "not
 * found" instead of "already booked by …".
 */
export async function lockUnits(
  tx: PrismaTransactionClient,
  unitIds: readonly string[],
): Promise<SmsUnit[]> {
  const uniqueIds = [...new Set(unitIds)].sort();
  if (uniqueIds.length === 0) return [];

  await tx.$queryRaw`
    SELECT id FROM sms_units
    WHERE id IN (${Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR UPDATE
  `;

  const rows = await tx.smsUnit.findMany({ where: { id: { in: uniqueIds } } });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return unitIds.map((id) => {
    const unit = byId.get(id);
    if (!unit) {
      throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found', [{ unitId: id }]);
    }
    return unit;
  });
}

// ── Reducer input ⇄ stored columns ─────────────────────────────────────────

type StoredEventShape = Pick<SmsUnitEvent, 'eventType' | 'locationId' | 'payload'>;

/** Columns that persist the reducer inputs of an event. */
export function toStoredEvent(event: SmsUnitEventInput): {
  eventType: SmsUnitEvent['eventType'];
  locationId: string | null;
  payload: Prisma.InputJsonValue | typeof Prisma.JsonNull;
} {
  switch (event.type) {
    case 'OPENING_BALANCE':
      return {
        eventType: event.type,
        locationId: event.physicalLocationId,
        payload: {
          status: event.status,
          physicalLocationId: event.physicalLocationId,
          responsibleShowroomId: event.responsibleShowroomId,
          wasRto: event.wasRto ?? event.status === 'ACTIVE_RTO',
        },
      };
    case 'IDENTITY_RESOLVED':
    case 'SHOW_UNIT_RETURNED':
      return { eventType: event.type, locationId: null, payload: { outcome: event.outcome } };
    case 'RECEIPT_OK':
    case 'RECEIPT_DAMAGED':
    case 'IDENTITY_MISMATCH_FOUND':
    case 'SALE_RETURN_RECEIVED':
    case 'RTO_RETURNED':
    case 'CUSTODY_RECEIVED':
    case 'OFFICIAL_RECEIPT_CONFIRMED':
      return { eventType: event.type, locationId: event.locationId, payload: Prisma.JsonNull };
    default:
      return { eventType: event.type, locationId: null, payload: Prisma.JsonNull };
  }
}

/**
 * Rebuild the reducer input from a stored event — the inverse of
 * `toStoredEvent`. Used when replaying a unit's effective ledger.
 */
export function toReducerInput(row: StoredEventShape): SmsUnitEventInput {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const corrupt = (detail: string): never => {
    throw new Error(`Stored ${row.eventType} event is missing ${detail}`);
  };

  switch (row.eventType) {
    case 'OPENING_BALANCE':
      return {
        type: row.eventType,
        status: (payload['status'] as SmsUnitState['status'] | undefined) ?? corrupt('payload.status'),
        physicalLocationId: (payload['physicalLocationId'] as string | null | undefined) ?? null,
        responsibleShowroomId:
          (payload['responsibleShowroomId'] as string | undefined) ??
          corrupt('payload.responsibleShowroomId'),
        wasRto: payload['wasRto'] === true,
      };
    case 'IDENTITY_RESOLVED':
    case 'SHOW_UNIT_RETURNED': {
      const outcome = payload['outcome'];
      if (outcome !== 'AVAILABLE' && outcome !== 'INSPECTION') return corrupt('payload.outcome');
      return { type: row.eventType, outcome };
    }
    case 'RECEIPT_OK':
    case 'RECEIPT_DAMAGED':
    case 'IDENTITY_MISMATCH_FOUND':
    case 'SALE_RETURN_RECEIVED':
    case 'RTO_RETURNED':
    case 'CUSTODY_RECEIVED':
    case 'OFFICIAL_RECEIPT_CONFIRMED':
      return { type: row.eventType, locationId: row.locationId ?? corrupt('locationId') };
    default:
      return { type: row.eventType };
  }
}

// ── Writing ────────────────────────────────────────────────────────────────

export interface UnitEventLinks {
  shipmentLineId?: string;
  orderLineId?: string;
  rtoContractId?: string;
  returnRequestId?: string;
  showLoanId?: string;
  inspectionId?: string;
}

export interface RecordUnitEventInput {
  event: SmsUnitEventInput;
  /** Business date of the event; may be earlier than today for late input. */
  eventDate: Date;
  /** Null only for system-originated events. */
  performedByUserId: string | null;
  reason?: string | null;
  notes?: string | null;
  attachments?: Prisma.InputJsonValue;
  links?: UnitEventLinks;
  /**
   * Other unit columns to write in the same UPDATE — typically the
   * "at most one" pointers (activeOrderLineId, openRtoContractId, …) or
   * identity fields. Status and location columns are not accepted here: they
   * come from the reducer only.
   */
  unitChanges?: Omit<
    Prisma.SmsUnitUncheckedUpdateInput,
    'status' | 'physicalLocationId' | 'responsibleShowroomId' | 'wasRto' | 'id' | 'vin'
  >;
}

export interface NewUnitData {
  vin: string;
  engineNumber?: string | null;
  licensePlate?: string | null;
  variantId: string;
  shipmentId?: string | null;
  isOpeningBalance?: boolean;
  receivedAt?: Date | null;
  notes?: string | null;
  createdByUserId: string;
}

function invalidTransition(reason: string, unit: { id?: string; vin: string; status?: string }): AppError {
  return new AppError(409, 'SMS_INVALID_TRANSITION', reason, [
    { unitId: unit.id, vin: unit.vin, status: unit.status },
  ]);
}

function eventData(
  unitId: string,
  input: RecordUnitEventInput,
  state: SmsUnitState,
): Prisma.SmsUnitEventUncheckedCreateInput {
  const stored = toStoredEvent(input.event);
  return {
    unitId,
    eventType: stored.eventType,
    locationId: stored.locationId,
    payload: stored.payload,
    eventDate: input.eventDate,
    performedByUserId: input.performedByUserId,
    statusAfter: state.status,
    physicalLocationAfterId: state.physicalLocationId,
    responsibleShowroomAfterId: state.responsibleShowroomId,
    reason: input.reason ?? null,
    notes: input.notes ?? null,
    attachments: input.attachments,
    ...input.links,
  };
}

/**
 * Apply `input.event` to a unit that the caller has already locked with
 * `lockUnits`, append the ledger event and update the projection.
 */
export async function recordUnitEvent(
  tx: PrismaTransactionClient,
  unit: SmsUnit,
  input: RecordUnitEventInput,
): Promise<{ unit: SmsUnit; event: SmsUnitEvent }> {
  const result = applyUnitEvent(
    {
      status: unit.status,
      physicalLocationId: unit.physicalLocationId,
      responsibleShowroomId: unit.responsibleShowroomId,
      wasRto: unit.wasRto,
    },
    input.event,
  );
  if (!result.ok) throw invalidTransition(result.reason, unit);

  const event = await tx.smsUnitEvent.create({ data: eventData(unit.id, input, result.state) });
  const updated = await tx.smsUnit.update({
    where: { id: unit.id },
    data: {
      ...input.unitChanges,
      status: result.state.status,
      physicalLocationId: result.state.physicalLocationId,
      responsibleShowroomId: result.state.responsibleShowroomId,
      wasRto: result.state.wasRto,
    },
  });
  return { unit: updated, event };
}

/**
 * Create a unit together with its first ledger event (physical receipt,
 * identity finding or opening balance). The VIN's unique constraint is what
 * makes receipt exactly-once: a second attempt for the same VIN fails here.
 */
export async function createUnitWithEvent(
  tx: PrismaTransactionClient,
  data: NewUnitData,
  input: RecordUnitEventInput,
): Promise<{ unit: SmsUnit; event: SmsUnitEvent }> {
  const result = applyUnitEvent(null, input.event);
  if (!result.ok) throw invalidTransition(result.reason, { vin: data.vin });

  let unit: SmsUnit;
  try {
    unit = await tx.smsUnit.create({
      data: {
        vin: data.vin,
        engineNumber: data.engineNumber ?? null,
        licensePlate: data.licensePlate ?? null,
        variantId: data.variantId,
        shipmentId: data.shipmentId ?? null,
        isOpeningBalance: data.isOpeningBalance ?? false,
        receivedAt: data.receivedAt ?? null,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId,
        ...input.unitChanges,
        status: result.state.status,
        physicalLocationId: result.state.physicalLocationId,
        responsibleShowroomId: result.state.responsibleShowroomId,
        wasRto: result.state.wasRto,
      } as Prisma.SmsUnitUncheckedCreateInput,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'SMS_VIN_ALREADY_EXISTS', `VIN ${data.vin} is already registered`, [
        { vin: data.vin },
      ]);
    }
    throw error;
  }

  const event = await tx.smsUnitEvent.create({ data: eventData(unit.id, input, result.state) });
  return { unit, event };
}

// ── Reading the effective ledger ───────────────────────────────────────────

/**
 * A unit's effective ledger, oldest first: every event except those that a
 * later correction superseded or voided.
 */
export async function loadEffectiveEvents(
  tx: PrismaTransactionClient,
  unitId: string,
): Promise<SmsUnitEvent[]> {
  return tx.smsUnitEvent.findMany({
    where: { unitId, supersededBy: null, voidedBy: null },
    orderBy: { seq: 'asc' },
  });
}

// ── Business dates ─────────────────────────────────────────────────────────

const BUSINESS_TIME_ZONE = process.env['JOB_TIMEZONE'] ?? 'Asia/Jakarta';

/** Today's calendar date in the business time zone, as a UTC-midnight Date. */
export function businessToday(now: Date = new Date()): Date {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/**
 * Resolve the business date of an event from optional `YYYY-MM-DD` input.
 * Defaults to today; late input (a past date) is allowed, a future date is
 * not — an event cannot have happened tomorrow.
 */
export function resolveEventDate(input: string | undefined, now: Date = new Date()): Date {
  const today = businessToday(now);
  if (input === undefined) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'eventDate must be formatted as YYYY-MM-DD');
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(422, 'VALIDATION_ERROR', 'eventDate is not a valid date');
  }
  if (date.getTime() > today.getTime()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'eventDate cannot be in the future');
  }
  return date;
}
