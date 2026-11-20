/**
 * Unit state machine — the single definition of how a motorcycle's state
 * changes.
 *
 * This module is PURE: no database, no clock, no I/O. Every write path calls
 * `applyUnitEvent` to compute the next state before it persists anything, and
 * corrections/reports call `replayUnitEvents` over a unit's effective ledger.
 * Keeping it pure is what makes every transition testable without a database
 * and guarantees that live writes, corrections and reports can never disagree
 * about what an event means.
 *
 * A unit carries three independent facts (spec §2):
 *   - physicalLocationId    where the motorcycle physically is, or null when
 *                           it is not inside any showroom
 *   - responsibleShowroomId which showroom answers for it
 *   - status                its lifecycle stage
 *
 * Stock definitions follow directly from them:
 *   physical stock of showroom L  ⇔  physicalLocationId === L
 *   ready to offer at showroom L  ⇔  physicalLocationId === L && status === 'AVAILABLE'
 */
import type { SmsUnitEventType, SmsUnitStatus } from '@prisma/client';

export interface SmsUnitState {
  status: SmsUnitStatus;
  physicalLocationId: string | null;
  responsibleShowroomId: string;
  /** Set on the first RTO handover and never cleared. */
  wasRto: boolean;
}

/** Statuses in which the motorcycle is physically inside a showroom. */
export const IN_SHOWROOM_STATUSES: ReadonlySet<SmsUnitStatus> = new Set<SmsUnitStatus>([
  'AVAILABLE',
  'BOOKED',
  'SOLD_PENDING_PICKUP',
  'CUSTODY',
  'INSPECTION',
  'IDENTITY_MISMATCH',
]);

/** Statuses a unit may be given by the opening-balance (cutover) import. */
export const OPENING_BALANCE_STATUSES: ReadonlySet<SmsUnitStatus> = new Set<SmsUnitStatus>([
  'AVAILABLE',
  'BOOKED',
  'SOLD_PENDING_PICKUP',
  'ACTIVE_RTO',
  'CUSTODY',
  'INSPECTION',
  'SHOW_UNIT',
]);

/**
 * Reducer input: the event type plus the few facts the transition depends on.
 * Everything else about an event (who, when, notes, links) is irrelevant to
 * the resulting state and lives only on the SmsUnitEvent row.
 */
export type SmsUnitEventInput =
  | {
      type: 'OPENING_BALANCE';
      status: SmsUnitStatus;
      physicalLocationId: string | null;
      responsibleShowroomId: string;
      wasRto?: boolean;
    }
  | { type: 'RECEIPT_OK' | 'RECEIPT_DAMAGED' | 'IDENTITY_MISMATCH_FOUND'; locationId: string }
  | { type: 'IDENTITY_RESOLVED' | 'SHOW_UNIT_RETURNED'; outcome: 'AVAILABLE' | 'INSPECTION' }
  | {
      type:
        | 'SALE_RETURN_RECEIVED'
        | 'RTO_RETURNED'
        | 'CUSTODY_RECEIVED'
        | 'OFFICIAL_RECEIPT_CONFIRMED';
      locationId: string;
    }
  | {
      type:
        | 'INSPECTION_STARTED'
        | 'INSPECTION_PASSED'
        | 'INSPECTION_FAILED'
        | 'UNIT_RELEASED'
        | 'BOOKING_CREATED'
        | 'BOOKING_CANCELLED'
        | 'SALE_RECORDED'
        | 'PICKUP_CONFIRMED'
        | 'SALE_RETURN_APPROVED'
        | 'SALE_RETURN_REJECTED'
        | 'RTO_STARTED'
        | 'RTO_OWNERSHIP_TRANSFERRED'
        | 'RTO_CONTRACT_CLOSED'
        | 'RETURN_REQUESTED'
        | 'RETURN_APPROVED'
        | 'RETURN_REJECTED'
        | 'CUSTODY_HANDED_BACK'
        | 'SHOW_UNIT_DISPATCHED'
        | 'EVENT_VOIDED';
    };

