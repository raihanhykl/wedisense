/**
 * Integration tests for RTO contracts and sale returns (real PostgreSQL).
 *
 *   (c)  RTO-A from a booking → returned → inspection passes before closure →
 *        release refused (A06) → close → release (Ex-RTO) → RTO-B on the same VIN
 *   One open contract per VIN; contract numbers unique; close needs the
 *   motorcycle back; ownership transfer; sale return approved / rejected (A11);
 *   opening-balance contract returned and closed (A14 part 2); location scope.
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
const errorCodeOf = (res: HttpResult) => (res.body as { error?: { code?: string } }).error?.code;

const auth = (user: { id: string }) => `Bearer ${accessTokenFor(user)}`;
const get = (user: { id: string }, path: string) => request(app).get(path).set('Authorization', auth(user));
const post = (user: { id: string }, path: string, body: object, key = randomUUID()) =>
  request(app).post(path).set('Authorization', auth(user)).set('Idempotency-Key', key).send(body);
const put = (user: { id: string }, path: string, body: object, key = randomUUID()) =>
  request(app).put(path).set('Authorization', auth(user)).set('Idempotency-Key', key).send(body);

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

// ── Scenario helpers ───────────────────────────────────────────────────────

/** Enter one unit at Bekasi through the opening balance (dated 2026-11-01). */
async function openingUnit(state: string, extra: Record<string, unknown> = {}): Promise<string> {
  const vin = nextVin();
  await post(world.bekasiAdmin, '/api/sms/opening-balance/confirm', {
    balanceDate: '2026-11-01',
    rows: [{ row: 1, vin, variantId: world.variant.id, showroomId: world.bekasi.id, state, ...extra }],
  }).expect(201);
  return (await prisma.smsUnit.findUniqueOrThrow({ where: { vin } })).id;
}

async function bookUnit(unitId: string, spk: string): Promise<{ orderId: string; lineId: string }> {
  const res = await post(world.bekasiAdmin, '/api/sms/orders', {
    showroomId: world.bekasi.id,
    spkNumber: spk,
    salesUserId: world.bekasiAdmin.id,
    customerName: 'Sari',
    unitIds: [unitId],
  }).expect(201);
  const { orderId } = dataOf<{ orderId: string }>(res);
  const line = await prisma.smsOrderLine.findFirstOrThrow({ where: { orderId, unitId } });
  return { orderId, lineId: line.id };
}

function handOver(unitId: string, contractNumber: string, user = world.bekasiAdmin) {
  return post(user, '/api/sms/rto-contracts', {
    unitId,
    contractNumber,
    salesUserId: world.bekasiAdmin.id,
    customerName: 'Sari',
    startDate: today(),
  });
}

