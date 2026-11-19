/**
 * End-to-end tests of the stage-2 flows over HTTP against real PostgreSQL:
 * manifest import (A01), partial receiving with a damaged unit (A02),
 * inspection + release, and location-scoped access on every path (A13).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../../lib/prisma.js';
import type { DashboardSummary } from '../dashboard/types.js';
import type {
  ConfirmResponse,
  FindingsResponse,
  InspectResponse,
  PreviewResponse,
  ReceiveResponse,
} from '../shipments/types.js';
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

// ── Small HTTP helpers ─────────────────────────────────────────────────────

/** supertest types `body` as `any`; read it through these typed accessors. */
interface HttpResult {
  body: unknown;
}
const dataOf = <T>(res: HttpResult): T => (res.body as { data: T }).data;
const totalOf = (res: HttpResult): number => (res.body as { meta: { total: number } }).meta.total;
const errorCodeOf = (res: HttpResult): string | undefined =>
  (res.body as { error?: { code?: string } }).error?.code;

/** The parts of the VIN card these tests look at. */
interface UnitCard {
  status: string;
  availableActions: string[];
  releaseBlockers: string[];
  inspections: Array<{ id: string }>;
  timeline: Array<{ eventType: string }>;
}

function get(user: { id: string }, path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${accessTokenFor(user)}`);
}

function post(user: { id: string }, path: string, body: unknown, key: string | null = randomUUID()) {
  const req = request(app).post(path).set('Authorization', `Bearer ${accessTokenFor(user)}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body as object);
}

