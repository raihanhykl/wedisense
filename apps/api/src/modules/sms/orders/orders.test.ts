/**
 * Unit tests for the SMS orders service.
 *
 * All external dependencies (Prisma, ledger, idempotency) are mocked; every
 * test exercises service logic only. See the integration suite for real-
 * database / concurrency / HTTP behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsOrder: { findUnique: vi.fn(), create: vi.fn() },
    smsOrderLine: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    // Unit row lock (SELECT … FOR UPDATE) + the locked unit read.
    smsUnit: { findUniqueOrThrow: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/transaction.js', async () => {
  const { prisma } = await import('../../../lib/prisma.js');
  return {
    smsTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
});

vi.mock('../lib/idempotency.js', async () => {
  const { prisma } = await import('../../../lib/prisma.js');
  return {
    runIdempotent: vi.fn(async (
      _opts: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => ({ statusCode: 201, body: await fn(prisma), replayed: false })),
    requireIdempotencyKey: vi.fn(() => 'test-idempotency-key'),
  };
});

vi.mock('../lib/ledger.js', () => {
  const businessDateString = (moment: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(moment);
  return {
    recordUnitEvent: vi.fn(),
    resolveEventDate: vi.fn(() => new Date('2026-11-01')),
    businessDateString,
    businessToday: (now: Date = new Date()) => new Date(`${businessDateString(now)}T00:00:00.000Z`),
  };
});

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  findMany: vi.fn(),
  findById: vi.fn(),
  findOrderBySpk: vi.fn(),
  findOrderWithLine: vi.fn(),
  findLinesByOrder: vi.fn(),
  findCurrentHolder: vi.fn(),
  findAlternatives: vi.fn(),
  lockUnitsForBooking: vi.fn(),
  validateSalesUser: vi.fn(),
}));

import * as repo from './repository.js';
import * as ledger from '../lib/ledger.js';
import * as ordersService from './service.js';
import type { SmsAccess } from '../lib/access.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import type { SmsUnit } from '@prisma/client';

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockFindById = repo.findById as ReturnType<typeof vi.fn>;
const mockFindOrderBySpk = repo.findOrderBySpk as ReturnType<typeof vi.fn>;
const mockFindOrderWithLine = repo.findOrderWithLine as ReturnType<typeof vi.fn>;
const mockFindLinesByOrder = repo.findLinesByOrder as ReturnType<typeof vi.fn>;
const mockFindCurrentHolder = repo.findCurrentHolder as ReturnType<typeof vi.fn>;
const mockFindAlternatives = repo.findAlternatives as ReturnType<typeof vi.fn>;
const mockLockUnitsForBooking = repo.lockUnitsForBooking as ReturnType<typeof vi.fn>;
const mockValidateSalesUser = repo.validateSalesUser as ReturnType<typeof vi.fn>;
const mockRecordUnitEvent = ledger.recordUnitEvent as ReturnType<typeof vi.fn>;

// ── Access helpers ────────────────────────────────────────────────────────────

function makeAccess(opts: {
  global?: string[];
  byLocation?: Record<string, string[]>;
}): SmsAccess {
  const byLocation = new Map<string, ReadonlySet<string>>();
  for (const [loc, perms] of Object.entries(opts.byLocation ?? {})) {
    byLocation.set(loc, new Set(perms));
  }
  return {
    userId: 'user-1',
    global: new Set(opts.global ?? []),
    byLocation,
  };
}

const SHOWROOM_A = '00000000-0000-4000-8000-000000000001';
const SHOWROOM_B = '00000000-0000-4000-8000-000000000002';
const SALES_USER_ID = '00000000-0000-4000-8000-000000000010';
const ACTOR = { userId: 'user-1' };

// ── Shared base objects ───────────────────────────────────────────────────────

const baseUnit: SmsUnit = {
  id: '00000000-0000-4000-8000-000000000020',
  vin: 'MHWTEST00001',
  status: 'AVAILABLE',
  variantId: '00000000-0000-4000-8000-000000000030',
  physicalLocationId: SHOWROOM_A,
  responsibleShowroomId: SHOWROOM_A,
  activeOrderLineId: null,
  openRtoContractId: null,
  openReturnRequestId: null,
  openShowLoanId: null,
  shipmentId: null,
  engineNumber: null,
  licensePlate: null,
  wasRto: false,
  isOpeningBalance: false,
  notes: null,
  receivedAt: null,
  createdByUserId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseOrder = {
  id: '00000000-0000-4000-8000-000000000050',
  showroomId: SHOWROOM_A,
  spkNumber: 'SPK-001',
  salesUserId: SALES_USER_ID,
  customerName: 'Budi Santoso',
  customerPhone: null,
  customerIdNumber: null,
  notes: null,
  isOpeningBalance: false,
  createdByUserId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseLine = {
  id: '00000000-0000-4000-8000-000000000060',
  orderId: baseOrder.id,
  unitId: baseUnit.id,
  status: 'BOOKED' as const,
  bookedAt: new Date(),
  cancelledAt: null,
  cancelReason: null,
  soldAt: null,
  pickedUpAt: null,
  receiverName: null,
  handoverReference: null,
  followUpAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getOrder ──────────────────────────────────────────────────────────────────

describe('getOrder', () => {
  it('throws SMS_ORDER_NOT_FOUND when repo returns null', async () => {
    mockFindById.mockResolvedValue(null);
    const access = makeAccess({ byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] } });

    await expect(ordersService.getOrder('no-such-id', access)).rejects.toMatchObject({
      statusCode: 404,
      code: 'SMS_ORDER_NOT_FOUND',
    });
  });

  it('throws SMS_ORDER_NOT_FOUND when user lacks STOCK_VIEW at the showroom', async () => {
    mockFindById.mockResolvedValue({
      ...baseOrder,
      showroom: { id: SHOWROOM_A, code: 'SA', name: 'Showroom A' },
      sales: { id: SALES_USER_ID, name: 'Ali' },
      createdBy: { id: 'user-1', name: 'User 1' },
      lines: [],
      summary: { total: 0, booked: 0, sold: 0, pickedUp: 0, cancelled: 0 },
    });
    // User only holds STOCK_VIEW at SHOWROOM_B — not A.
    const access = makeAccess({ byLocation: { [SHOWROOM_B]: [SMS_PERMISSIONS.STOCK_VIEW] } });

    await expect(ordersService.getOrder(baseOrder.id, access)).rejects.toMatchObject({
      statusCode: 404,
      code: 'SMS_ORDER_NOT_FOUND',
    });
  });

  it('masks customerIdNumber when caller lacks CUSTOMERS_VIEW', async () => {
    mockFindById.mockResolvedValue({
      ...baseOrder,
      customerIdNumber: '1234567890123456',
      showroom: { id: SHOWROOM_A, code: 'SA', name: 'Showroom A' },
      sales: { id: SALES_USER_ID, name: 'Ali' },
      createdBy: { id: 'user-1', name: 'User 1' },
      lines: [],
      summary: { total: 0, booked: 0, sold: 0, pickedUp: 0, cancelled: 0 },
    });
    // Has STOCK_VIEW but NOT CUSTOMERS_VIEW.
    const access = makeAccess({ byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] } });

    const result = await ordersService.getOrder(baseOrder.id, access);
    expect(result.customerIdNumber).toBeNull();
    expect(result.customerIdNumberMasked).toBe(true);
  });

  it('exposes customerIdNumber when caller holds CUSTOMERS_VIEW', async () => {
    mockFindById.mockResolvedValue({
      ...baseOrder,
      customerIdNumber: '1234567890123456',
      showroom: { id: SHOWROOM_A, code: 'SA', name: 'Showroom A' },
      sales: { id: SALES_USER_ID, name: 'Ali' },
      createdBy: { id: 'user-1', name: 'User 1' },
      lines: [],
      summary: { total: 0, booked: 0, sold: 0, pickedUp: 0, cancelled: 0 },
    });
    const access = makeAccess({
      byLocation: {
        [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW, SMS_PERMISSIONS.CUSTOMERS_VIEW],
      },
    });

    const result = await ordersService.getOrder(baseOrder.id, access);
    expect(result.customerIdNumber).toBe('1234567890123456');
    expect(result.customerIdNumberMasked).toBe(false);
  });
});

// ── createOrder ───────────────────────────────────────────────────────────────

describe('createOrder', () => {
  const access = makeAccess({
    byLocation: {
      [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW],
    },
  });

  const baseInput = {
    showroomId: SHOWROOM_A,
    spkNumber: 'SPK-001',
    salesUserId: SALES_USER_ID,
    customerName: 'Budi Santoso',
    unitIds: [baseUnit.id],
  };

  it('throws 403 when caller lacks ORDERS_MANAGE at the showroom', async () => {
    const noManage = makeAccess({
      byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] },
    });
    await expect(
      ordersService.createOrder('key-1', baseInput, noManage, ACTOR),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws SMS_SALES_USER_NOT_FOUND when sales user is inactive', async () => {
    mockValidateSalesUser.mockResolvedValue(false);
    await expect(
      ordersService.createOrder('key-1', baseInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 422, code: 'SMS_SALES_USER_NOT_FOUND' });
  });

  it('throws SMS_SPK_ALREADY_EXISTS (with orderId) when SPK already exists', async () => {
    mockValidateSalesUser.mockResolvedValue(true);
    mockFindOrderBySpk.mockResolvedValue({ id: 'existing-order-id', showroomId: SHOWROOM_A });

    await expect(
      ordersService.createOrder('key-1', baseInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_SPK_ALREADY_EXISTS' });
  });

  it('throws SMS_SPK_ALREADY_EXISTS without orderId when caller lacks STOCK_VIEW', async () => {
    // Has ORDERS_MANAGE but not STOCK_VIEW.
    const manageOnly = makeAccess({
      byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE] },
    });
    mockValidateSalesUser.mockResolvedValue(true);
    mockFindOrderBySpk.mockResolvedValue({ id: 'existing-order-id', showroomId: SHOWROOM_A });

    const error = await ordersService.createOrder('key-1', baseInput, manageOnly, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 409, code: 'SMS_SPK_ALREADY_EXISTS' });
    // The details array should be empty since caller can't see STOCK_VIEW.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).details).toEqual([]);
  });

  it('throws SMS_BOOKING_CONFLICT (409) with per-VIN details when a unit is already booked', async () => {
    mockValidateSalesUser.mockResolvedValue(true);
    mockFindOrderBySpk.mockResolvedValue(null);

    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUnique = prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue(null); // SPK check inside tx
    (prisma.smsOrder.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tmp-order-id', spkNumber: 'SPK-001', showroomId: SHOWROOM_A,
    });

    const bookedUnit: SmsUnit = {
      ...baseUnit,
      status: 'BOOKED',
      activeOrderLineId: '00000000-0000-4000-8000-000000000099',
    };
    const unitsMap = new Map([[baseUnit.id, bookedUnit]]);
    mockLockUnitsForBooking.mockResolvedValue(unitsMap);
    mockFindCurrentHolder.mockResolvedValue({ spkNumber: 'SPK-OLD', salesName: 'Ali Baba' });
    mockFindAlternatives.mockResolvedValue([]);

    const err = await ordersService
      .createOrder('key-1', baseInput, access, ACTOR)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 409, code: 'SMS_BOOKING_CONFLICT' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details = (err as any).details as Array<Record<string, unknown>>;
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      unitId: baseUnit.id,
      vin: baseUnit.vin,
      reason: 'ALREADY_BOOKED',
      currentHolder: { spkNumber: 'SPK-OLD', salesName: 'Ali Baba' },
    });
  });

  it('throws SMS_BOOKING_CONFLICT when unit is not at the showroom', async () => {
    // Grant ORDERS_MANAGE at BOTH showrooms so the caller can see SHOWROOM_B
    // stock. When the unit is at SHOWROOM_B but the SPK is for SHOWROOM_A, the
    // service must return NOT_AT_SHOWROOM (not NOT_FOUND, which would only be
    // returned when the caller lacks permission at the unit's location).
    const crossAccess = makeAccess({
      byLocation: {
        [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW],
        [SHOWROOM_B]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW],
      },
    });

    mockValidateSalesUser.mockResolvedValue(true);
    mockFindOrderBySpk.mockResolvedValue(null);

    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUnique = prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue(null);
    (prisma.smsOrder.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tmp-order-id', spkNumber: 'SPK-001', showroomId: SHOWROOM_A,
    });

    // Unit is AVAILABLE but at SHOWROOM_B.
    const wrongLocation: SmsUnit = { ...baseUnit, physicalLocationId: SHOWROOM_B };
    mockLockUnitsForBooking.mockResolvedValue(new Map([[baseUnit.id, wrongLocation]]));
    mockFindAlternatives.mockResolvedValue([]);

    const err = await ordersService
      .createOrder('key-1', baseInput, crossAccess, ACTOR)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 409, code: 'SMS_BOOKING_CONFLICT' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((err as any).details[0]).toMatchObject({ reason: 'NOT_AT_SHOWROOM' });
  });

  it('throws SMS_BOOKING_CONFLICT when unit ID is not found', async () => {
    mockValidateSalesUser.mockResolvedValue(true);
    mockFindOrderBySpk.mockResolvedValue(null);

    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUnique = prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue(null);
    (prisma.smsOrder.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tmp-order-id', spkNumber: 'SPK-001', showroomId: SHOWROOM_A,
    });

    // Return null → unit not found.
    mockLockUnitsForBooking.mockResolvedValue(new Map([[baseUnit.id, null]]));

    const err = await ordersService
      .createOrder('key-1', baseInput, access, ACTOR)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 409, code: 'SMS_BOOKING_CONFLICT' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((err as any).details[0]).toMatchObject({ reason: 'NOT_FOUND' });
  });

  it('creates order and records BOOKING_CREATED when unit is available at the showroom', async () => {
    mockValidateSalesUser.mockResolvedValue(true);
    mockFindOrderBySpk.mockResolvedValue(null);

    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUnique = prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>;
    const mockCreate = prisma.smsOrder.create as ReturnType<typeof vi.fn>;
    const mockLineCreate = prisma.smsOrderLine.create as ReturnType<typeof vi.fn>;

    mockFindUnique.mockResolvedValue(null); // no duplicate SPK inside tx
    mockCreate.mockResolvedValue({ id: 'new-order-id', spkNumber: 'SPK-001', showroomId: SHOWROOM_A });
    mockLineCreate.mockResolvedValue({ id: 'new-line-id' });

    mockLockUnitsForBooking.mockResolvedValue(new Map([[baseUnit.id, baseUnit]]));
    mockRecordUnitEvent.mockResolvedValue({ unit: baseUnit, event: { id: 'evt-1' } });

    const result = await ordersService.createOrder('key-1', baseInput, access, ACTOR);
    expect(result.body).toMatchObject({ orderId: 'new-order-id', bookedCount: 1 });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      baseUnit,
      expect.objectContaining({ event: { type: 'BOOKING_CREATED' } }),
    );
  });
});

// ── cancelLine ────────────────────────────────────────────────────────────────

describe('cancelLine', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  it('throws SMS_ORDER_NOT_FOUND when order does not exist', async () => {
    mockFindOrderWithLine.mockResolvedValue({ order: null, line: null });
    await expect(
      ordersService.cancelLine('no-order', 'no-line', 'key', { reason: 'mistake' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_NOT_FOUND' });
  });

  it('throws SMS_ORDER_NOT_FOUND when user cannot see the order', async () => {
    // Order is at SHOWROOM_B; user only has access to SHOWROOM_A.
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_B },
      line: baseLine,
    });
    await expect(
      ordersService.cancelLine(baseOrder.id, baseLine.id, 'key', { reason: 'mistake' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_NOT_FOUND' });
  });

  it('throws SMS_ORDER_LINE_NOT_FOUND when line does not exist', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: null,
    });
    await expect(
      ordersService.cancelLine(baseOrder.id, 'no-line', 'key', { reason: 'mistake' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_LINE_NOT_FOUND' });
  });

  it('returns alreadyDone:true when line is already CANCELLED', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'CANCELLED' },
    });

    const result = await ordersService.cancelLine(
      baseOrder.id, baseLine.id, 'key', { reason: 'duplicate' }, access, ACTOR,
    );
    expect(result.body).toMatchObject({ alreadyDone: true, status: 'CANCELLED' });
  });

  it('throws SMS_LINE_NOT_CANCELLABLE when line is SOLD (not BOOKED)', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'SOLD' },
    });

    await expect(
      ordersService.cancelLine(baseOrder.id, baseLine.id, 'key', { reason: 'mistake' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_LINE_NOT_CANCELLABLE' });
  });

  it('records BOOKING_CANCELLED and sets activeOrderLineId null on happy path', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'BOOKED' },
    });

    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUniqueOrThrow = prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>;
    // lockSingleUnit uses $queryRaw + smsUnit.findUniqueOrThrow — mock them.
    (prisma as unknown as Record<string, unknown>)['$queryRaw'] = vi.fn().mockResolvedValue([]);
    Object.assign(prisma, {
      smsUnit: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(baseUnit),
        findUnique: mockFindUniqueOrThrow,
        update: vi.fn(),
        findMany: vi.fn(),
      },
    });
    (prisma.smsOrderLine.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // Re-read after lock: line is still BOOKED (happy path, not a concurrent cancel).
    (prisma.smsOrderLine.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'BOOKED' });
    mockRecordUnitEvent.mockResolvedValue({ unit: baseUnit, event: { id: 'evt-cancel' } });

    const result = await ordersService.cancelLine(
      baseOrder.id, baseLine.id, 'key', { reason: 'Customer changed mind' }, access, ACTOR,
    );
    expect(result.body).toMatchObject({ alreadyDone: false, status: 'CANCELLED' });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      baseUnit,
      expect.objectContaining({
        event: { type: 'BOOKING_CANCELLED' },
        unitChanges: { activeOrderLineId: null },
      }),
    );
  });
});

// ── followUp ──────────────────────────────────────────────────────────────────

describe('followUp', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  it('throws SMS_ORDER_NOT_FOUND when order does not exist', async () => {
    mockFindOrderWithLine.mockResolvedValue({ order: null, line: null });
    await expect(
      ordersService.followUp('no-order', 'no-line', { nextFollowUpDate: '2026-12-01' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_NOT_FOUND' });
  });

  it('throws SMS_LINE_NOT_BOOKED when line is SOLD', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'SOLD' },
    });

    await expect(
      ordersService.followUp(
        baseOrder.id, baseLine.id,
        { nextFollowUpDate: '2026-12-01' },
        access, ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_LINE_NOT_BOOKED' });
  });

  it('throws VALIDATION_ERROR when nextFollowUpDate is in the past', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'BOOKED' },
    });

    await expect(
      ordersService.followUp(
        baseOrder.id, baseLine.id,
        { nextFollowUpDate: '2020-01-01' }, // past date
        access, ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR when nextFollowUpDate is more than 30 days ahead', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'BOOKED' },
    });

    // 31 days from now.
    const far = new Date();
    far.setUTCDate(far.getUTCDate() + 31);
    const yyyy = far.getUTCFullYear();
    const mm = String(far.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(far.getUTCDate()).padStart(2, '0');

    await expect(
      ordersService.followUp(
        baseOrder.id, baseLine.id,
        { nextFollowUpDate: `${yyyy}-${mm}-${dd}` },
        access, ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('updates followUpAt and records audit log on happy path', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'BOOKED' },
    });

    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsOrderLine.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    // 2 days from today.
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 2);
    const yyyy = soon.getUTCFullYear();
    const mm = String(soon.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(soon.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const result = await ordersService.followUp(
      baseOrder.id, baseLine.id,
      { nextFollowUpDate: dateStr, note: 'Call again' },
      access, ACTOR,
    );
    expect(result).toMatchObject({ lineId: baseLine.id });
    expect(result.followUpAt).toBeInstanceOf(Date);
  });
});

// ── recordSale ────────────────────────────────────────────────────────────────

describe('recordSale', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  it('throws SMS_ORDER_NOT_FOUND when order does not exist', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      ordersService.recordSale(
        'no-order', 'key',
        { lineIds: [baseLine.id] },
        access, ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_NOT_FOUND' });
  });

  it('throws SMS_ORDER_LINE_NOT_FOUND when a lineId does not belong to the order', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: baseOrder.id,
      showroomId: SHOWROOM_A,
      spkNumber: 'SPK-001',
    });
    // findLinesByOrder returns empty → all lineIds are "missing".
    mockFindLinesByOrder.mockResolvedValue([]);

    await expect(
      ordersService.recordSale(
        baseOrder.id, 'key',
        { lineIds: [baseLine.id] },
        access, ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_LINE_NOT_FOUND' });
  });

  it('throws SMS_LINE_NOT_BOOKABLE_FOR_SALE when a line is CANCELLED', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: baseOrder.id,
      showroomId: SHOWROOM_A,
      spkNumber: 'SPK-001',
    });
    mockFindLinesByOrder.mockResolvedValue([
      { ...baseLine, status: 'CANCELLED', soldAt: null },
    ]);

    await expect(
      ordersService.recordSale(
        baseOrder.id, 'key',
        { lineIds: [baseLine.id] },
        access, ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_LINE_NOT_BOOKABLE_FOR_SALE' });
  });

  it('returns alreadyDone:true when all lines are already SOLD', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: baseOrder.id,
      showroomId: SHOWROOM_A,
      spkNumber: 'SPK-001',
    });
    mockFindLinesByOrder.mockResolvedValue([
      { ...baseLine, status: 'SOLD', soldAt: new Date() },
    ]);

    const result = await ordersService.recordSale(
      baseOrder.id, 'key',
      { lineIds: [baseLine.id] },
      access, ACTOR,
    );
    expect(result.body).toMatchObject({ alreadyDone: true, recordedCount: 0 });
  });

  it('records SALE_RECORDED for each BOOKED line', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: baseOrder.id,
      showroomId: SHOWROOM_A,
      spkNumber: 'SPK-001',
    });
    mockFindLinesByOrder.mockResolvedValue([{ ...baseLine, status: 'BOOKED', soldAt: null }]);

    // lockMultipleUnits path: $queryRaw + smsUnit.findMany.
    Object.assign(prisma, {
      $queryRaw: vi.fn().mockResolvedValue([]),
      smsUnit: {
        ...(prisma.smsUnit as unknown as Record<string, unknown>),
        findMany: vi.fn().mockResolvedValue([baseUnit]),
        findUniqueOrThrow: vi.fn().mockResolvedValue(baseUnit),
      },
    });
    (prisma.smsOrderLine.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    mockRecordUnitEvent.mockResolvedValue({ unit: baseUnit, event: { id: 'evt-sale' } });

    const result = await ordersService.recordSale(
      baseOrder.id, 'key',
      { lineIds: [baseLine.id], soldAt: '2026-11-01' },
      access, ACTOR,
    );
    expect(result.body).toMatchObject({ alreadyDone: false, recordedCount: 1 });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      baseUnit,
      expect.objectContaining({ event: { type: 'SALE_RECORDED' } }),
    );
  });
});

// ── confirmPickup ─────────────────────────────────────────────────────────────

describe('confirmPickup', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.ORDERS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  const pickupInput = {
    receiverName: 'Budi Santoso',
    vinConfirmed: true as const,
  };

  it('throws SMS_ORDER_NOT_FOUND when order does not exist', async () => {
    mockFindOrderWithLine.mockResolvedValue({ order: null, line: null });
    await expect(
      ordersService.confirmPickup('no-order', 'no-line', 'key', pickupInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_ORDER_NOT_FOUND' });
  });

  it('returns alreadyDone:true when line is already PICKED_UP', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'PICKED_UP', pickedUpAt: new Date() },
    });

    const result = await ordersService.confirmPickup(
      baseOrder.id, baseLine.id, 'key', pickupInput, access, ACTOR,
    );
    expect(result.body).toMatchObject({ alreadyDone: true, status: 'PICKED_UP' });
  });

  it('throws SMS_LINE_NOT_SOLD when line is BOOKED (not SOLD)', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'BOOKED' },
    });

    await expect(
      ordersService.confirmPickup(baseOrder.id, baseLine.id, 'key', pickupInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_LINE_NOT_SOLD' });
  });

  it('records PICKUP_CONFIRMED with activeOrderLineId cleared on happy path', async () => {
    mockFindOrderWithLine.mockResolvedValue({
      order: { ...baseOrder, showroomId: SHOWROOM_A },
      line: { ...baseLine, status: 'SOLD', soldAt: new Date() },
    });

    const { prisma } = await import('../../../lib/prisma.js');
    Object.assign(prisma, {
      $queryRaw: vi.fn().mockResolvedValue([]),
      smsUnit: {
        ...(prisma.smsUnit as unknown as Record<string, unknown>),
        findUniqueOrThrow: vi.fn().mockResolvedValue(baseUnit),
      },
    });
    (prisma.smsOrderLine.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    mockRecordUnitEvent.mockResolvedValue({ unit: baseUnit, event: { id: 'evt-pickup' } });

    const result = await ordersService.confirmPickup(
      baseOrder.id, baseLine.id, 'key', pickupInput, access, ACTOR,
    );
    expect(result.body).toMatchObject({ alreadyDone: false, status: 'PICKED_UP' });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      baseUnit,
      expect.objectContaining({
        event: { type: 'PICKUP_CONFIRMED' },
        unitChanges: { activeOrderLineId: null },
      }),
    );
  });
});

// ── Zod schema validation (via service entry points) ─────────────────────────

describe('createOrderSchema validation', () => {
  it('rejects empty unitIds', async () => {
    const { createOrderSchema } = await import('./schema.js');
    const result = createOrderSchema.safeParse({
      showroomId: '00000000-0000-4000-8000-000000000001',
      spkNumber: 'SPK-001',
      salesUserId: '00000000-0000-4000-8000-000000000010',
      customerName: 'Budi',
      unitIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate unitIds', async () => {
    const { createOrderSchema } = await import('./schema.js');
    const id = '00000000-0000-4000-8000-000000000020';
    const result = createOrderSchema.safeParse({
      showroomId: '00000000-0000-4000-8000-000000000001',
      spkNumber: 'SPK-001',
      salesUserId: '00000000-0000-4000-8000-000000000010',
      customerName: 'Budi',
      unitIds: [id, id],
    });
    expect(result.success).toBe(false);
  });

  it('normalises spkNumber: trimmed, collapsed, uppercased', async () => {
    const { createOrderSchema } = await import('./schema.js');
    const result = createOrderSchema.safeParse({
      showroomId: '00000000-0000-4000-8000-000000000001',
      spkNumber: '  spk  001  ',
      salesUserId: '00000000-0000-4000-8000-000000000010',
      customerName: 'Budi',
      unitIds: ['00000000-0000-4000-8000-000000000020'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.spkNumber).toBe('SPK 001');
    }
  });
});

describe('cancelLineSchema validation', () => {
  it('rejects reason shorter than 3 characters', async () => {
    const { cancelLineSchema } = await import('./schema.js');
    expect(cancelLineSchema.safeParse({ reason: 'ab' }).success).toBe(false);
  });
});

describe('confirmPickupSchema validation', () => {
  it('rejects when vinConfirmed is false', async () => {
    const { confirmPickupSchema } = await import('./schema.js');
    expect(
      confirmPickupSchema.safeParse({ receiverName: 'Budi', vinConfirmed: false }).success,
    ).toBe(false);
  });
});
