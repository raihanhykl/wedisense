import { describe, expect, it } from 'vitest';
import type { SmsUnitStatus } from '@prisma/client';
import {
  IN_SHOWROOM_STATUSES,
  applyUnitEvent,
  countsAsPhysicalStock,
  countsAsReadyStock,
  describeInvariantViolation,
  replayUnitEvents,
  type SmsUnitEventInput,
  type SmsUnitState,
} from './unit-state.js';
import { toReducerInput, toStoredEvent } from './ledger.js';

const BEKASI = 'loc-bekasi';
const JAKARTA = 'loc-jakarta';

/** Fold events and fail the test loudly if any transition is rejected. */
function run(events: SmsUnitEventInput[]): SmsUnitState {
  const result = replayUnitEvents(events);
  if (!result.ok) {
    throw new Error(`event #${result.failedAtIndex} (${events[result.failedAtIndex]?.type}) rejected: ${result.reason}`);
  }
  if (!result.state) throw new Error('no state');
  return result.state;
}

function stock(state: SmsUnitState) {
  return {
    bekasi: [countsAsPhysicalStock(state, BEKASI) ? 1 : 0, countsAsReadyStock(state, BEKASI) ? 1 : 0],
    jakarta: [countsAsPhysicalStock(state, JAKARTA) ? 1 : 0, countsAsReadyStock(state, JAKARTA) ? 1 : 0],
  };
}

const RECEIVED: SmsUnitEventInput[] = [{ type: 'RECEIPT_OK', locationId: BEKASI }];
const BOOKED: SmsUnitEventInput[] = [...RECEIVED, { type: 'BOOKING_CREATED' }];
const SOLD: SmsUnitEventInput[] = [...BOOKED, { type: 'SALE_RECORDED' }];
const PICKED_UP: SmsUnitEventInput[] = [...SOLD, { type: 'PICKUP_CONFIRMED' }];
const ON_RTO: SmsUnitEventInput[] = [...BOOKED, { type: 'RTO_STARTED' }];
const IN_CUSTODY: SmsUnitEventInput[] = [
  ...ON_RTO,
  { type: 'RETURN_REQUESTED' },
  { type: 'CUSTODY_RECEIVED', locationId: JAKARTA },
];

describe('stock definition table (spec §2) — [physical, ready] per showroom', () => {
  it('received in Bekasi and fit: Bekasi 1 / 1', () => {
    expect(stock(run(RECEIVED))).toEqual({ bekasi: [1, 1], jakarta: [0, 0] });
  });

  it('booked, or sold and waiting for pickup: Bekasi 1 / 0', () => {
    expect(stock(run(BOOKED))).toEqual({ bekasi: [1, 0], jakarta: [0, 0] });
    expect(stock(run(SOLD))).toEqual({ bekasi: [1, 0], jakarta: [0, 0] });
  });

  it('picked up, or on active RTO with the customer: 0 / 0 everywhere', () => {
    expect(stock(run(PICKED_UP))).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });
    expect(stock(run(ON_RTO))).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });
  });

  it('show unit out at an event: 0 / 0, still tracked by its showroom', () => {
    const state = run([...RECEIVED, { type: 'SHOW_UNIT_DISPATCHED' }]);
    expect(stock(state)).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });
    expect(state.responsibleShowroomId).toBe(BEKASI);
  });

  it('custody in Jakarta, approval pending: Jakarta 1 / 0 and Bekasi 0', () => {
    const state = run(IN_CUSTODY);
    expect(stock(state)).toEqual({ bekasi: [0, 0], jakarta: [1, 0] });
    expect(state.responsibleShowroomId).toBe(BEKASI);
  });

  it('officially received and under inspection: Jakarta 1 / 0 — custody adds no extra unit', () => {
    const state = run([
      ...IN_CUSTODY,
      { type: 'RETURN_APPROVED' },
      { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
    ]);
    expect(stock(state)).toEqual({ bekasi: [0, 0], jakarta: [1, 0] });
    expect(state.status).toBe('INSPECTION');
    expect(state.responsibleShowroomId).toBe(JAKARTA);
  });

  it('ex-RTO unit released by the Jakarta admin: Jakarta 1 / 1, flagged as ex-RTO', () => {
    const state = run([
      ...IN_CUSTODY,
      { type: 'RETURN_APPROVED' },
      { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
      { type: 'INSPECTION_PASSED' },
      { type: 'RTO_CONTRACT_CLOSED' },
      { type: 'UNIT_RELEASED' },
    ]);
    expect(stock(state)).toEqual({ bekasi: [0, 0], jakarta: [1, 1] });
    expect(state.wasRto).toBe(true);
  });
});