// Compile-time guarantee that the reducer input covers every event type in
// the database enum. Adding an enum value without handling it here fails
// the type check instead of silently falling through at runtime.
type _MissingEventTypes = Exclude<SmsUnitEventType, SmsUnitEventInput['type']>;
type _UnknownEventTypes = Exclude<SmsUnitEventInput['type'], SmsUnitEventType>;
const _eventTypesAreExhaustive: [_MissingEventTypes, _UnknownEventTypes] extends [never, never]
  ? true
  : never = true;
void _eventTypesAreExhaustive;

export type ApplyResult =
  | { ok: true; state: SmsUnitState }
  | { ok: false; reason: string };

const ok = (state: SmsUnitState): ApplyResult => ({ ok: true, state });
const invalid = (reason: string): ApplyResult => ({ ok: false, reason });

function requireStatus(
  state: SmsUnitState,
  event: SmsUnitEventInput,
  allowed: readonly SmsUnitStatus[],
): string | null {
  if (allowed.includes(state.status)) return null;
  return `${event.type} is not allowed while the unit is ${state.status} (expected ${allowed.join(' or ')})`;
}

/** Events that create the unit: they only apply when there is no state yet. */
const CREATING_EVENTS: ReadonlySet<SmsUnitEventInput['type']> = new Set([
  'OPENING_BALANCE',
  'RECEIPT_OK',
  'RECEIPT_DAMAGED',
  'IDENTITY_MISMATCH_FOUND',
]);

/**
 * Compute the state after `event`. `state` is null only for the event that
 * brings the unit into existence. Never throws — an illegal transition comes
 * back as `{ ok: false, reason }` so callers decide how to surface it.
 */
export function applyUnitEvent(state: SmsUnitState | null, event: SmsUnitEventInput): ApplyResult {
  if (state === null) {
    if (!CREATING_EVENTS.has(event.type)) {
      return invalid(`${event.type} cannot be the first event of a unit`);
    }
    return applyCreatingEvent(event);
  }
  if (CREATING_EVENTS.has(event.type)) {
    return invalid(`${event.type} is only valid as the first event of a unit`);
  }

  const result = applyToExistingUnit(state, event);
  if (!result.ok) return result;
  const violation = describeInvariantViolation(result.state);
  return violation ? invalid(violation) : result;
}

function applyCreatingEvent(event: SmsUnitEventInput): ApplyResult {
  switch (event.type) {
    case 'RECEIPT_OK':
      return ok(inShowroom('AVAILABLE', event.locationId));
    case 'RECEIPT_DAMAGED':
      return ok(inShowroom('INSPECTION', event.locationId));
    case 'IDENTITY_MISMATCH_FOUND':
      return ok(inShowroom('IDENTITY_MISMATCH', event.locationId));
    case 'OPENING_BALANCE': {
      if (!OPENING_BALANCE_STATUSES.has(event.status)) {
        return invalid(`A unit cannot enter the opening balance as ${event.status}`);
      }
      const state: SmsUnitState = {
        status: event.status,
        physicalLocationId: event.physicalLocationId,
        responsibleShowroomId: event.responsibleShowroomId,
        wasRto: event.wasRto ?? event.status === 'ACTIVE_RTO',
      };
      const violation = describeInvariantViolation(state);
      return violation ? invalid(violation) : ok(state);
    }
    default:
      return invalid(`${event.type} cannot create a unit`);
  }
}

function inShowroom(status: SmsUnitStatus, locationId: string): SmsUnitState {
  return {
    status,
    physicalLocationId: locationId,
    responsibleShowroomId: locationId,
    wasRto: false,
  };
}

