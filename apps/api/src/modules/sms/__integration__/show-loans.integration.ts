/**
 * Integration tests for the show-loans slice (sub-tiers 3.3 + 3.4).
 * Uses real PostgreSQL; no mocks.
 *
 * Scenarios covered:
 *   A12-a  Dispatch a AVAILABLE unit — physical -1, out-on-show +1, PIC visible
 *   A12-b  Overdue check — task list surfaces the loan; tasks staleBookings/awaitingPickup tested
 *   A12-c  Return with findings → unit goes to INSPECTION, appears in inspection queue
 *   A12-d  Return without findings → unit goes back to AVAILABLE
 *   A12-e  Repeat return is a no-op (alreadyDone=true, no second event)
 *   A12-f  Cross-showroom 404 — admin of Bekasi cannot see Bekasi's show-loans from Jakarta
 *   A12-g  Opening-balance show loan can be returned (happy path; already-dispatched state)
 *   A12-h  Dashboard tasks: staleBookings and awaitingPickup read correctly from DB
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../../lib/prisma.js';
import type { DashboardSummary, DashboardTasks } from '../dashboard/types.js';
import type { ShowLoanRow } from '../show-loans/types.js';
import { businessToday, createUnitWithEvent } from '../lib/ledger.js';
import { smsTransaction } from '../lib/transaction.js';
import {
  accessTokenFor,
  createSmsTestApp,
  disconnect,
  nextVin,
  resetSmsDatabase,
  type SmsTestWorld,
} from '../../../test/integration/sms-fixtures.js';

let world: SmsTestWorld;
let app: Express;

beforeEach(async () => {
  world = await resetSmsDatabase();
  app = createSmsTestApp();
});

afterAll(async () => {
  await disconnect();
});

// ── HTTP helpers ───────────────────────────────────────────────────────────

interface HttpResult {
  body: unknown;
}
const dataOf = <T>(res: HttpResult): T => (res.body as { data: T }).data;
const metaOf = (res: HttpResult) =>
  (res.body as { meta?: { total: number; page: number; limit: number } }).meta;
const errorCodeOf = (res: HttpResult): string | undefined =>
  (res.body as { error?: { code?: string } }).error?.code;

function get(user: { id: string }, path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${accessTokenFor(user)}`);
}

function post(
  user: { id: string },
  path: string,
  body: unknown,
  key: string | null = randomUUID(),
) {
  const req = request(app)
    .post(path)
    .set('Authorization', `Bearer ${accessTokenFor(user)}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body as object);
}

function put(
  user: { id: string },
  path: string,
  body: unknown,
  key: string | null = randomUUID(),
) {
  const req = request(app)
    .put(path)
    .set('Authorization', `Bearer ${accessTokenFor(user)}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body as object);
}

// ── Fixture helpers ────────────────────────────────────────────────────────

/** Receive a unit into `locationId` and return its id. */
async function receiveUnit(
  locationId = world.bekasi.id,
  receivedOn: Date = businessToday(),
): Promise<string> {
  const { unit } = await smsTransaction((tx) =>
    createUnitWithEvent(
      tx,
      { vin: nextVin(), variantId: world.variant.id, createdByUserId: world.bekasiAdmin.id },
      {
        event: { type: 'RECEIPT_OK', locationId },
        eventDate: receivedOn,
        performedByUserId: world.bekasiAdmin.id,
      },
    ),
  );
  return unit.id;
}

/** Tomorrow's date as YYYY-MM-DD. */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Yesterday's date as YYYY-MM-DD. */
function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Dashboard summary totals. */
async function dashboardTotals(
  user: { id: string },
  showroomId: string,
): Promise<DashboardSummary['totals']> {
  const res = await get(
    user,
    `/api/sms/dashboard/summary?showroomId=${showroomId}`,
  ).expect(200);
  return dataOf<DashboardSummary>(res).totals;
}

// ── A12-a — Dispatch ───────────────────────────────────────────────────────

