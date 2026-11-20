/**
 * Integration tests for the SMS orders API (real PostgreSQL).
 *
 * Scenarios covered:
 *   A03 — concurrent booking: exactly one 201, one 409 SMS_BOOKING_CONFLICT
 *          with currentHolder; multi-VIN order where one VIN conflicts saves nothing
 *   A04 — full lifecycle: book → sale → pickup (idempotent); dashboard counts
 *   A05 — cancel a line: unit returns to AVAILABLE; reason in event and line
 *
 * Access rules:
 *   - Cross-showroom admin gets 404 on another showroom's unit/order
 *   - Opening-balance order supports sale and pickup
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../../lib/prisma.js';
import type { DashboardSummary } from '../dashboard/types.js';
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
const errorOf = (res: HttpResult) =>
  (res.body as { error?: { code?: string; details?: Array<Record<string, unknown>> } }).error;

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

/** Seed an AVAILABLE unit via opening-balance for the fastest setup. */
async function seedAvailableUnit(
  user: { id: string },
  showroomId: string,
  vin: string,
): Promise<string> {
  const res = await post(user, '/api/sms/opening-balance/confirm', {
    balanceDate: '2026-11-01',
    rows: [
      {
        row: 1,
        vin,
        variantId: world.variant.id,
        showroomId,
        state: 'AVAILABLE',
      },
    ],
  }).expect(201);
  expect(dataOf<{ createdCount: number }>(res).createdCount).toBe(1);
  const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { vin } });
  return unit.id;
}

/** Create a minimal order. */
function createOrder(
  user: { id: string },
  showroomId: string,
  spkNumber: string,
  unitIds: string[],
  key: string = randomUUID(),
) {
  return post(
    user,
    '/api/sms/orders',
    {
      showroomId,
      spkNumber,
      salesUserId: user.id,
      customerName: 'Integration Test Customer',
      unitIds,
    },
    key,
  );
}

// ── A03 — concurrent booking ────────────────────────────────────────────────

describe('A03 — concurrent booking of the same VIN', () => {
  it('exactly one 201 and one 409 SMS_BOOKING_CONFLICT when two requests race', async () => {
    const vin = nextVin();
    const unitId = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vin);

    const [res1, res2] = await Promise.all([
      createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-RACE-1', [unitId]),
      createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-RACE-2', [unitId]),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    // The 409 carries the conflict details.
    const failing = res1.status === 409 ? res1 : res2;
    const err = errorOf(failing);
    expect(err?.code).toBe('SMS_BOOKING_CONFLICT');
    const details = err?.details ?? [];
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ unitId, vin, reason: 'ALREADY_BOOKED' });
    // currentHolder exposes the winning SPK.
    expect(details[0]).toHaveProperty('currentHolder');

    // The unit has exactly one BOOKING_CREATED event.
    const events = await prisma.smsUnitEvent.findMany({
      where: { unitId, eventType: 'BOOKING_CREATED' },
    });
    expect(events).toHaveLength(1);

    // The unit is BOOKED.
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('BOOKED');
  });

  it('multi-VIN order: nothing is saved when any VIN conflicts', async () => {
    const vinA = nextVin();
    const vinB = nextVin();
    const unitA = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinA);
    const unitB = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinB);

    // Pre-book unitA with a different SPK.
    await createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-FIRST', [unitA]).expect(201);

    // Try to book both units; unitA is now BOOKED → conflict.
    const res = await createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-PARTIAL', [
      unitA,
      unitB,
    ]).expect(409);
    expect(errorOf(res)?.code).toBe('SMS_BOOKING_CONFLICT');

    // No order for SPK-PARTIAL was created; unitB is still AVAILABLE.
    expect(await prisma.smsOrder.count({ where: { spkNumber: 'SPK-PARTIAL' } })).toBe(0);
    const b = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitB } });
    expect(b.status).toBe('AVAILABLE');
    expect(b.activeOrderLineId).toBeNull();
  });

  it('double submit with the same Idempotency-Key produces exactly one order', async () => {
    const vin = nextVin();
    const unitId = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vin);
    const key = randomUUID();

    const [r1, r2] = await Promise.all([
      createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-IDEM', [unitId], key),
      createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-IDEM', [unitId], key),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([201, 201]);
    // Both return the same orderId.
    const id1 = dataOf<{ orderId: string }>(r1).orderId;
    const id2 = dataOf<{ orderId: string }>(r2).orderId;
    expect(id1).toBe(id2);

    expect(await prisma.smsOrder.count()).toBe(1);
    expect(
      await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'BOOKING_CREATED' } }),
    ).toBe(1);
  });
});