describe('receiving', () => {
  it('a damaged arrival is physical stock but not ready until released', () => {
    const damaged = run([{ type: 'RECEIPT_DAMAGED', locationId: BEKASI }]);
    expect(damaged.status).toBe('INSPECTION');
    expect(stock(damaged).bekasi).toEqual([1, 0]);

    const released = run([
      { type: 'RECEIPT_DAMAGED', locationId: BEKASI },
      { type: 'INSPECTION_PASSED' },
      { type: 'UNIT_RELEASED' },
    ]);
    expect(stock(released).bekasi).toEqual([1, 1]);
  });

  it('an identity mismatch is physical stock, held until reconciled', () => {
    const found = run([{ type: 'IDENTITY_MISMATCH_FOUND', locationId: BEKASI }]);
    expect(stock(found).bekasi).toEqual([1, 0]);
    expect(applyUnitEvent(found, { type: 'BOOKING_CREATED' }).ok).toBe(false);

    expect(run([{ type: 'IDENTITY_MISMATCH_FOUND', locationId: BEKASI }, { type: 'IDENTITY_RESOLVED', outcome: 'AVAILABLE' }]).status).toBe('AVAILABLE');
    expect(run([{ type: 'IDENTITY_MISMATCH_FOUND', locationId: BEKASI }, { type: 'IDENTITY_RESOLVED', outcome: 'INSPECTION' }]).status).toBe('INSPECTION');
  });

  it('a unit can be created only once', () => {
    const state = run(RECEIVED);
    expect(applyUnitEvent(state, { type: 'RECEIPT_OK', locationId: BEKASI }).ok).toBe(false);
    expect(applyUnitEvent(null, { type: 'BOOKING_CREATED' }).ok).toBe(false);
  });
});

describe('booking, sale and pickup', () => {
  it('only an available unit can be booked', () => {
    for (const events of [BOOKED, SOLD, PICKED_UP, ON_RTO, IN_CUSTODY]) {
      expect(applyUnitEvent(run(events), { type: 'BOOKING_CREATED' }).ok).toBe(false);
    }
  });

  it('cancelling a booking makes the unit ready again', () => {
    expect(stock(run([...BOOKED, { type: 'BOOKING_CANCELLED' }])).bekasi).toEqual([1, 1]);
  });

  it('a sale cannot be cancelled like a booking, and pickup happens once', () => {
    expect(applyUnitEvent(run(SOLD), { type: 'BOOKING_CANCELLED' }).ok).toBe(false);
    expect(applyUnitEvent(run(PICKED_UP), { type: 'PICKUP_CONFIRMED' }).ok).toBe(false);
  });

  it('sale return: physical on receipt, ready only after approval, inspection and release', () => {
    const received = run([...PICKED_UP, { type: 'SALE_RETURN_RECEIVED', locationId: BEKASI }]);
    expect(stock(received).bekasi).toEqual([1, 0]);

    const released = run([
      ...PICKED_UP,
      { type: 'SALE_RETURN_RECEIVED', locationId: BEKASI },
      { type: 'SALE_RETURN_APPROVED' },
      { type: 'INSPECTION_PASSED' },
      { type: 'UNIT_RELEASED' },
    ]);
    expect(stock(released).bekasi).toEqual([1, 1]);
  });

  it('a rejected sale return goes back to the customer', () => {
    const state = run([
      ...PICKED_UP,
      { type: 'SALE_RETURN_RECEIVED', locationId: BEKASI },
      { type: 'SALE_RETURN_REJECTED' },
    ]);
    expect(state.status).toBe('PICKED_UP');
    expect(stock(state).bekasi).toEqual([0, 0]);
  });
});

