/**
 * Opening balance over HTTP against real PostgreSQL (scenario A14, first
 * half): stock that already exists on cutover day enters SMS in the state
 * it is really in — including an active RTO contract with no historical
 * booking — and the dashboard, the VIN card and the ledger agree.
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

interface HttpResult {
  body: unknown;
}
const dataOf = <T>(res: HttpResult): T => (res.body as { data: T }).data;
const errorOf = (res: HttpResult) =>
  (res.body as { error?: { code?: string; details?: Array<Record<string, unknown>> } }).error;

function confirm(user: { id: string }, rows: Array<Record<string, unknown>>) {
  return request(app)
    .post('/api/sms/opening-balance/confirm')
    .set('Authorization', `Bearer ${accessTokenFor(user)}`)
    .set('Idempotency-Key', randomUUID())
    .send({ balanceDate: '2026-11-01', rows });
}

function get(user: { id: string }, path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${accessTokenFor(user)}`);
}

const vin = (n: number) => `MHWOPENBAL${String(n).padStart(7, '0')}`;

function baseRow(n: number, state: string, extra: Record<string, unknown> = {}) {
  return {
    row: n + 1,
    vin: vin(n),
    variantId: world.variant.id,
    showroomId: world.bekasi.id,
    state,
    ...extra,
  };
}

describe('A14 — opening balance', () => {
  it('enters each unit in its real state and the numbers add up', async () => {
    const res = await confirm(world.bekasiAdmin, [
      baseRow(1, 'AVAILABLE'),
      baseRow(2, 'BOOKED', { spkNumber: 'SPK-021', customerName: 'Budi' }),
      baseRow(3, 'SOLD_PENDING_PICKUP', { spkNumber: 'SPK-021', customerName: 'Budi' }),
      baseRow(4, 'ACTIVE_RTO', { contractNumber: 'RTO-A-001', customerName: 'Sari', contractStartDate: '2026-08-15' }),
      baseRow(5, 'INSPECTION'),
      baseRow(6, 'SHOW_UNIT', { eventName: 'Jakarta Fair', eventLocation: 'JIExpo', expectedReturnDate: '2026-12-01' }),
    ]).expect(201);
    expect(dataOf<{ createdCount: number }>(res).createdCount).toBe(6);

    const summary = await get(world.bekasiAdmin, `/api/sms/dashboard/summary?showroomId=${world.bekasi.id}`).expect(200);
    // In the showroom: ready + booked + sold-awaiting-pickup + inspection = 4.
    // Out with a customer on RTO and out at an event = 2, tracked as "outside".
    expect(dataOf<DashboardSummary>(summary).totals).toMatchObject({
      physical: 4,
      ready: 1,
      booked: 1,
      soldPendingPickup: 1,
      inspection: 1,
      outside: 2,
    });

    // Two units on one SPK share ONE order with two lines.
    const orders = await prisma.smsOrder.findMany({ include: { lines: true } });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.isOpeningBalance).toBe(true);
    expect(orders[0]!.lines.map((line) => line.status).sort()).toEqual(['BOOKED', 'SOLD']);

    // Every unit is flagged, has exactly one OPENING_BALANCE event dated on
    // the cutover date, and holds the "at most one" pointer its state needs.
    const units = await prisma.smsUnit.findMany({ orderBy: { vin: 'asc' } });
    expect(units.every((unit) => unit.isOpeningBalance)).toBe(true);
    expect(await prisma.smsUnitEvent.count({ where: { eventType: 'OPENING_BALANCE' } })).toBe(6);
    const opening = await prisma.smsUnitEvent.findFirstOrThrow({ where: { eventType: 'OPENING_BALANCE' } });
    expect(opening.eventDate.toISOString().slice(0, 10)).toBe('2026-11-01');

    const byVin = new Map(units.map((unit) => [unit.vin, unit]));
    expect(byVin.get(vin(2))!.activeOrderLineId).not.toBeNull();
    expect(byVin.get(vin(3))!.activeOrderLineId).not.toBeNull();
    expect(byVin.get(vin(6))!.openShowLoanId).not.toBeNull();
    expect(byVin.get(vin(6))!.physicalLocationId).toBeNull();
  });

  it('an active RTO contract enters WITHOUT a fictitious booking', async () => {
    await confirm(world.bekasiAdmin, [
      baseRow(4, 'ACTIVE_RTO', { contractNumber: 'RTO-A-001', customerName: 'Sari' }),
    ]).expect(201);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { vin: vin(4) } });
    expect(unit.status).toBe('ACTIVE_RTO');
    expect(unit.physicalLocationId).toBeNull();
    expect(unit.responsibleShowroomId).toBe(world.bekasi.id);
    expect(unit.wasRto).toBe(true);

    const contract = await prisma.smsRtoContract.findUniqueOrThrow({ where: { contractNumber: 'RTO-A-001' } });
    expect(contract.id).toBe(unit.openRtoContractId);
    expect(contract.isOpeningBalance).toBe(true);
    expect(contract.orderLineId).toBeNull();
    expect(contract.closedAt).toBeNull();
    expect(contract.originShowroomId).toBe(world.bekasi.id);

    // No order, no order line, no booking event was invented.
    expect(await prisma.smsOrder.count()).toBe(0);
    expect(await prisma.smsOrderLine.count()).toBe(0);
    expect(await prisma.smsUnitEvent.count({ where: { eventType: 'BOOKING_CREATED' } })).toBe(0);

    // The VIN card says where its history starts.
    const card = await get(world.bekasiAdmin, `/api/sms/units/${unit.id}`).expect(200);
    const data = dataOf<{ isOpeningBalance: boolean; timeline: Array<{ eventType: string }> }>(card);
    expect(data.isOpeningBalance).toBe(true);
    expect(data.timeline.map((event) => event.eventType)).toEqual(['OPENING_BALANCE']);
  });

  it('a unit under inspection gets its inspection through the ledger and can be released', async () => {
    await confirm(world.bekasiAdmin, [baseRow(5, 'INSPECTION')]).expect(201);
    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { vin: vin(5) } });
    const events = await prisma.smsUnitEvent.findMany({ where: { unitId: unit.id }, orderBy: { seq: 'asc' } });
    expect(events.map((event) => event.eventType)).toEqual(['OPENING_BALANCE', 'INSPECTION_STARTED']);
    expect(events[1]!.inspectionId).not.toBeNull();
    expect(events[1]!.statusAfter).toBe('INSPECTION');
  });

  it('refuses a VIN that is already in stock or already expected, and writes nothing', async () => {
    await confirm(world.bekasiAdmin, [baseRow(1, 'AVAILABLE')]).expect(201);

    const again = await confirm(world.bekasiAdmin, [baseRow(1, 'AVAILABLE'), baseRow(7, 'AVAILABLE')]);
    expect(again.status).toBe(422);
    expect(errorOf(again)?.details?.some((detail) => detail['vin'] === vin(1))).toBe(true);
    // All-or-nothing: the valid row in the same file was not imported either.
    expect(await prisma.smsUnit.count()).toBe(1);
  });

  it('an invalid row blocks the whole file', async () => {
    const res = await confirm(world.bekasiAdmin, [
      baseRow(1, 'AVAILABLE'),
      baseRow(2, 'ACTIVE_RTO'), // no contract number
    ]);
    expect(res.status).toBe(422);
    expect(await prisma.smsUnit.count()).toBe(0);
    expect(await prisma.smsRtoContract.count()).toBe(0);
  });

  it('A13 — only for showrooms where the caller may receive stock', async () => {
    const jakartaRow = { ...baseRow(1, 'AVAILABLE'), showroomId: world.jakarta.id };

    const viewer = await confirm(world.bekasiAdminJakartaViewer, [jakartaRow]);
    expect(viewer.status).toBe(403);
    const stranger = await confirm(world.bekasiAdmin, [jakartaRow]);
    expect(stranger.status).toBe(403);
    // One row for a showroom the caller may not write to sinks the file.
    const mixed = await confirm(world.bekasiAdminJakartaViewer, [baseRow(2, 'AVAILABLE'), jakartaRow]);
    expect(mixed.status).toBe(403);
    expect(await prisma.smsUnit.count()).toBe(0);

    await confirm(world.jakartaAdmin, [jakartaRow]).expect(201);
    expect(await prisma.smsUnit.count()).toBe(1);
  });
});