// ── A04 — full lifecycle ────────────────────────────────────────────────────

describe('A04 — full order lifecycle: book, sale, pickup', () => {
  it('SPK with 2 VINs: record sale for both, pick up one, re-pickup is idempotent', async () => {
    const vinA = nextVin();
    const vinB = nextVin();
    const unitA = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinA);
    const unitB = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinB);

    // Create order with both.
    const orderRes = await createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-LIFE', [
      unitA,
      unitB,
    ]).expect(201);
    const { orderId } = dataOf<{ orderId: string }>(orderRes);

    // Load the order to get lineIds.
    const detailRes = await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(200);
    const order = dataOf<{ lines: Array<{ id: string; unit: { id: string } }> }>(detailRes);
    const lineForA = order.lines.find((l) => l.unit.id === unitA)!;
    const lineForB = order.lines.find((l) => l.unit.id === unitB)!;
    expect(lineForA).toBeDefined();
    expect(lineForB).toBeDefined();

    // Record sale for both lines.
    await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, {
      lineIds: [lineForA.id, lineForB.id],
    }).expect(200);

    // Confirm pickup for unit A only.
    const pickupKey = randomUUID();
    await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineForA.id}/confirm-pickup`,
      { receiverName: 'Budi Santoso', vinConfirmed: true },
      pickupKey,
    ).expect(200);

    // Same key again (network retry) → the stored first response is replayed.
    const replay = await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineForA.id}/confirm-pickup`,
      { receiverName: 'Budi Santoso', vinConfirmed: true },
      pickupKey,
    ).expect(200);
    expect(dataOf<{ alreadyDone: boolean }>(replay).alreadyDone).toBe(false);

    // Admin confirms the same VIN again (new request) → no-op, alreadyDone.
    const repeat = await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineForA.id}/confirm-pickup`,
      { receiverName: 'Budi Santoso', vinConfirmed: true },
    ).expect(200);
    expect(dataOf<{ alreadyDone: boolean }>(repeat).alreadyDone).toBe(true);

    // Unit A: exactly one PICKUP_CONFIRMED event.
    expect(
      await prisma.smsUnitEvent.count({
        where: { unitId: unitA, eventType: 'PICKUP_CONFIRMED' },
      }),
    ).toBe(1);

    // Dashboard: unit B is still physical (SOLD status = sold_pending_pickup).
    const summary = await get(
      world.bekasiAdmin,
      `/api/sms/dashboard/summary?showroomId=${world.bekasi.id}`,
    ).expect(200);
    const totals = dataOf<DashboardSummary>(summary).totals;
    expect(totals.soldPendingPickup).toBe(1);
    // Unit A has left the showroom; unit B remains physical.
    expect(totals.physical).toBe(1);
  });

  it('summary counts reflect partial pickup', async () => {
    const vinA = nextVin();
    const vinB = nextVin();
    const unitA = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinA);
    const unitB = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinB);

    const orderRes = await createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-PARTIAL-PICKUP', [
      unitA,
      unitB,
    ]).expect(201);
    const { orderId } = dataOf<{ orderId: string }>(orderRes);

    const detailRes = await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(200);
    const order = dataOf<{ lines: Array<{ id: string; unit: { id: string } }> }>(detailRes);
    const lineForA = order.lines.find((l) => l.unit.id === unitA)!;
    const lineForB = order.lines.find((l) => l.unit.id === unitB)!;

    // Sell both.
    await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, {
      lineIds: [lineForA.id, lineForB.id],
    }).expect(200);

    // Pick up only A.
    await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineForA.id}/confirm-pickup`,
      { receiverName: 'Ali', vinConfirmed: true },
    ).expect(200);

    // Verify order detail summary: total 2, pickedUp 1.
    const finalDetail = await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(200);
    const summary = dataOf<{ summary: { total: number; pickedUp: number } }>(finalDetail).summary;
    expect(summary.total).toBe(2);
    expect(summary.pickedUp).toBe(1);

    // Line B is still SOLD.
    const lB = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineForB.id } });
    expect(lB.status).toBe('SOLD');
  });
});

// ── A05 — cancel a line ─────────────────────────────────────────────────────