describe('rent to own', () => {
  it('can start from a booked unit or directly from an available one', () => {
    expect(run(ON_RTO).status).toBe('ACTIVE_RTO');
    expect(run([...RECEIVED, { type: 'RTO_STARTED' }]).status).toBe('ACTIVE_RTO');
  });

  it('same-branch return adds physical stock when received (A06)', () => {
    const returned = run([...ON_RTO, { type: 'RTO_RETURNED', locationId: BEKASI }]);
    expect(returned.status).toBe('INSPECTION');
    expect(stock(returned).bekasi).toEqual([1, 0]);
  });

  it('a return at another showroom must use a cross-branch request', () => {
    const result = applyUnitEvent(run(ON_RTO), { type: 'RTO_RETURNED', locationId: JAKARTA });
    expect(result.ok).toBe(false);
  });

  it('ownership transfer keeps the unit with the customer (A11)', () => {
    const state = run([...ON_RTO, { type: 'RTO_OWNERSHIP_TRANSFERRED' }]);
    expect(state.status).toBe('PICKED_UP');
    expect(stock(state)).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });
  });

  it('a second RTO can start after release, from the new showroom', () => {
    const state = run([
      ...IN_CUSTODY,
      { type: 'RETURN_APPROVED' },
      { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
      { type: 'RTO_CONTRACT_CLOSED' },
      { type: 'INSPECTION_PASSED' },
      { type: 'UNIT_RELEASED' },
      { type: 'BOOKING_CREATED' },
      { type: 'RTO_STARTED' },
    ]);
    expect(state.status).toBe('ACTIVE_RTO');
    expect(state.responsibleShowroomId).toBe(JAKARTA);
  });
});

describe('cross-branch return and custody (spec §4.4)', () => {
  it('A07: request and approval before arrival change nothing; receipt adds exactly one in Jakarta', () => {
    const approved = run([...ON_RTO, { type: 'RETURN_REQUESTED' }, { type: 'RETURN_APPROVED' }]);
    expect(stock(approved)).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });

    const received = run([
      ...ON_RTO,
      { type: 'RETURN_REQUESTED' },
      { type: 'RETURN_APPROVED' },
      { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
    ]);
    expect(stock(received)).toEqual({ bekasi: [0, 0], jakarta: [1, 0] });
  });

  it('A08: custody first, then approval and official receipt — Jakarta stays at 1, Bekasi at 0', () => {
    expect(stock(run(IN_CUSTODY))).toEqual({ bekasi: [0, 0], jakarta: [1, 0] });
    const official = run([
      ...IN_CUSTODY,
      { type: 'RETURN_APPROVED' },
      { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
    ]);
    expect(stock(official)).toEqual({ bekasi: [0, 0], jakarta: [1, 0] });
    // Confirming twice is not a second receipt.
    expect(applyUnitEvent(official, { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA }).ok).toBe(false);
  });

  it('A09: rejection with custody leaves the unit held in Jakarta; handing it back returns it to the rider', () => {
    const rejected = run([...IN_CUSTODY, { type: 'RETURN_REJECTED' }]);
    expect(rejected.status).toBe('CUSTODY');
    expect(stock(rejected)).toEqual({ bekasi: [0, 0], jakarta: [1, 0] });
    expect(rejected.responsibleShowroomId).toBe(BEKASI);

    const handedBack = run([...IN_CUSTODY, { type: 'RETURN_REJECTED' }, { type: 'CUSTODY_HANDED_BACK' }]);
    expect(handedBack.status).toBe('ACTIVE_RTO');
    expect(stock(handedBack)).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });
  });

  it('A09: rejection before arrival leaves the unit with the rider', () => {
    const state = run([...ON_RTO, { type: 'RETURN_REQUESTED' }, { type: 'RETURN_REJECTED' }]);
    expect(state.status).toBe('ACTIVE_RTO');
    expect(stock(state)).toEqual({ bekasi: [0, 0], jakarta: [0, 0] });
  });

  it('custody is refused at the responsible showroom itself, and official receipt elsewhere than where it is held', () => {
    expect(applyUnitEvent(run(ON_RTO), { type: 'CUSTODY_RECEIVED', locationId: BEKASI }).ok).toBe(false);
    expect(applyUnitEvent(run(IN_CUSTODY), { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: BEKASI }).ok).toBe(false);
  });
});