describe('A12-a — dispatch a ready unit to a show event', () => {
  it('removes the unit from physical stock and adds to show-unit count', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    // Before dispatch: 1 physical / 1 ready
    const before = await dashboardTotals(world.bekasiAdmin, world.bekasi.id);
    expect(before.physical).toBe(1);
    expect(before.ready).toBe(1);
    expect(before.showUnit).toBe(0);
    expect(before.outside).toBe(0);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Jakarta Motor Show',
      eventLocation: 'JIExpo Kemayoran',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);

    const loan = dataOf<ShowLoanRow>(dispatchRes);
    expect(loan.status).toBe('OUT');
    expect(loan.overdue).toBe(false);
    expect(loan.returnedAt).toBeNull();
    expect(loan.pic?.id).toBe(world.bekasiAdmin.id);
    expect(loan.unit.id).toBe(unitId);

    // Unit must be in SHOW_UNIT status.
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('SHOW_UNIT');
    expect(unit.physicalLocationId).toBeNull();
    expect(unit.responsibleShowroomId).toBe(world.bekasi.id);
    expect(unit.openShowLoanId).toBe(loan.id);

    // Exactly one event written.
    const events = await prisma.smsUnitEvent.findMany({ where: { unitId } });
    expect(events).toHaveLength(2); // RECEIPT_OK + SHOW_UNIT_DISPATCHED
    const dispatchEvent = events.find((e) => e.eventType === 'SHOW_UNIT_DISPATCHED');
    expect(dispatchEvent).toBeDefined();
    expect(dispatchEvent!.showLoanId).toBe(loan.id);

    // Dashboard: physical -1, show_unit +1, outside +1
    const after = await dashboardTotals(world.bekasiAdmin, world.bekasi.id);
    expect(after.physical).toBe(0);
    expect(after.ready).toBe(0);
    expect(after.showUnit).toBe(1);
    expect(after.outside).toBe(1);

    // Loan appears in the list
    const listRes = await get(
      world.bekasiAdmin,
      `/api/sms/show-loans?showroomId=${world.bekasi.id}`,
    ).expect(200);
    const list = dataOf<ShowLoanRow[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(loan.id);

    // Audit log entry created
    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: 'SmsShowLoan', resourceId: loan.id, action: 'CREATE' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(world.bekasiAdmin.id);
  });

  it('rejects dispatch of a non-AVAILABLE unit (409)', async () => {
    const unitId = await receiveUnit(world.bekasi.id);
    // Book the unit first
    await smsTransaction(async (tx) => {
      const { lockUnit } = await import('../lib/ledger.js');
      const { recordUnitEvent } = await import('../lib/ledger.js');
      const unit = await lockUnit(tx, unitId);
      await recordUnitEvent(tx, unit, {
        event: { type: 'BOOKING_CREATED' },
        eventDate: businessToday(),
        performedByUserId: world.bekasiAdmin.id,
      });
    });

    const res = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(409);
    expect(errorCodeOf(res)).toBe('SMS_UNIT_NOT_AVAILABLE');
  });

  it('rejects dispatch with an expectedReturnDate in the past (422)', async () => {
    const unitId = await receiveUnit(world.bekasi.id);
    const res = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: yesterday(),
    }).expect(422);
    // Dispatched "now" (today) so yesterday is before the dispatch date
    expect(res.status).toBe(422);
  });
});

// ── A12-b — Overdue & task list ────────────────────────────────────────────

describe('A12-b — overdue show unit appears in dashboard tasks', () => {
  it('a loan with expectedReturnDate in the past surfaces in overdueShowUnits', async () => {
    // Received ten days ago, so a dispatch five days ago is after the receipt.
    const tenDaysAgo = new Date(businessToday().getTime() - 10 * 24 * 60 * 60 * 1000);
    const unitId = await receiveUnit(world.bekasi.id, tenDaysAgo);

    // Dispatch with both dispatchedAt and expectedReturnDate in the past
    // so the loan is overdue at query time.
    await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Old Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      dispatchedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      expectedReturnDate: yesterday(),
    }).expect(201);

    const tasksRes = await get(
      world.bekasiAdmin,
      `/api/sms/dashboard/tasks?showroomId=${world.bekasi.id}`,
    ).expect(200);
    const tasks = dataOf<DashboardTasks>(tasksRes);
    expect(tasks.overdueShowUnits.total).toBeGreaterThanOrEqual(1);
    const loanTask = tasks.overdueShowUnits.data.find((t) => t.vin !== undefined);
    expect(loanTask).toBeDefined();
    expect(loanTask!.daysOverdue).toBeGreaterThanOrEqual(1);

    // The list endpoint also marks it OVERDUE
    const listRes = await get(
      world.bekasiAdmin,
      `/api/sms/show-loans?showroomId=${world.bekasi.id}&status=overdue`,
    ).expect(200);
    const list = dataOf<ShowLoanRow[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('OVERDUE');
    expect(list[0]!.overdue).toBe(true);
    expect(list[0]!.daysOverdue).toBeGreaterThanOrEqual(1);
  });
});

// ── A12-c — Return with findings ───────────────────────────────────────────