describe('A05 — cancel a line', () => {
  it('cancelled VIN returns to AVAILABLE; reason stored in event and line', async () => {
    const vinA = nextVin();
    const vinB = nextVin();
    const unitA = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinA);
    const unitB = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vinB);

    const orderRes = await createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-CANCEL', [
      unitA,
      unitB,
    ]).expect(201);
    const { orderId } = dataOf<{ orderId: string }>(orderRes);

    const detailRes = await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(200);
    const order = dataOf<{ lines: Array<{ id: string; unit: { id: string } }> }>(detailRes);
    const lineForA = order.lines.find((l) => l.unit.id === unitA)!;

    const cancelReason = 'Customer found a better deal elsewhere';
    await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineForA.id}/cancel`,
      { reason: cancelReason },
    ).expect(200);

    // Unit A is AVAILABLE again, activeOrderLineId cleared.
    const a = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitA } });
    expect(a.status).toBe('AVAILABLE');
    expect(a.activeOrderLineId).toBeNull();

    // Unit B is still BOOKED.
    const b = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitB } });
    expect(b.status).toBe('BOOKED');

    // Cancel event was recorded with the reason.
    const cancelEvent = await prisma.smsUnitEvent.findFirstOrThrow({
      where: { unitId: unitA, eventType: 'BOOKING_CANCELLED' },
    });
    expect(cancelEvent.reason).toBe(cancelReason);

    // Order line holds the reason.
    const line = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineForA.id } });
    expect(line.status).toBe('CANCELLED');
    expect(line.cancelReason).toBe(cancelReason);
  });

  it('cancelling the same line twice is idempotent', async () => {
    const vin = nextVin();
    const unitId = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, vin);

    const orderRes = await createOrder(world.bekasiAdmin, world.bekasi.id, 'SPK-IDEM-CANCEL', [
      unitId,
    ]).expect(201);
    const { orderId } = dataOf<{ orderId: string }>(orderRes);

    const detailRes = await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(200);
    const lines = dataOf<{ lines: Array<{ id: string }> }>(detailRes).lines;
    const lineId = lines[0]!.id;

    const key = randomUUID();
    const r1 = await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineId}/cancel`,
      { reason: 'First cancel' },
      key,
    ).expect(200);
    // Same key (retry) → replayed first response.
    const replay = await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineId}/cancel`,
      { reason: 'First cancel' },
      key,
    ).expect(200);
    // New request on an already-cancelled line → no-op.
    const r2 = await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${lineId}/cancel`,
      { reason: 'Second cancel' },
    ).expect(200);

    expect(dataOf<{ alreadyDone: boolean }>(r1).alreadyDone).toBe(false);
    expect(dataOf<{ alreadyDone: boolean }>(replay).alreadyDone).toBe(false);
    expect(dataOf<{ alreadyDone: boolean }>(r2).alreadyDone).toBe(true);

    // Exactly one BOOKING_CANCELLED event.
    expect(
      await prisma.smsUnitEvent.count({
        where: { unitId, eventType: 'BOOKING_CANCELLED' },
      }),
    ).toBe(1);
  });
});

// ── Cross-showroom access (A13 for orders) ──────────────────────────────────

describe('A13 — cross-showroom access', () => {
  it('admin at Bekasi gets 404 on an order created at Jakarta', async () => {
    const vin = nextVin();
    const unitId = await seedAvailableUnit(world.jakartaAdmin, world.jakarta.id, vin);

    const orderRes = await createOrder(world.jakartaAdmin, world.jakarta.id, 'SPK-JKT', [
      unitId,
    ]).expect(201);
    const { orderId } = dataOf<{ orderId: string }>(orderRes);

    // bekasiAdmin cannot see Jakarta orders.
    await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(404);
  });

  it('admin at Bekasi gets 404 trying to book a unit at Jakarta', async () => {
    const vin = nextVin();
    const unitId = await seedAvailableUnit(world.jakartaAdmin, world.jakarta.id, vin);

    // showroomId is Jakarta, but the caller (bekasiAdmin) only has ORDERS_MANAGE at Bekasi.
    const res = await createOrder(world.bekasiAdmin, world.jakarta.id, 'SPK-CROSS', [
      unitId,
    ]).expect(403);
    expect(errorOf(res)?.code).toBe('SMS_FORBIDDEN_AT_LOCATION');
  });
});

// ── Opening-balance order supports sale and pickup ──────────────────────────