describe('show unit (A12)', () => {
  it('returns fit → available; returns with findings → inspection; both back in physical stock', () => {
    const out: SmsUnitEventInput[] = [...RECEIVED, { type: 'SHOW_UNIT_DISPATCHED' }];
    expect(stock(run([...out, { type: 'SHOW_UNIT_RETURNED', outcome: 'AVAILABLE' }])).bekasi).toEqual([1, 1]);
    expect(stock(run([...out, { type: 'SHOW_UNIT_RETURNED', outcome: 'INSPECTION' }])).bekasi).toEqual([1, 0]);
  });

  it('only an available unit can be sent out', () => {
    expect(applyUnitEvent(run(BOOKED), { type: 'SHOW_UNIT_DISPATCHED' }).ok).toBe(false);
  });
});

describe('opening balance (A14)', () => {
  it('accepts an active RTO unit with no location and marks it ex-RTO', () => {
    const state = run([
      { type: 'OPENING_BALANCE', status: 'ACTIVE_RTO', physicalLocationId: null, responsibleShowroomId: BEKASI },
    ]);
    expect(state.wasRto).toBe(true);
    // The return then works without any historical booking.
    expect(run([
      { type: 'OPENING_BALANCE', status: 'ACTIVE_RTO', physicalLocationId: null, responsibleShowroomId: BEKASI },
      { type: 'RTO_RETURNED', locationId: BEKASI },
    ]).status).toBe('INSPECTION');
  });

  it('rejects a status/location combination that breaks the stock invariant', () => {
    expect(applyUnitEvent(null, { type: 'OPENING_BALANCE', status: 'AVAILABLE', physicalLocationId: null, responsibleShowroomId: BEKASI }).ok).toBe(false);
    expect(applyUnitEvent(null, { type: 'OPENING_BALANCE', status: 'ACTIVE_RTO', physicalLocationId: BEKASI, responsibleShowroomId: BEKASI }).ok).toBe(false);
    expect(applyUnitEvent(null, { type: 'OPENING_BALANCE', status: 'PICKED_UP', physicalLocationId: null, responsibleShowroomId: BEKASI }).ok).toBe(false);
  });
});