describe('A12-c — return with findings → INSPECTION; unit appears in inspection queue', () => {
  it('creates a pending inspection, transitions unit to INSPECTION, clears openShowLoanId', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Jakarta Motor Show',
      eventLocation: 'JIExpo',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);
    const loanId = dataOf<ShowLoanRow>(dispatchRes).id;

    const returnRes = await put(world.bekasiAdmin, `/api/sms/show-loans/${loanId}/return`, {
      condition: 'FAIR',
      hasFindings: true,
      findings: 'Scratches on the right side panel',
    }).expect(200);

    const returned = dataOf<ShowLoanRow>(returnRes);
    expect(returned.status).toBe('RETURNED');
    expect(returned.returnedAt).not.toBeNull();
    expect(returned.hasFindings).toBe(true);
    expect(returned.returnCondition).toBe('FAIR');

    // Unit must be in INSPECTION status with physical back at the showroom
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('INSPECTION');
    expect(unit.physicalLocationId).toBe(world.bekasi.id);
    expect(unit.openShowLoanId).toBeNull();

    // A pending inspection was created for this loan
    const inspection = await prisma.smsInspection.findFirst({
      where: { showLoanId: loanId },
    });
    expect(inspection).not.toBeNull();
    expect(inspection!.result).toBe('PENDING');
    expect(inspection!.reason).toBe('SHOW_UNIT_RETURN');
    expect(inspection!.findings).toBe('Scratches on the right side panel');

    // Events: RECEIPT_OK → SHOW_UNIT_DISPATCHED → SHOW_UNIT_RETURNED → INSPECTION_STARTED
    const events = await prisma.smsUnitEvent.findMany({
      where: { unitId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'RECEIPT_OK',
      'SHOW_UNIT_DISPATCHED',
      'SHOW_UNIT_RETURNED',
      'INSPECTION_STARTED',
    ]);

    // Unit now appears in the inspection task queue
    const tasksRes = await get(
      world.bekasiAdmin,
      `/api/sms/dashboard/tasks?showroomId=${world.bekasi.id}`,
    ).expect(200);
    const tasks = dataOf<DashboardTasks>(tasksRes);
    expect(tasks.inspections.data.some((t) => t.unitId === unitId)).toBe(true);

    // Audit log has an UPDATE entry
    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: 'SmsShowLoan', resourceId: loanId, action: 'UPDATE' },
    });
    expect(audit).not.toBeNull();
  });

  it('unit released after PASSED inspection goes back to AVAILABLE', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);
    const loanId = dataOf<ShowLoanRow>(dispatchRes).id;

    await put(world.bekasiAdmin, `/api/sms/show-loans/${loanId}/return`, {
      condition: 'FAIR',
      hasFindings: true,
      findings: 'Minor scratch',
    }).expect(200);

    // Inspect + mark PASSED
    const inspection = await prisma.smsInspection.findFirstOrThrow({
      where: { showLoanId: loanId },
    });
    await put(
      world.bekasiAdmin,
      `/api/sms/inspections/${inspection.id}/result`,
      { result: 'PASSED' },
    ).expect(200);

    // A PASSED inspection alone does not release the unit (design §3: the
    // admin releases explicitly).
    const held = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(held.status).toBe('INSPECTION');

    await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {}).expect(200);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('AVAILABLE');
    expect(unit.physicalLocationId).toBe(world.bekasi.id);
  });
});

// ── A12-d — Return without findings ───────────────────────────────────────

describe('A12-d — return without findings → AVAILABLE directly', () => {
  it('restores unit to AVAILABLE, physical back at showroom', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);
    const loanId = dataOf<ShowLoanRow>(dispatchRes).id;

    const returnRes = await put(world.bekasiAdmin, `/api/sms/show-loans/${loanId}/return`, {
      condition: 'GOOD',
      hasFindings: false,
    }).expect(200);

    const returned = dataOf<ShowLoanRow>(returnRes);
    expect(returned.status).toBe('RETURNED');
    expect(returned.hasFindings).toBe(false);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('AVAILABLE');
    expect(unit.physicalLocationId).toBe(world.bekasi.id);
    expect(unit.openShowLoanId).toBeNull();

    // Events: RECEIPT_OK → SHOW_UNIT_DISPATCHED → SHOW_UNIT_RETURNED
    const events = await prisma.smsUnitEvent.findMany({
      where: { unitId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'RECEIPT_OK',
      'SHOW_UNIT_DISPATCHED',
      'SHOW_UNIT_RETURNED',
    ]);

    // Dashboard: unit is back in physical + ready
    const totals = await dashboardTotals(world.bekasiAdmin, world.bekasi.id);
    expect(totals.physical).toBe(1);
    expect(totals.ready).toBe(1);
    expect(totals.showUnit).toBe(0);
  });
});