describe('opening-balance order: sale and pickup work normally', () => {
  it('a BOOKED opening-balance unit can be sold and picked up', async () => {
    // Use the opening-balance endpoint to seed a BOOKED unit (creates an order).
    const vin = nextVin();
    await post(world.bekasiAdmin, '/api/sms/opening-balance/confirm', {
      balanceDate: '2026-11-01',
      rows: [
        {
          row: 1,
          vin,
          variantId: world.variant.id,
          showroomId: world.bekasi.id,
          state: 'BOOKED',
          spkNumber: 'SPK-OB-001',
          customerName: 'Opening Balance Customer',
        },
      ],
    }).expect(201);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { vin } });
    const line = await prisma.smsOrderLine.findFirstOrThrow({
      where: { unitId: unit.id },
    });
    const orderId = line.orderId;

    // Record sale.
    await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, {
      lineIds: [line.id],
      soldAt: '2026-11-05',
    }).expect(200);

    // Confirm pickup.
    const pickup = await put(
      world.bekasiAdmin,
      `/api/sms/orders/${orderId}/lines/${line.id}/confirm-pickup`,
      { receiverName: 'Opening Customer', vinConfirmed: true },
    ).expect(200);
    expect(dataOf<{ status: string }>(pickup).status).toBe('PICKED_UP');

    // Unit is gone from physical stock.
    const updatedUnit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(updatedUnit.activeOrderLineId).toBeNull();
    expect(
      await prisma.smsUnitEvent.count({ where: { unitId: unit.id, eventType: 'PICKUP_CONFIRMED' } }),
    ).toBe(1);
  });
});

// ── Races on one order line + exact pickup time ─────────────────────────────

async function bookOne(spk: string): Promise<{ orderId: string; lineId: string; unitId: string }> {
  const unitId = await seedAvailableUnit(world.bekasiAdmin, world.bekasi.id, nextVin());
  const orderRes = await createOrder(world.bekasiAdmin, world.bekasi.id, spk, [unitId]).expect(201);
  const { orderId } = dataOf<{ orderId: string }>(orderRes);
  const detail = await get(world.bekasiAdmin, `/api/sms/orders/${orderId}`).expect(200);
  const lineId = dataOf<{ lines: Array<{ id: string }> }>(detail).lines[0]!.id;
  return { orderId, lineId, unitId };
}

describe('concurrent actions on the same order line', () => {
  it('cancel racing record-sale: exactly one wins, the other gets a 409, never a 500', async () => {
    const { orderId, lineId, unitId } = await bookOne('SPK-RACE-LINE');

    const [cancelRes, saleRes] = await Promise.all([
      put(world.bekasiAdmin, `/api/sms/orders/${orderId}/lines/${lineId}/cancel`, {
        reason: 'Customer changed mind',
      }),
      put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, { lineIds: [lineId] }),
    ]);

    expect([cancelRes.status, saleRes.status].sort()).toEqual([200, 409]);
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    const line = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    if (cancelRes.status === 200) {
      expect(line.status).toBe('CANCELLED');
      expect(unit.status).toBe('AVAILABLE');
    } else {
      expect(line.status).toBe('SOLD');
      expect(unit.status).toBe('SOLD_PENDING_PICKUP');
    }
    // One state-changing event after the booking, whichever won.
    const events = await prisma.smsUnitEvent.count({
      where: { unitId, eventType: { in: ['BOOKING_CANCELLED', 'SALE_RECORDED'] } },
    });
    expect(events).toBe(1);
  });

  it('two admins confirming the same pickup at once write one PICKUP_CONFIRMED', async () => {
    const { orderId, lineId, unitId } = await bookOne('SPK-RACE-PICKUP');
    await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, { lineIds: [lineId] }).expect(200);

    const body = { receiverName: 'Budi', vinConfirmed: true };
    const path = `/api/sms/orders/${orderId}/lines/${lineId}/confirm-pickup`;
    const [r1, r2] = await Promise.all([put(world.bekasiAdmin, path, body), put(world.bekasiAdmin, path, body)]);

    expect([r1.status, r2.status]).toEqual([200, 200]);
    const done = [r1, r2].map((r) => dataOf<{ alreadyDone: boolean }>(r).alreadyDone).sort();
    expect(done).toEqual([false, true]);
    expect(
      await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'PICKUP_CONFIRMED' } }),
    ).toBe(1);
  });
});

describe('pickup time', () => {
  it('keeps the exact handover time and rejects a future one', async () => {
    const { orderId, lineId } = await bookOne('SPK-PICKUP-TIME');
    await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, { lineIds: [lineId] }).expect(200);
    const path = `/api/sms/orders/${orderId}/lines/${lineId}/confirm-pickup`;

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const rejected = await put(world.bekasiAdmin, path, {
      receiverName: 'Budi',
      vinConfirmed: true,
      pickedUpAt: future,
    }).expect(422);
    expect(errorOf(rejected)?.code).toBe('VALIDATION_ERROR');

    // A second ago: past, yet on the same WIB day as the sale even near midnight.
    const handover = new Date(Date.now() - 1000);
    handover.setUTCMilliseconds(0);
    await put(world.bekasiAdmin, path, {
      receiverName: 'Budi',
      vinConfirmed: true,
      pickedUpAt: handover.toISOString(),
    }).expect(200);

    const line = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.pickedUpAt?.toISOString()).toBe(handover.toISOString());
  });
});