function put(user: { id: string }, path: string, body: unknown, key: string | null = randomUUID()) {
  const req = request(app).put(path).set('Authorization', `Bearer ${accessTokenFor(user)}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body as object);
}

/** VINs with the standard 17-character shape; the first one has leading zeros. */
const vinAt = (n: number) => (n === 0 ? '00000000000000017' : `MHWSMSTEST${String(n).padStart(7, '0')}`);

function importShipment(
  user: { id: string },
  destinationLocationId: string,
  vins: string[],
  batchNumber = 'CK-07',
) {
  return post(user, '/api/sms/shipments/import/confirm', {
    destinationLocationId,
    batchNumber,
    lines: vins.map((vin, index) => ({
      vin,
      variantId: world.variant.id,
      sourceRows: [{ row: index + 2, values: { VIN: vin } }],
    })),
  });
}

async function lineIdsOf(shipmentId: string): Promise<Map<string, string>> {
  const lines = await prisma.smsShipmentLine.findMany({ where: { shipmentId } });
  return new Map(lines.map((line) => [line.vin, line.id]));
}

async function stockOf(user: { id: string }, showroomId: string) {
  const res = await get(user, `/api/sms/dashboard/summary?showroomId=${showroomId}`).expect(200);
  return dataOf<DashboardSummary>(res).totals as unknown as Record<string, number>;
}

async function listTotal(user: { id: string }, showroomId: string, view: string): Promise<number> {
  const res = await get(user, `/api/sms/units?showroomId=${showroomId}&view=${view}`).expect(200);
  return totalOf(res);
}

// ── A01 ────────────────────────────────────────────────────────────────────

describe('A01 — manifest with repeated VINs, battery serials and an ambiguous row, uploaded twice', () => {
  // Pasted from Excel: the motorcycle row is followed by component rows that
  // repeat its VIN, battery serial numbers live in the same sheet, one row
  // cannot be classified, and one VIN starts with zeros.
  const pasted = [
    ['Jenis Barang', 'Nomor Rangka', 'Nomor Mesin', 'Model', 'Varian', 'Warna'].join('\t'),
    ['Unit Motor', vinAt(0), 'ENG0001', 'Athena', 'Extended', 'Black'].join('\t'),
    ['Baterai', vinAt(0), 'BAT-SN-555', '', '', ''].join('\t'),
    ['Unit Motor', vinAt(1), 'ENG0002', 'Athena', 'Extended', 'Black'].join('\t'),
    ['Charger', vinAt(1), 'CHG-777', '', '', ''].join('\t'),
    ['Unit Motor', vinAt(2), 'ENG0003', 'Athena', 'Extended', 'Black'].join('\t'),
    ['Lain-lain', 'SN-UNKNOWN-1', '', '', '', ''].join('\t'),
  ].join('\n');

  it('never turns components into motorcycles, keeps leading zeros, and adds nothing on re-upload', async () => {
    const inspect = await post(world.bekasiAdmin, '/api/sms/shipments/import/inspect', { text: pasted }, null).expect(200);
    const { sheet } = dataOf<InspectResponse>(inspect);
    expect(sheet.suggestedMapping['vin']).toBe(1);
    expect(sheet.suggestedMapping['itemType']).toBe(0);

    const options = {
      headerRowIndex: sheet.headerRowIndex,
      mapping: sheet.suggestedMapping,
      destinationLocationId: world.bekasi.id,
      batchNumber: 'CK-07',
    };
    const preview = await post(world.bekasiAdmin, '/api/sms/shipments/import/preview', { text: pasted, options }, null).expect(200);
    const data = dataOf<PreviewResponse>(preview);

    const vins = data.candidates.map((c) => c.vin).sort();
    expect(vins).toEqual([vinAt(0), vinAt(1), vinAt(2)].sort());
    expect(data.candidates.every((c) => c.classification === 'NEW')).toBe(true);
    expect(data.candidates.every((c) => c.variantId === world.variant.id)).toBe(true);
    // The source rows that were folded together stay reviewable.
    const first = data.candidates.find((c) => c.vin === vinAt(0));
    expect(first?.sourceRows.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data.ambiguousRows).toHaveLength(1);
    expect(data.skippedComponents.count).toBe(2);

    const lines = data.candidates.map((c) => ({
      vin: c.vin,
      variantId: c.variantId,
      sourceRows: c.sourceRows,
    }));
    const body = { destinationLocationId: world.bekasi.id, batchNumber: 'CK-07', lines };

    const firstConfirm = await post(world.bekasiAdmin, '/api/sms/shipments/import/confirm', body).expect(201);
    expect(dataOf<ConfirmResponse>(firstConfirm).createdCount).toBe(3);

    // Same file again (a new submission, so a new idempotency key).
    const secondConfirm = await post(world.bekasiAdmin, '/api/sms/shipments/import/confirm', body).expect(201);
    expect(dataOf<ConfirmResponse>(secondConfirm).createdCount).toBe(0);
    expect(dataOf<ConfirmResponse>(secondConfirm).skipped).toHaveLength(3);
    expect(dataOf<ConfirmResponse>(secondConfirm).shipment.id).toBe(dataOf<ConfirmResponse>(firstConfirm).shipment.id);

    expect(await prisma.smsShipment.count()).toBe(1);
    expect(await prisma.smsShipmentLine.count()).toBe(3);
    // Importing only lists what is EXPECTED — no unit exists before receipt.
    expect(await prisma.smsUnit.count()).toBe(0);

    // The preview now reports them as already listed.
    const again = await post(world.bekasiAdmin, '/api/sms/shipments/import/preview', { text: pasted, options }, null).expect(200);
    expect(dataOf<PreviewResponse>(again).summary.newCount).toBe(0);
    expect(dataOf<PreviewResponse>(again).summary.alreadyInShipment).toBe(3);
  });
});

// ── A02 + inspection + release ─────────────────────────────────────────────

describe('A02 — of 10 VINs, 9 arrive (1 damaged); the last one arrives later', () => {
  it('shows 9 physical / 8 ready first, then 10 physical / 9 ready, and never receives twice', async () => {
    const vins = Array.from({ length: 10 }, (_, i) => vinAt(i + 10));
    const confirm = await importShipment(world.bekasiAdmin, world.bekasi.id, vins).expect(201);
    const shipmentId = dataOf<ConfirmResponse>(confirm).shipment.id;
    const lineIds = await lineIdsOf(shipmentId);

    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({ physical: 0, ready: 0, expected: 10 });

    const firstNine = vins.slice(0, 9).map((vin, index) => ({
      lineId: lineIds.get(vin)!,
      condition: index === 0 ? 'DAMAGED' : 'OK',
      ...(index === 0 ? { damageNotes: 'Scratched side panel' } : {}),
    }));
    const receive = await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/receive`, { items: firstNine }).expect(200);
    expect(dataOf<ReceiveResponse>(receive).received).toHaveLength(9);
    expect(dataOf<ReceiveResponse>(receive).counts).toMatchObject({ expected: 10, receivedOk: 8, receivedDamaged: 1, pending: 1 });

    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({
      physical: 9,
      ready: 8,
      inspection: 1,
      expected: 1,
    });
    // Every dashboard number equals the list behind it.
    expect(await listTotal(world.bekasiAdmin, world.bekasi.id, 'physical')).toBe(9);
    expect(await listTotal(world.bekasiAdmin, world.bekasi.id, 'ready')).toBe(8);
    expect(await listTotal(world.bekasiAdmin, world.bekasi.id, 'inspection')).toBe(1);

    // Confirming an already received line again is safe: no second unit.
    const repeat = await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/receive`, {
      items: [{ lineId: lineIds.get(vins[1]!)!, condition: 'OK' }],
    }).expect(200);
    expect(dataOf<ReceiveResponse>(repeat).received).toHaveLength(0);
    expect(dataOf<ReceiveResponse>(repeat).alreadyReceived).toHaveLength(1);
    expect(await prisma.smsUnit.count()).toBe(9);

    // The follow-up receipt continues on the SAME shipment.
    await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/receive`, {
      items: [{ lineId: lineIds.get(vins[9]!)!, condition: 'OK' }],
    }).expect(200);
    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({
      physical: 10,
      ready: 9,
      inspection: 1,
      expected: 0,
    });
    expect(await prisma.smsShipment.count()).toBe(1);

    // Jakarta counts none of it.
    expect(await stockOf(world.jakartaAdmin, world.jakarta.id)).toMatchObject({ physical: 0, ready: 0 });
  });

  it('a retried request with the same Idempotency-Key is recorded once', async () => {
    const vins = [vinAt(30), vinAt(31)];
    const confirm = await importShipment(world.bekasiAdmin, world.bekasi.id, vins).expect(201);
    const shipmentId = dataOf<ConfirmResponse>(confirm).shipment.id;
    const lineIds = await lineIdsOf(shipmentId);
    const body = { items: vins.map((vin) => ({ lineId: lineIds.get(vin)!, condition: 'OK' })) };
    const key = randomUUID();

    const first = await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/receive`, body, key).expect(200);
    const retry = await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/receive`, body, key).expect(200);

    expect(dataOf<ReceiveResponse>(retry)).toEqual(dataOf<ReceiveResponse>(first));
    expect(await prisma.smsUnit.count()).toBe(2);
    expect(await prisma.smsUnitEvent.count({ where: { eventType: 'RECEIPT_OK' } })).toBe(2);
  });

  it('a mutation without an Idempotency-Key is refused', async () => {
    const confirm = await importShipment(world.bekasiAdmin, world.bekasi.id, [vinAt(40)]).expect(201);
    const shipmentId = dataOf<ConfirmResponse>(confirm).shipment.id;
    const lineIds = await lineIdsOf(shipmentId);
    const res = await post(
      world.bekasiAdmin,
      `/api/sms/shipments/${shipmentId}/receive`,
      { items: [{ lineId: lineIds.get(vinAt(40))!, condition: 'OK' }] },
      null,
    );
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await prisma.smsUnit.count()).toBe(0);
  });
});