// ── A12-e — Idempotent repeat ──────────────────────────────────────────────

describe('A12-e — repeat return is a no-op', () => {
  it('returns alreadyDone:true and writes no second event', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);
    const loanId = dataOf<ShowLoanRow>(dispatchRes).id;

    // Return once
    await put(world.bekasiAdmin, `/api/sms/show-loans/${loanId}/return`, {
      condition: 'GOOD',
      hasFindings: false,
    }).expect(200);

    const eventCountAfterFirst = await prisma.smsUnitEvent.count({ where: { unitId } });

    // Return again (new idempotency key → not a replay, but the loan is already returned)
    const secondReturnRes = await put(
      world.bekasiAdmin,
      `/api/sms/show-loans/${loanId}/return`,
      { condition: 'GOOD', hasFindings: false },
    ).expect(200);

    const secondBody = dataOf<ShowLoanRow & { alreadyDone?: boolean }>(secondReturnRes);
    expect(secondBody.alreadyDone).toBe(true);

    // No new events written
    const eventCountAfterSecond = await prisma.smsUnitEvent.count({ where: { unitId } });
    expect(eventCountAfterSecond).toBe(eventCountAfterFirst);
  });
});

// ── A12-f — Cross-showroom 404 ─────────────────────────────────────────────

describe('A12-f — cross-showroom 404', () => {
  it('admin of Jakarta cannot see Bekasi show-loans (404)', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Jakarta Motor Show',
      eventLocation: 'JIExpo',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);
    const loanId = dataOf<ShowLoanRow>(dispatchRes).id;

    // Jakarta admin tries to get a Bekasi loan
    const res = await get(world.jakartaAdmin, `/api/sms/show-loans/${loanId}`).expect(404);
    expect(errorCodeOf(res)).toBe('SMS_SHOW_LOAN_NOT_FOUND');
  });

  it('admin of Jakarta cannot return a Bekasi show-loan (404)', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const dispatchRes = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      expectedReturnDate: tomorrow(),
    }).expect(201);
    const loanId = dataOf<ShowLoanRow>(dispatchRes).id;

    const res = await put(
      world.jakartaAdmin,
      `/api/sms/show-loans/${loanId}/return`,
      { condition: 'GOOD', hasFindings: false },
    ).expect(404);
    expect(errorCodeOf(res)).toBe('SMS_SHOW_LOAN_NOT_FOUND');
  });
});

// ── A12-g — Opening-balance show loan can be returned ─────────────────────