async function passPendingInspection(unitId: string): Promise<void> {
  const inspection = await prisma.smsInspection.findFirstOrThrow({
    where: { unitId, result: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  await put(world.bekasiAdmin, `/api/sms/inspections/${inspection.id}/result`, {
    result: 'PASSED',
    condition: 'GOOD',
  }).expect(200);
}

async function totals(): Promise<DashboardSummary['totals']> {
  const res = await get(world.bekasiAdmin, `/api/sms/dashboard/summary?showroomId=${world.bekasi.id}`).expect(200);
  return dataOf<DashboardSummary>(res).totals;
}

// ── (c) + A06 ──────────────────────────────────────────────────────────────

describe('RTO on one VIN twice (design case c) and the release gate (A06)', () => {
  it('runs RTO-A from a booking, holds release until the contract is closed, then RTO-B', async () => {
    const unitId = await openingUnit('AVAILABLE');
    const { lineId } = await bookUnit(unitId, 'SPK-RTO-1');

    const contractA = dataOf<{ contractId: string }>(await handOver(unitId, ' rto a 001 ').expect(201));
    const afterHandover = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(afterHandover).toMatchObject({
      status: 'ACTIVE_RTO',
      physicalLocationId: null,
      wasRto: true,
      openRtoContractId: contractA.contractId,
      activeOrderLineId: null,
    });
    const line = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.status).toBe('RTO_HANDED_OVER');
    const storedA = await prisma.smsRtoContract.findUniqueOrThrow({ where: { id: contractA.contractId } });
    expect(storedA.contractNumber).toBe('RTO A 001');
    expect(storedA.originShowroomId).toBe(world.bekasi.id);
    expect(await totals()).toMatchObject({ physical: 0, ready: 0 });

    // Returned at the origin showroom: physical again, under inspection, contract still open.
    await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contractA.contractId}/return`, {
      returnKind: 'RETURNED_BY_CUSTOMER',
      condition: 'FAIR',
      odometer: 1520,
    }).expect(200);
    const returned = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(returned).toMatchObject({
      status: 'INSPECTION',
      physicalLocationId: world.bekasi.id,
      openRtoContractId: contractA.contractId,
    });
    expect(await totals()).toMatchObject({ physical: 1, ready: 0 });

    // Inspection passes first — release must still be refused (contract open).
    await passPendingInspection(unitId);
    const early = await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {});
    expect(early.status).toBe(409);
    expect((await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } })).status).toBe('INSPECTION');

    // Close the contract (legal confirmation came from outside SMS), then release.
    const close = await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contractA.contractId}/close`, {
      legalReference: 'LEGAL-77',
    }).expect(200);
    expect(dataOf<{ alreadyDone?: boolean }>(close).alreadyDone).toBeFalsy();
    const closedA = await prisma.smsRtoContract.findUniqueOrThrow({ where: { id: contractA.contractId } });
    expect(closedA.outcome).toBe('RETURNED');
    expect(closedA.closedAt).not.toBeNull();
    expect(closedA.legalReference).toBe('LEGAL-77');

    // Closing again is a no-op.
    const again = await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contractA.contractId}/close`, {}).expect(200);
    expect(dataOf<{ alreadyDone?: boolean }>(again).alreadyDone).toBe(true);
    expect(
      await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'RTO_CONTRACT_CLOSED' } }),
    ).toBe(1);

    await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {}).expect(200);
    const released = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(released).toMatchObject({ status: 'AVAILABLE', wasRto: true, openRtoContractId: null });
    expect(await totals()).toMatchObject({ physical: 1, ready: 1 });

    // RTO-B straight from the ready unit; the VIN card shows two periods.
    const contractB = dataOf<{ contractId: string }>(await handOver(unitId, 'RTO-B-002').expect(201));
    const card = await get(world.bekasiAdmin, `/api/sms/units/${unitId}`).expect(200);
    const periods = dataOf<{ rtoContracts: Array<{ id: string; closedAt: string | null }> }>(card).rtoContracts;
    expect(periods).toHaveLength(2);
    expect(periods.find((p) => p.id === contractB.contractId)?.closedAt).toBeNull();
    expect(periods.find((p) => p.id === contractA.contractId)?.closedAt).not.toBeNull();
  });

  it('allows one open contract per VIN and unique contract numbers', async () => {
    const unitA = await openingUnit('AVAILABLE');
    const unitB = await openingUnit('AVAILABLE');
    await handOver(unitA, 'RTO-DUP-1').expect(201);

    const secondOnSameVin = await handOver(unitA, 'RTO-DUP-2');
    expect(secondOnSameVin.status).toBe(409);

    const duplicateNumber = await handOver(unitB, 'rto-dup-1');
    expect(duplicateNumber.status).toBe(409);
    expect(errorCodeOf(duplicateNumber)).toBe('SMS_CONTRACT_NUMBER_EXISTS');
    expect((await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitB } })).status).toBe('AVAILABLE');
  });

  it('refuses to close a contract while the motorcycle is still with the customer', async () => {
    const unitId = await openingUnit('AVAILABLE');
    const contract = dataOf<{ contractId: string }>(await handOver(unitId, 'RTO-OPEN-1').expect(201));
    const res = await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contract.contractId}/close`, {});
    expect(res.status).toBe(409);
    expect(errorCodeOf(res)).toBe('SMS_CONTRACT_NOT_RETURNED');
  });
});

// ── Ownership transfer ─────────────────────────────────────────────────────