describe('damaged unit → inspection → release', () => {
  it('stays out of ready stock until it has passed inspection AND been released', async () => {
    const confirm = await importShipment(world.bekasiAdmin, world.bekasi.id, [vinAt(50)]).expect(201);
    const shipmentId = dataOf<ConfirmResponse>(confirm).shipment.id;
    const lineIds = await lineIdsOf(shipmentId);
    const receive = await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/receive`, {
      items: [{ lineId: lineIds.get(vinAt(50))!, condition: 'DAMAGED', damageNotes: 'Cracked mirror' }],
    }).expect(200);
    const unitId = dataOf<ReceiveResponse>(receive).received[0]!.unit.id;

    // Cannot be released before the inspection has passed.
    const early = await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {});
    expect(early.status).toBe(409);
    expect(errorCodeOf(early)).toBe('SMS_INSPECTION_NOT_PASSED');

    const card = await get(world.bekasiAdmin, `/api/sms/units/${unitId}`).expect(200);
    expect(dataOf<UnitCard>(card).status).toBe('INSPECTION');
    expect(dataOf<UnitCard>(card).availableActions).toContain('RECORD_INSPECTION');
    expect(dataOf<UnitCard>(card).availableActions).not.toContain('RELEASE');
    expect(dataOf<UnitCard>(card).releaseBlockers.length).toBeGreaterThan(0);
    const inspectionId = dataOf<UnitCard>(card).inspections[0]!.id;

    await put(world.bekasiAdmin, `/api/sms/inspections/${inspectionId}/result`, {
      result: 'PASSED',
      condition: 'GOOD',
      notes: 'Mirror replaced',
    }).expect(200);

    // Passing the inspection alone does not make it ready.
    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({ physical: 1, ready: 0 });

    await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, { notes: 'Fit to offer' }).expect(200);
    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({ physical: 1, ready: 1, inspection: 0 });

    const after = await get(world.bekasiAdmin, `/api/sms/units/${unitId}`).expect(200);
    const timeline = dataOf<UnitCard>(after).timeline.map((e) => e.eventType);
    expect(timeline).toEqual(['RECEIPT_DAMAGED', 'INSPECTION_STARTED', 'INSPECTION_PASSED', 'UNIT_RELEASED']);

    // Who recorded it is in the audit trail.
    expect(await prisma.auditLog.count({ where: { resourceType: 'SmsUnit', resourceId: unitId } })).toBeGreaterThanOrEqual(2);
  });

  it('a motorcycle with a different identity is physical stock, held until reconciled', async () => {
    const confirm = await importShipment(world.bekasiAdmin, world.bekasi.id, [vinAt(60)]).expect(201);
    const shipmentId = dataOf<ConfirmResponse>(confirm).shipment.id;
    const finding = await post(world.bekasiAdmin, `/api/sms/shipments/${shipmentId}/findings`, {
      vin: vinAt(61),
      variantId: world.variant.id,
      notes: 'Not on the delivery note',
    }).expect(201);
    const unitId = dataOf<FindingsResponse>(finding).unit.id;

    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({
      physical: 1,
      ready: 0,
      identityMismatch: 1,
      expected: 1,
    });

    await post(world.bekasiAdmin, `/api/sms/units/${unitId}/resolve-identity`, {
      outcome: 'AVAILABLE',
      notes: 'Confirmed with the factory',
    }).expect(200);
    expect(await stockOf(world.bekasiAdmin, world.bekasi.id)).toMatchObject({ physical: 1, ready: 1, identityMismatch: 0 });
  });
});

// ── A13 ────────────────────────────────────────────────────────────────────

describe('A13 — the server enforces action + location on every path', () => {
  async function jakartaShipmentWithUnit() {
    const confirm = await importShipment(world.jakartaAdmin, world.jakarta.id, [vinAt(70), vinAt(71)], 'CK-08').expect(201);
    const shipmentId = dataOf<ConfirmResponse>(confirm).shipment.id;
    const lineIds = await lineIdsOf(shipmentId);
    const receive = await post(world.jakartaAdmin, `/api/sms/shipments/${shipmentId}/receive`, {
      items: [{ lineId: lineIds.get(vinAt(70))!, condition: 'DAMAGED', damageNotes: 'Dent' }],
    }).expect(200);
    return {
      shipmentId,
      pendingLineId: lineIds.get(vinAt(71))!,
      unitId: dataOf<ReceiveResponse>(receive).received[0]!.unit.id,
    };
  }

  it('an admin of Bekasi with read-only access to Jakarta can look but not act there', async () => {
    const jakarta = await jakartaShipmentWithUnit();
    const user = world.bekasiAdminJakartaViewer;

    // Reading Jakarta is allowed.
    await get(user, `/api/sms/dashboard/summary?showroomId=${world.jakarta.id}`).expect(200);
    await get(user, `/api/sms/units/${jakarta.unitId}`).expect(200);
    await get(user, `/api/sms/shipments/${jakarta.shipmentId}`).expect(200);

    // Acting in Jakarta is refused on every write path.
    const attempts = [
      post(user, `/api/sms/shipments/${jakarta.shipmentId}/receive`, { items: [{ lineId: jakarta.pendingLineId, condition: 'OK' }] }),
      post(user, `/api/sms/shipments/${jakarta.shipmentId}/findings`, { vin: vinAt(79), variantId: world.variant.id, notes: 'x' }),
      post(user, '/api/sms/shipments/import/confirm', {
        destinationLocationId: world.jakarta.id,
        batchNumber: 'CK-09',
        lines: [{ vin: vinAt(78), sourceRows: [{ row: 2, values: {} }] }],
      }),
      post(user, `/api/sms/units/${jakarta.unitId}/release`, {}),
      put(user, `/api/sms/units/${jakarta.unitId}/details`, { licensePlate: 'B 1 X' }, null),
      post(user, '/api/sms/inspections', { unitId: jakarta.unitId }),
    ];
    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status, `${res.request.method} ${res.request.url}`).toBe(403);
    }
    expect(await prisma.smsUnit.count()).toBe(1);
    expect(await prisma.smsShipment.count()).toBe(1);

    // The same user can still work in Bekasi.
    await importShipment(user, world.bekasi.id, [vinAt(80)], 'CK-10').expect(201);

    // Their unit card for Jakarta offers no actions.
    const card = await get(user, `/api/sms/units/${jakarta.unitId}`).expect(200);
    expect(dataOf<UnitCard>(card).availableActions).toEqual([]);
  });

  it('an admin with no access to Jakarta cannot even see it', async () => {
    const jakarta = await jakartaShipmentWithUnit();
    const user = world.bekasiAdmin;

    expect((await get(user, `/api/sms/dashboard/summary?showroomId=${world.jakarta.id}`)).status).toBe(403);
    expect((await get(user, `/api/sms/units?showroomId=${world.jakarta.id}`)).status).toBe(403);
    // A single record outside the caller's scope looks like it does not exist.
    expect((await get(user, `/api/sms/units/${jakarta.unitId}`)).status).toBe(404);
    expect((await get(user, `/api/sms/shipments/${jakarta.shipmentId}`)).status).toBe(404);

    const search = await get(user, `/api/sms/units/search?q=${vinAt(70).slice(-6)}`).expect(200);
    expect(dataOf<unknown[]>(search)).toEqual([]);
    const list = await get(user, '/api/sms/shipments').expect(200);
    expect(dataOf<unknown[]>(list)).toEqual([]);

    const context = await get(user, '/api/sms/context').expect(200);
    expect(dataOf<{ showrooms: Array<{ id: string }> }>(context).showrooms.map((s) => s.id)).toEqual([world.bekasi.id]);
  });

  it('a user without any stock role is kept out entirely', async () => {
    const outsider = await prisma.user.create({
      data: { name: 'Outsider', employeeId: 'T998', email: 't998@example.test', passwordHash: 'x' },
    });
    expect((await get(outsider, '/api/sms/context')).status).toBe(403);
    expect((await get(outsider, `/api/sms/dashboard/summary?showroomId=${world.bekasi.id}`)).status).toBe(403);
    expect((await request(app).get('/api/sms/context')).status).toBe(401);
  });
});