describe('A12-g — opening-balance show unit can be returned', () => {
  it('a SHOW_UNIT unit entered via opening balance can be returned through the show-loans API', async () => {
    // Enter via opening balance (the opening-balance/confirm endpoint)
    const vin = nextVin();
    const obRes = await request(app)
      .post('/api/sms/opening-balance/confirm')
      .set('Authorization', `Bearer ${accessTokenFor(world.bekasiAdmin)}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        balanceDate: '2026-11-01',
        rows: [
          {
            row: 1,
            vin,
            variantId: world.variant.id,
            showroomId: world.bekasi.id,
            state: 'SHOW_UNIT',
            eventName: 'Old Event',
            eventLocation: 'Old Venue',
            expectedReturnDate: tomorrow(),
          },
        ],
      })
      .expect(201);

    expect((obRes.body as { data: { createdCount: number } }).data.createdCount).toBe(1);

    // Find the unit and its show loan
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { vin } });
    expect(unit.status).toBe('SHOW_UNIT');
    expect(unit.openShowLoanId).not.toBeNull();

    // Return it via the show-loans API
    const returnRes = await put(
      world.bekasiAdmin,
      `/api/sms/show-loans/${unit.openShowLoanId}/return`,
      { condition: 'GOOD', hasFindings: false },
    ).expect(200);

    const returned = dataOf<ShowLoanRow>(returnRes);
    expect(returned.status).toBe('RETURNED');

    const updatedUnit = await prisma.smsUnit.findUniqueOrThrow({ where: { vin } });
    expect(updatedUnit.status).toBe('AVAILABLE');
    expect(updatedUnit.physicalLocationId).toBe(world.bekasi.id);
    expect(updatedUnit.openShowLoanId).toBeNull();
  });
});

// ── A12-h — Dashboard tasks: staleBookings + awaitingPickup ──────────────

describe('A12-h — dashboard tasks staleBookings and awaitingPickup', () => {
  /**
   * We create order rows directly with prisma because the orders API
   * is built by a parallel agent (may not be ready). The endpoint
   * we are testing is the dashboard tasks reader — not the orders writer.
   */
  it('stale bookings appear when followUpAt has passed', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    // Create a minimal order + order line with BOOKED status and followUpAt in the past
    const order = await prisma.smsOrder.create({
      data: {
        showroomId: world.bekasi.id,
        spkNumber: 'SPK-STALE-001',
        customerName: 'Test Customer',
        createdByUserId: world.bekasiAdmin.id,
      },
    });
    await prisma.smsOrderLine.create({
      data: {
        orderId: order.id,
        unitId,
        status: 'BOOKED',
        bookedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        followUpAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago (overdue)
      },
    });

    const tasksRes = await get(
      world.bekasiAdmin,
      `/api/sms/dashboard/tasks?showroomId=${world.bekasi.id}`,
    ).expect(200);
    const tasks = dataOf<DashboardTasks>(tasksRes);
    expect(tasks.staleBookings.total).toBeGreaterThanOrEqual(1);
    const stale = tasks.staleBookings.data.find((t) => t.spk === 'SPK-STALE-001');
    expect(stale).toBeDefined();
    expect(stale!.daysSinceBooking).toBeGreaterThanOrEqual(10);
  });

  it('awaiting pickup lines appear when status is SOLD', async () => {
    const unitId = await receiveUnit(world.bekasi.id);

    const order = await prisma.smsOrder.create({
      data: {
        showroomId: world.bekasi.id,
        spkNumber: 'SPK-SOLD-001',
        customerName: 'Test Customer',
        createdByUserId: world.bekasiAdmin.id,
      },
    });
    const soldAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.smsOrderLine.create({
      data: {
        orderId: order.id,
        unitId,
        status: 'SOLD',
        bookedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        soldAt,
      },
    });

    const tasksRes = await get(
      world.bekasiAdmin,
      `/api/sms/dashboard/tasks?showroomId=${world.bekasi.id}`,
    ).expect(200);
    const tasks = dataOf<DashboardTasks>(tasksRes);
    expect(tasks.awaitingPickup.total).toBeGreaterThanOrEqual(1);
    const waiting = tasks.awaitingPickup.data.find((t) => t.spk === 'SPK-SOLD-001');
    expect(waiting).toBeDefined();
    expect(waiting!.daysWaiting).toBeGreaterThanOrEqual(2);
  });

  it('show-loans list paginates correctly', async () => {
    // Dispatch 3 units
    for (let i = 0; i < 3; i++) {
      const unitId = await receiveUnit(world.bekasi.id);
      await post(world.bekasiAdmin, '/api/sms/show-loans', {
        unitId,
        eventName: `Event ${i}`,
        eventLocation: `Venue ${i}`,
        picUserId: world.bekasiAdmin.id,
        expectedReturnDate: tomorrow(),
      }).expect(201);
    }

    // Page 1 of 2 (limit=2)
    const page1 = await get(
      world.bekasiAdmin,
      `/api/sms/show-loans?showroomId=${world.bekasi.id}&limit=2&page=1`,
    ).expect(200);
    expect(dataOf<ShowLoanRow[]>(page1)).toHaveLength(2);
    expect(metaOf(page1)?.total).toBe(3);

    // Page 2 of 2
    const page2 = await get(
      world.bekasiAdmin,
      `/api/sms/show-loans?showroomId=${world.bekasi.id}&limit=2&page=2`,
    ).expect(200);
    expect(dataOf<ShowLoanRow[]>(page2)).toHaveLength(1);
  });
});

// ── Timeline order ─────────────────────────────────────────────────────────

describe('event dates never run backwards', () => {
  it('rejects a dispatch dated before the unit was received', async () => {
    const unitId = await receiveUnit(world.bekasi.id);
    const beforeReceipt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const res = await post(world.bekasiAdmin, '/api/sms/show-loans', {
      unitId,
      eventName: 'Backdated Show',
      eventLocation: 'Venue',
      picUserId: world.bekasiAdmin.id,
      dispatchedAt: beforeReceipt,
      expectedReturnDate: tomorrow(),
    }).expect(422);

    expect((res.body as { error: { code: string } }).error.code).toBe('SMS_EVENT_BEFORE_PREVIOUS');
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('AVAILABLE');
    expect(await prisma.smsShowLoan.count({ where: { unitId } })).toBe(0);
  });
});