function applyToExistingUnit(state: SmsUnitState, event: SmsUnitEventInput): ApplyResult {
  switch (event.type) {
    // ── Receiving follow-ups ─────────────────────────────────────────────
    case 'IDENTITY_RESOLVED': {
      const error = requireStatus(state, event, ['IDENTITY_MISMATCH']);
      return error ? invalid(error) : ok({ ...state, status: event.outcome });
    }

    // ── Inspection and release ───────────────────────────────────────────
    case 'INSPECTION_STARTED':
    case 'INSPECTION_PASSED':
    case 'INSPECTION_FAILED': {
      const error = requireStatus(state, event, ['INSPECTION']);
      return error ? invalid(error) : ok(state);
    }
    case 'UNIT_RELEASED': {
      const error = requireStatus(state, event, ['INSPECTION']);
      return error ? invalid(error) : ok({ ...state, status: 'AVAILABLE' });
    }

    // ── Booking, sale, pickup ────────────────────────────────────────────
    case 'BOOKING_CREATED': {
      const error = requireStatus(state, event, ['AVAILABLE']);
      return error ? invalid(error) : ok({ ...state, status: 'BOOKED' });
    }
    case 'BOOKING_CANCELLED': {
      const error = requireStatus(state, event, ['BOOKED']);
      return error ? invalid(error) : ok({ ...state, status: 'AVAILABLE' });
    }
    case 'SALE_RECORDED': {
      const error = requireStatus(state, event, ['BOOKED']);
      return error ? invalid(error) : ok({ ...state, status: 'SOLD_PENDING_PICKUP' });
    }
    case 'PICKUP_CONFIRMED': {
      const error = requireStatus(state, event, ['SOLD_PENDING_PICKUP']);
      return error ? invalid(error) : ok({ ...state, status: 'PICKED_UP', physicalLocationId: null });
    }

    // ── Sale return ──────────────────────────────────────────────────────
    case 'SALE_RETURN_RECEIVED': {
      const error = requireStatus(state, event, ['SOLD_PENDING_PICKUP', 'PICKED_UP']);
      if (error) return invalid(error);
      if (state.status === 'SOLD_PENDING_PICKUP' && state.physicalLocationId !== event.locationId) {
        return invalid('A unit that never left the showroom can only be returned where it is');
      }
      return ok({ ...state, status: 'INSPECTION', physicalLocationId: event.locationId });
    }
    case 'SALE_RETURN_APPROVED': {
      const error = requireStatus(state, event, ['INSPECTION']);
      return error ? invalid(error) : ok(state);
    }
    case 'SALE_RETURN_REJECTED': {
      // The motorcycle goes back to the customer who bought it.
      const error = requireStatus(state, event, ['INSPECTION']);
      return error ? invalid(error) : ok({ ...state, status: 'PICKED_UP', physicalLocationId: null });
    }

    // ── Rent to own ──────────────────────────────────────────────────────
    case 'RTO_STARTED': {
      const error = requireStatus(state, event, ['AVAILABLE', 'BOOKED']);
      return error
        ? invalid(error)
        : ok({ ...state, status: 'ACTIVE_RTO', physicalLocationId: null, wasRto: true });
    }
    case 'RTO_RETURNED': {
      const error = requireStatus(state, event, ['ACTIVE_RTO']);
      if (error) return invalid(error);
      if (event.locationId !== state.responsibleShowroomId) {
        return invalid(
          'A return to another showroom must go through a cross-branch return request',
        );
      }
      return ok({ ...state, status: 'INSPECTION', physicalLocationId: event.locationId });
    }
    case 'RTO_OWNERSHIP_TRANSFERRED': {
      // Ownership passes to the customer; the motorcycle stays where it is.
      const error = requireStatus(state, event, ['ACTIVE_RTO']);
      return error ? invalid(error) : ok({ ...state, status: 'PICKED_UP', physicalLocationId: null });
    }
    case 'RTO_CONTRACT_CLOSED':
      // Paperwork only. Whether the unit may be released is a guard on the
      // open-contract pointer, not a state transition.
      return ok(state);

    // ── Cross-branch return and custody ──────────────────────────────────
    case 'RETURN_REQUESTED':
    case 'RETURN_APPROVED':
    case 'RETURN_REJECTED': {
      // A request or decision never moves the motorcycle (spec §4.4).
      const error = requireStatus(state, event, ['ACTIVE_RTO', 'CUSTODY']);
      return error ? invalid(error) : ok(state);
    }
    case 'CUSTODY_RECEIVED': {
      const error = requireStatus(state, event, ['ACTIVE_RTO']);
      if (error) return invalid(error);
      if (event.locationId === state.responsibleShowroomId) {
        return invalid('Custody only applies at a showroom other than the responsible one');
      }
      // Responsibility stays with the origin showroom until official receipt.
      return ok({ ...state, status: 'CUSTODY', physicalLocationId: event.locationId });
    }
    case 'CUSTODY_HANDED_BACK': {
      const error = requireStatus(state, event, ['CUSTODY']);
      return error ? invalid(error) : ok({ ...state, status: 'ACTIVE_RTO', physicalLocationId: null });
    }
    case 'OFFICIAL_RECEIPT_CONFIRMED': {
      const error = requireStatus(state, event, ['CUSTODY', 'ACTIVE_RTO']);
      if (error) return invalid(error);
      if (state.status === 'CUSTODY' && state.physicalLocationId !== event.locationId) {
        return invalid('Official receipt must be confirmed by the showroom holding the unit');
      }
      // From CUSTODY the motorcycle is already there (+0 physical); from
      // ACTIVE_RTO this is also its physical arrival (+1, exactly once).
      return ok({
        ...state,
        status: 'INSPECTION',
        physicalLocationId: event.locationId,
        responsibleShowroomId: event.locationId,
      });
    }

    // ── Show unit ────────────────────────────────────────────────────────
    case 'SHOW_UNIT_DISPATCHED': {
      const error = requireStatus(state, event, ['AVAILABLE']);
      return error ? invalid(error) : ok({ ...state, status: 'SHOW_UNIT', physicalLocationId: null });
    }
    case 'SHOW_UNIT_RETURNED': {
      const error = requireStatus(state, event, ['SHOW_UNIT']);
      return error
        ? invalid(error)
        : ok({ ...state, status: event.outcome, physicalLocationId: state.responsibleShowroomId });
    }

    // ── Corrections ──────────────────────────────────────────────────────
    case 'EVENT_VOIDED':
      // Marker row. The voided event is simply absent from the effective
      // ledger, so the marker itself changes nothing.
      return ok(state);

    case 'OPENING_BALANCE':
    case 'RECEIPT_OK':
    case 'RECEIPT_DAMAGED':
    case 'IDENTITY_MISMATCH_FOUND':
      return invalid(`${event.type} is only valid as the first event of a unit`);
  }
}

