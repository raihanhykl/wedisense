/**
 * Integration tests (real PostgreSQL) for the guarantees the SMS foundation
 * makes that cannot be proven with a mocked client: row locking, unique
 * constraints, exactly-once writes and location-scoped access resolution.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { prisma } from '../../../lib/prisma.js';
import { AppError } from '../../../middleware/error-handler.js';
import { assertCan, can, locationScope, resolveSmsAccess } from '../lib/access.js';
import { runIdempotent } from '../lib/idempotency.js';
import { businessToday, createUnitWithEvent, loadEffectiveEvents, lockUnits, recordUnitEvent } from '../lib/ledger.js';
import { smsTransaction } from '../lib/transaction.js';
import { disconnect, nextVin, resetSmsDatabase, type SmsTestWorld } from '../../../test/integration/sms-fixtures.js';

let world: SmsTestWorld;

beforeEach(async () => {
  world = await resetSmsDatabase();
});

afterAll(async () => {
  await disconnect();
});

async function receiveUnit(locationId = world.bekasi.id): Promise<string> {
  const { unit } = await smsTransaction((tx) =>
    createUnitWithEvent(
      tx,
      { vin: nextVin(), variantId: world.variant.id, createdByUserId: world.bekasiAdmin.id },
      {
        event: { type: 'RECEIPT_OK', locationId },
        eventDate: businessToday(),
        performedByUserId: world.bekasiAdmin.id,
      },
    ),
  );
  return unit.id;
}

function book(unitId: string, userId: string) {
  return smsTransaction(async (tx) => {
    const [unit] = await lockUnits(tx, [unitId]);
    return recordUnitEvent(tx, unit!, {
      event: { type: 'BOOKING_CREATED' },
      eventDate: businessToday(),
      performedByUserId: userId,
    });
  });
}

describe('unit lock — two admins act on the same VIN at once (A03)', () => {
  it('lets exactly one booking through; the other sees the current state', async () => {
    const unitId = await receiveUnit();

    const results = await Promise.allSettled([
      book(unitId, world.bekasiAdmin.id),
      book(unitId, world.centralOps.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AppError);
    expect((rejected[0]!.reason as AppError).code).toBe('SMS_INVALID_TRANSITION');
    expect((rejected[0]!.reason as AppError).statusCode).toBe(409);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('BOOKED');
    const bookings = await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'BOOKING_CREATED' } });
    expect(bookings).toBe(1);
  });

  it('holds under a burst of ten simultaneous attempts', async () => {
    const unitId = await receiveUnit();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => book(unitId, world.bekasiAdmin.id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'BOOKING_CREATED' } })).toBe(1);
  });

  it('does not deadlock when two multi-unit operations name the same units in opposite order', async () => {
    const [a, b] = [await receiveUnit(), await receiveUnit()];
    const touch = (ids: string[]) =>
      smsTransaction(async (tx) => {
        const units = await lockUnits(tx, ids);
        // Hold the locks briefly so the two transactions really overlap.
        await tx.$executeRaw`SELECT pg_sleep(0.2)`;
        return units.map((unit) => unit.id);
      });

    const [first, second] = await Promise.all([touch([a, b]), touch([b, a])]);
    // Rows come back in the order each caller asked for.
    expect(first).toEqual([a, b]);
    expect(second).toEqual([b, a]);
  });

  it('reports an unknown unit as 404', async () => {
    await expect(
      smsTransaction((tx) => lockUnits(tx, ['00000000-0000-4000-8000-000000000000'])),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_UNIT_NOT_FOUND' });
  });
});

describe('ledger — unit and event are written together', () => {
  it('rejects a second unit with the same VIN', async () => {
    const vin = nextVin();
    const create = () =>
      smsTransaction((tx) =>
        createUnitWithEvent(
          tx,
          { vin, variantId: world.variant.id, createdByUserId: world.bekasiAdmin.id },
          {
            event: { type: 'RECEIPT_OK', locationId: world.bekasi.id },
            eventDate: businessToday(),
            performedByUserId: world.bekasiAdmin.id,
          },
        ),
      );

    await create();
    await expect(create()).rejects.toMatchObject({ statusCode: 409, code: 'SMS_VIN_ALREADY_EXISTS' });
    expect(await prisma.smsUnit.count({ where: { vin } })).toBe(1);
    expect(await prisma.smsUnitEvent.count()).toBe(1);
  });

  it('writes nothing when the transition is invalid', async () => {
    const unitId = await receiveUnit();
    await expect(
      smsTransaction(async (tx) => {
        const [unit] = await lockUnits(tx, [unitId]);
        return recordUnitEvent(tx, unit!, {
          event: { type: 'PICKUP_CONFIRMED' },
          eventDate: businessToday(),
          performedByUserId: world.bekasiAdmin.id,
        });
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_INVALID_TRANSITION' });

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe('AVAILABLE');
    expect(await prisma.smsUnitEvent.count({ where: { unitId } })).toBe(1);
  });

  it('keeps the projection, the snapshot and the effective ledger in step', async () => {
    const unitId = await receiveUnit();
    await book(unitId, world.bekasiAdmin.id);

    const unit = await prisma.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
    const events = await smsTransaction((tx) => loadEffectiveEvents(tx, unitId));
    expect(events.map((event) => event.eventType)).toEqual(['RECEIPT_OK', 'BOOKING_CREATED']);
    expect(events[0]!.seq).toBeLessThan(events[1]!.seq);
    expect(events[1]!.statusAfter).toBe(unit.status);
    expect(events[1]!.physicalLocationAfterId).toBe(unit.physicalLocationId);
    expect(unit.physicalLocationId).toBe(world.bekasi.id);
  });
});

describe('idempotency — double click and retry are recorded once', () => {
  const key = () => `test-key-${Math.random().toString(36).slice(2).padEnd(16, '0')}`;

  function bookOnce(unitId: string, idempotencyKey: string, payload: unknown = { unitId }) {
    return runIdempotent(
      { key: idempotencyKey, userId: world.bekasiAdmin.id, operation: 'test.book', payload },
      async (tx) => {
        const [unit] = await lockUnits(tx, [unitId]);
        const { event } = await recordUnitEvent(tx, unit!, {
          event: { type: 'BOOKING_CREATED' },
          eventDate: businessToday(),
          performedByUserId: world.bekasiAdmin.id,
        });
        return { eventId: event.id, recordedAt: event.recordedAt };
      },
    );
  }

  it('replays the stored response for a repeated request', async () => {
    const unitId = await receiveUnit();
    const k = key();

    const first = await bookOnce(unitId, k);
    const second = await bookOnce(unitId, k);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);
    expect(await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'BOOKING_CREATED' } })).toBe(1);
  });

  it('runs the mutation once when the same request arrives twice simultaneously', async () => {
    const unitId = await receiveUnit();
    const k = key();

    const [a, b] = await Promise.all([bookOnce(unitId, k), bookOnce(unitId, k)]);

    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.body).toEqual(b.body);
    expect(await prisma.smsUnitEvent.count({ where: { unitId, eventType: 'BOOKING_CREATED' } })).toBe(1);
  });

  it('rejects a key reused for a different payload', async () => {
    const unitId = await receiveUnit();
    const k = key();
    await bookOnce(unitId, k);
    await expect(bookOnce(unitId, k, { unitId, something: 'else' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('releases the key when the mutation fails, so it can be retried', async () => {
    const unitId = await receiveUnit();
    const k = key();
    await book(unitId, world.bekasiAdmin.id); // unit is now BOOKED → booking again fails

    await expect(bookOnce(unitId, k)).rejects.toMatchObject({ code: 'SMS_INVALID_TRANSITION' });
    expect(await prisma.smsIdempotencyKey.count({ where: { key: k } })).toBe(0);
  });
});

describe('access — permissions are resolved per location (A13)', () => {
  it('a role scoped to a parent location covers the showroom below it', async () => {
    const access = await resolveSmsAccess(world.jakartaAdmin.id);
    expect(can(access, SMS_PERMISSIONS.ORDERS_MANAGE, world.jakarta.id)).toBe(true);
    expect(can(access, SMS_PERMISSIONS.ORDERS_MANAGE, world.jakartaCity.id)).toBe(true);
    expect(can(access, SMS_PERMISSIONS.ORDERS_MANAGE, world.bekasi.id)).toBe(false);
  });

  it('an admin in Bekasi with read-only access to Jakarta cannot act in Jakarta', async () => {
    const access = await resolveSmsAccess(world.bekasiAdminJakartaViewer.id);

    expect(can(access, SMS_PERMISSIONS.STOCK_VIEW, world.jakarta.id)).toBe(true);
    expect(can(access, SMS_PERMISSIONS.ORDERS_MANAGE, world.bekasi.id)).toBe(true);
    expect(can(access, SMS_PERMISSIONS.ORDERS_MANAGE, world.jakarta.id)).toBe(false);
    expect(can(access, SMS_PERMISSIONS.RETURNS_DECIDE, world.jakarta.id)).toBe(false);
    expect(() => assertCan(access, SMS_PERMISSIONS.ORDERS_MANAGE, world.jakarta.id)).toThrowError(
      expect.objectContaining({ statusCode: 403, code: 'SMS_FORBIDDEN_AT_LOCATION' }),
    );

    expect(locationScope(access, SMS_PERMISSIONS.ORDERS_MANAGE)).toEqual([world.bekasi.id]);
    expect([...locationScope(access, SMS_PERMISSIONS.STOCK_VIEW)].sort()).toEqual(
      [world.bekasi.id, world.jakarta.id].sort(),
    );
  });

  it('an unscoped role is global', async () => {
    const access = await resolveSmsAccess(world.centralOps.id);
    expect(locationScope(access, SMS_PERMISSIONS.RETURNS_DECIDE)).toBe('ALL');
    expect(can(access, SMS_PERMISSIONS.RETURNS_DECIDE, world.bekasi.id)).toBe(true);
    expect(can(access, SMS_PERMISSIONS.RETURNS_DECIDE, null)).toBe(true);
  });

  it('a user without any SMS role holds nothing, and nothing applies without a location', async () => {
    const outsider = await prisma.user.create({ data: { name: 'Outsider', employeeId: 'T999' } });
    const access = await resolveSmsAccess(outsider.id);
    expect(locationScope(access, SMS_PERMISSIONS.STOCK_VIEW)).toEqual([]);

    const scoped = await resolveSmsAccess(world.bekasiAdmin.id);
    expect(can(scoped, SMS_PERMISSIONS.STOCK_VIEW, null)).toBe(false);
  });
});