describe('invariant: physical location exists exactly while the unit is in a showroom', () => {
  const ALL_EVENTS: SmsUnitEventInput[] = [
    { type: 'IDENTITY_RESOLVED', outcome: 'AVAILABLE' },
    { type: 'IDENTITY_RESOLVED', outcome: 'INSPECTION' },
    { type: 'INSPECTION_STARTED' },
    { type: 'INSPECTION_PASSED' },
    { type: 'INSPECTION_FAILED' },
    { type: 'UNIT_RELEASED' },
    { type: 'BOOKING_CREATED' },
    { type: 'BOOKING_CANCELLED' },
    { type: 'SALE_RECORDED' },
    { type: 'PICKUP_CONFIRMED' },
    { type: 'SALE_RETURN_RECEIVED', locationId: BEKASI },
    { type: 'SALE_RETURN_APPROVED' },
    { type: 'SALE_RETURN_REJECTED' },
    { type: 'RTO_STARTED' },
    { type: 'RTO_RETURNED', locationId: BEKASI },
    { type: 'RTO_RETURNED', locationId: JAKARTA },
    { type: 'RTO_OWNERSHIP_TRANSFERRED' },
    { type: 'RTO_CONTRACT_CLOSED' },
    { type: 'RETURN_REQUESTED' },
    { type: 'RETURN_APPROVED' },
    { type: 'RETURN_REJECTED' },
    { type: 'CUSTODY_RECEIVED', locationId: JAKARTA },
    { type: 'CUSTODY_HANDED_BACK' },
    { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
    { type: 'SHOW_UNIT_DISPATCHED' },
    { type: 'SHOW_UNIT_RETURNED', outcome: 'AVAILABLE' },
    { type: 'SHOW_UNIT_RETURNED', outcome: 'INSPECTION' },
    { type: 'EVENT_VOIDED' },
  ];

  it('holds in every state reachable from any starting event', () => {
    const starts: SmsUnitEventInput[] = [
      { type: 'RECEIPT_OK', locationId: BEKASI },
      { type: 'RECEIPT_DAMAGED', locationId: BEKASI },
      { type: 'IDENTITY_MISMATCH_FOUND', locationId: BEKASI },
    ];
    const seen = new Map<string, SmsUnitState>();
    const queue: SmsUnitState[] = starts.map((event) => run([event]));
    while (queue.length > 0) {
      const state = queue.pop()!;
      const key = JSON.stringify(state);
      if (seen.has(key)) continue;
      seen.set(key, state);
      expect(describeInvariantViolation(state)).toBeNull();
      for (const event of ALL_EVENTS) {
        const next = applyUnitEvent(state, event);
        if (next.ok) queue.push(next.state);
      }
    }

    // Every lifecycle status is actually reachable — none is dead.
    const reached = new Set([...seen.values()].map((state) => state.status));
    const expected: SmsUnitStatus[] = [
      'AVAILABLE', 'BOOKED', 'SOLD_PENDING_PICKUP', 'PICKED_UP', 'ACTIVE_RTO',
      'CUSTODY', 'INSPECTION', 'SHOW_UNIT', 'IDENTITY_MISMATCH',
    ];
    expect([...reached].sort()).toEqual([...expected].sort());

    for (const state of seen.values()) {
      expect(state.physicalLocationId !== null).toBe(IN_SHOWROOM_STATUSES.has(state.status));
    }
  });
});

describe('stored event round trip', () => {
  it('rebuilds the reducer input that was stored', () => {
    const events: SmsUnitEventInput[] = [
      { type: 'OPENING_BALANCE', status: 'ACTIVE_RTO', physicalLocationId: null, responsibleShowroomId: BEKASI, wasRto: true },
      { type: 'RECEIPT_DAMAGED', locationId: BEKASI },
      { type: 'IDENTITY_RESOLVED', outcome: 'INSPECTION' },
      { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: JAKARTA },
      { type: 'SHOW_UNIT_RETURNED', outcome: 'AVAILABLE' },
      { type: 'BOOKING_CREATED' },
    ];
    for (const event of events) {
      const stored = toStoredEvent(event);
      const payload = stored.payload === null || typeof stored.payload !== 'object' || 'toJSON' in (stored.payload as object)
        ? null
        : JSON.parse(JSON.stringify(stored.payload));
      expect(toReducerInput({ eventType: stored.eventType, locationId: stored.locationId, payload })).toEqual(event);
    }
  });

  it('refuses to replay a stored event that lost its reducer inputs', () => {
    expect(() => toReducerInput({ eventType: 'RECEIPT_OK', locationId: null, payload: null })).toThrow();
    expect(() => toReducerInput({ eventType: 'SHOW_UNIT_RETURNED', locationId: null, payload: {} })).toThrow();
  });
});