describe('ownership transfer', () => {
  it('closes the contract and leaves the motorcycle with the customer', async () => {
    const unitId = await openingUnit('AVAILABLE');
    const contract = dataOf<{ contractId: string }>(await handOver(unitId, 'RTO-OWN-1').expect(201));

    await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contract.contractId}/ownership-transfer`, {
      legalReference: 'BPKB-123',
    }).expect(200);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit).toMatchObject({ status: 'PICKED_UP', physicalLocationId: null, openRtoContractId: null });
    const stored = await prisma.smsRtoContract.findUniqueOrThrow({ where: { id: contract.contractId } });
    expect(stored.outcome).toBe('OWNERSHIP_TRANSFERRED');
    expect(stored.closedAt).not.toBeNull();
    expect(await totals()).toMatchObject({ physical: 0 });
  });
});

// ── Sale returns (A11) ─────────────────────────────────────────────────────

async function soldAndPickedUp(spk: string) {
  const unitId = await openingUnit('AVAILABLE');
  const { orderId, lineId } = await bookUnit(unitId, spk);
  await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/record-sale`, { lineIds: [lineId] }).expect(200);
  await put(world.bekasiAdmin, `/api/sms/orders/${orderId}/lines/${lineId}/confirm-pickup`, {
    receiverName: 'Sari',
    vinConfirmed: true,
  }).expect(200);
  return { unitId, orderId, lineId };
}

describe('sale return (A11)', () => {
  it('approved: back in stock only after decision, passed inspection and release', async () => {
    const { unitId, orderId, lineId } = await soldAndPickedUp('SPK-SR-1');
    const base = `/api/sms/orders/${orderId}/lines/${lineId}/sale-return`;

    await put(world.bekasiAdmin, base, { reason: 'Brake noise', condition: 'FAIR' }).expect(200);
    const received = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(received).toMatchObject({
      status: 'INSPECTION',
      physicalLocationId: world.bekasi.id,
      activeOrderLineId: lineId,
    });

    await passPendingInspection(unitId);
    expect((await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {})).status).toBe(409);

    await put(world.bekasiAdmin, `${base}/decide`, { decision: 'APPROVED' }).expect(200);
    const line = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.status).toBe('RETURNED');
    expect(line.returnDecision).toBe('APPROVED');

    await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {}).expect(200);
    expect((await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } })).status).toBe('AVAILABLE');
  });

  it('rejected: the motorcycle goes back to the customer', async () => {
    const { unitId, orderId, lineId } = await soldAndPickedUp('SPK-SR-2');
    const base = `/api/sms/orders/${orderId}/lines/${lineId}/sale-return`;
    await put(world.bekasiAdmin, base, { reason: 'Changed mind', condition: 'GOOD' }).expect(200);

    const noReason = await put(world.bekasiAdmin, `${base}/decide`, { decision: 'REJECTED' });
    expect(noReason.status).toBeGreaterThanOrEqual(400);

    await put(world.bekasiAdmin, `${base}/decide`, {
      decision: 'REJECTED',
      reason: 'Outside the return policy',
    }).expect(200);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit).toMatchObject({ status: 'PICKED_UP', physicalLocationId: null, activeOrderLineId: null });
    const line = await prisma.smsOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.status).toBe('PICKED_UP');
    expect(line.returnDecision).toBe('REJECTED');
    expect(await totals()).toMatchObject({ physical: 0 });
  });
});

// ── Opening-balance contract (A14 part 2) ──────────────────────────────────

describe('opening-balance RTO contract', () => {
  it('can be returned, closed and released like a new one', async () => {
    const unitId = await openingUnit('ACTIVE_RTO', {
      contractNumber: 'RTO-OB-9',
      customerName: 'Sari',
      contractStartDate: '2026-08-15',
    });
    const contract = await prisma.smsRtoContract.findUniqueOrThrow({ where: { contractNumber: 'RTO-OB-9' } });
    expect(contract.isOpeningBalance).toBe(true);

    await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contract.id}/return`, {
      returnKind: 'REPOSSESSED',
      condition: 'POOR',
    }).expect(200);
    await put(world.bekasiAdmin, `/api/sms/rto-contracts/${contract.id}/close`, {}).expect(200);
    await passPendingInspection(unitId);
    await post(world.bekasiAdmin, `/api/sms/units/${unitId}/release`, {}).expect(200);

    const closed = await prisma.smsRtoContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(closed.outcome).toBe('REPOSSESSED');
    expect(await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } })).toMatchObject({
      status: 'AVAILABLE',
      wasRto: true,
    });
  });
});

// ── Location scope ─────────────────────────────────────────────────────────

describe('location scope', () => {
  it("a Jakarta admin cannot act on Bekasi's contract", async () => {
    const unitId = await openingUnit('AVAILABLE');
    const contract = dataOf<{ contractId: string }>(await handOver(unitId, 'RTO-SCOPE-1').expect(201));

    const res = await put(world.jakartaAdmin, `/api/sms/rto-contracts/${contract.contractId}/return`, {
      returnKind: 'RETURNED_BY_CUSTOMER',
      condition: 'GOOD',
    });
    expect([403, 404]).toContain(res.status);
    expect((await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } })).status).toBe('ACTIVE_RTO');

    await get(world.jakartaAdmin, `/api/sms/rto-contracts/${contract.contractId}`).expect(404);
  });
});