/**
 * The core invariant behind the stock numbers: a unit has a physical
 * location exactly when its status says it is inside a showroom.
 * Returns a description of the violation, or null when the state is sound.
 */
export function describeInvariantViolation(state: SmsUnitState): string | null {
  const shouldBeInShowroom = IN_SHOWROOM_STATUSES.has(state.status);
  if (shouldBeInShowroom && state.physicalLocationId === null) {
    return `A unit that is ${state.status} must have a physical location`;
  }
  if (!shouldBeInShowroom && state.physicalLocationId !== null) {
    return `A unit that is ${state.status} cannot have a physical location`;
  }
  return null;
}

export type ReplayResult =
  | { ok: true; state: SmsUnitState | null }
  | { ok: false; failedAtIndex: number; reason: string };

/**
 * Fold a unit's effective ledger (oldest first) into its current state.
 * Used to validate a correction before it is written and to verify that the
 * stored projection still matches the ledger.
 */
export function replayUnitEvents(events: readonly SmsUnitEventInput[]): ReplayResult {
  let state: SmsUnitState | null = null;
  for (const [index, event] of events.entries()) {
    const result = applyUnitEvent(state, event);
    if (!result.ok) return { ok: false, failedAtIndex: index, reason: result.reason };
    state = result.state;
  }
  return { ok: true, state };
}

/** Spec §2: does this unit count towards the physical stock of `locationId`? */
export function countsAsPhysicalStock(
  state: Pick<SmsUnitState, 'physicalLocationId'>,
  locationId: string,
): boolean {
  return state.physicalLocationId === locationId;
}

/** Spec §2: may sales offer this unit at `locationId`? */
export function countsAsReadyStock(
  state: Pick<SmsUnitState, 'physicalLocationId' | 'status'>,
  locationId: string,
): boolean {
  return state.physicalLocationId === locationId && state.status === 'AVAILABLE';
}
