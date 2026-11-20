/**
 * Unit tests for the SMS RTO contracts service.
 *
 * All external dependencies (Prisma, ledger, idempotency) are mocked; every
 * test exercises service logic only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsRtoContract: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    smsOrderLine: { update: vi.fn() },
    smsInspection: { create: vi.fn() },
    smsUnit: { update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/idempotency.js', async () => {
  const { prisma } = await import('../../../lib/prisma.js');
  return {
    runIdempotent: vi.fn(async (
      _opts: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => ({ statusCode: 200, body: await fn(prisma), replayed: false })),
    requireIdempotencyKey: vi.fn(() => 'test-idempotency-key'),
  };
});

vi.mock('../lib/ledger.js', () => {
  const businessDateString = (moment: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(moment);
  return {
    lockUnit: vi.fn(),
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
  findById: vi.fn(),
  findByIdInTx: vi.fn(),
  findByContractNumber: vi.fn(),
  findMany: vi.fn(),
  validateSalesUser: vi.fn(),
}));

import * as repo from './repository.js';
import * as ledger from '../lib/ledger.js';
import * as rtoService from './service.js';
import type { SmsAccess } from '../lib/access.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import type { SmsUnit } from '@prisma/client';

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockFindByContractNumber = repo.findByContractNumber as ReturnType<typeof vi.fn>;
const mockValidateSalesUser = repo.validateSalesUser as ReturnType<typeof vi.fn>;
const mockLockUnit = ledger.lockUnit as ReturnType<typeof vi.fn>;
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
const CONTRACT_ID = '00000000-0000-4000-8000-000000000011';
const UNIT_ID = '00000000-0000-4000-8000-000000000020';
const SALES_USER_ID = '00000000-0000-4000-8000-000000000010';
const ACTOR = { userId: 'user-1' };

// ── Shared base objects ───────────────────────────────────────────────────────

const baseUnit: SmsUnit = {
  id: UNIT_ID,
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

const baseCreateInput = {
  unitId: UNIT_ID,
  contractNumber: 'RTO-2026-001',
  salesUserId: SALES_USER_ID,
  customerName: 'Budi Santoso',
  customerPhone: '08123456789',
  startDate: '2026-11-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path stubs (overridden per-test as needed).
  mockFindByContractNumber.mockResolvedValue(null); // no duplicate contract number
  mockValidateSalesUser.mockResolvedValue(true);
  mockRecordUnitEvent.mockResolvedValue({
    unit: { ...baseUnit, status: 'ACTIVE_RTO', openRtoContractId: CONTRACT_ID },
    event: { id: 'event-1' },
  });
});

// ── createRtoContract ─────────────────────────────────────────────────────────

describe('createRtoContract', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.RTO_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  it('throws SMS_CONTRACT_NUMBER_EXISTS when contract number already in use', async () => {
    mockFindByContractNumber.mockResolvedValue({ id: 'existing-contract' });

    await expect(
      rtoService.createRtoContract('key', baseCreateInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_CONTRACT_NUMBER_EXISTS' });
  });

  it('throws SMS_INVALID_TRANSITION when unit is not AVAILABLE or BOOKED', async () => {
    mockLockUnit.mockResolvedValue({
      ...baseUnit,
      status: 'IN_MAINTENANCE',
      physicalLocationId: SHOWROOM_A,
    });

    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      rtoService.createRtoContract('key', baseCreateInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_INVALID_TRANSITION' });
  });

  it('throws SMS_RTO_CONTRACT_ALREADY_OPEN when unit already has an open contract', async () => {
    mockLockUnit.mockResolvedValue({
      ...baseUnit,
      status: 'AVAILABLE',
      physicalLocationId: SHOWROOM_A,
      openRtoContractId: 'old-contract-id',
    });

    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      rtoService.createRtoContract('key', baseCreateInput, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_RTO_CONTRACT_ALREADY_OPEN' });
  });

  it('throws 403 when caller lacks RTO_MANAGE at the unit location', async () => {
    const noRtoAccess = makeAccess({
      byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] }, // no RTO_MANAGE
    });

    mockLockUnit.mockResolvedValue({
      ...baseUnit,
      status: 'AVAILABLE',
      physicalLocationId: SHOWROOM_A,
    });

    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      rtoService.createRtoContract('key', baseCreateInput, noRtoAccess, ACTOR),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('creates contract and records RTO_STARTED event on happy path (AVAILABLE unit)', async () => {
    mockLockUnit.mockResolvedValue({
      ...baseUnit,
      status: 'AVAILABLE',
      physicalLocationId: SHOWROOM_A,
      openRtoContractId: null,
    });

    const { prisma } = await import('../../../lib/prisma.js');
    // No duplicate in tx.
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.smsRtoContract.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: CONTRACT_ID,
      contractNumber: 'RTO-2026-001',
    });

    const result = await rtoService.createRtoContract('key', baseCreateInput, access, ACTOR);

    expect(result.body).toMatchObject({ contractId: CONTRACT_ID });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'AVAILABLE' }),
      expect.objectContaining({ event: { type: 'RTO_STARTED' } }),
    );
  });
});

// ── returnRtoContract ─────────────────────────────────────────────────────────

describe('returnRtoContract', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.RTO_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  const activeUnit: SmsUnit = {
    ...baseUnit,
    status: 'ACTIVE_RTO',
    openRtoContractId: CONTRACT_ID,
  };

  it('returns alreadyDone:true when contract already has returnedAt set', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: new Date() }) // preliminary
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: new Date(), returnKind: 'RETURNED_BY_CUSTOMER' }); // re-read

    mockLockUnit.mockResolvedValue(activeUnit);

    const result = await rtoService.returnRtoContract(
      CONTRACT_ID, 'key',
      { returnKind: 'RETURNED_BY_CUSTOMER', condition: 'GOOD' },
      access, ACTOR,
    );

    expect(result.body).toMatchObject({ alreadyDone: true });
  });

  it('throws SMS_RTO_CONTRACT_NOT_FOUND when contract does not exist', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      rtoService.returnRtoContract(CONTRACT_ID, 'key', { returnKind: 'RETURNED_BY_CUSTOMER', condition: 'GOOD' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_RTO_CONTRACT_NOT_FOUND' });
  });

  it('throws SMS_INVALID_TRANSITION when unit is not ACTIVE_RTO', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null, returnKind: null });

    mockLockUnit.mockResolvedValue({ ...baseUnit, status: 'INSPECTION', openRtoContractId: CONTRACT_ID });

    await expect(
      rtoService.returnRtoContract(CONTRACT_ID, 'key', { returnKind: 'RETURNED_BY_CUSTOMER', condition: 'GOOD' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_INVALID_TRANSITION' });
  });

  it('throws SMS_RTO_CONTRACT_NOT_OPEN when this is not the unit open contract', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null, returnKind: null });

    mockLockUnit.mockResolvedValue({
      ...baseUnit,
      status: 'ACTIVE_RTO',
      openRtoContractId: 'different-contract', // different contract open
    });

    await expect(
      rtoService.returnRtoContract(CONTRACT_ID, 'key', { returnKind: 'RETURNED_BY_CUSTOMER', condition: 'GOOD' }, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_RTO_CONTRACT_NOT_OPEN' });
  });

  it('creates inspection and records RTO_RETURNED event on happy path', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null, returnKind: null });
    (prisma.smsRtoContract.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.smsInspection.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'insp-1' });

    mockLockUnit.mockResolvedValue(activeUnit);

    const result = await rtoService.returnRtoContract(
      CONTRACT_ID, 'key',
      { returnKind: 'RETURNED_BY_CUSTOMER', condition: 'GOOD' },
      access, ACTOR,
    );

    expect(result.body).toMatchObject({ alreadyDone: false, inspectionId: 'insp-1' });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: UNIT_ID }),
      expect.objectContaining({ event: { type: 'RTO_RETURNED', locationId: SHOWROOM_A } }),
    );
  });
});

// ── closeRtoContract ──────────────────────────────────────────────────────────

describe('closeRtoContract', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.RTO_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  const returnedUnit: SmsUnit = {
    ...baseUnit,
    status: 'INSPECTION',
    openRtoContractId: CONTRACT_ID,
  };

  it('returns alreadyDone:true when contract already closed', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: new Date() })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: new Date(), returnedAt: new Date(), receivedAtShowroomId: null, returnKind: 'RETURNED_BY_CUSTOMER' });

    mockLockUnit.mockResolvedValue(returnedUnit);

    const result = await rtoService.closeRtoContract(CONTRACT_ID, 'key', {}, access, ACTOR);

    expect(result.body).toMatchObject({ alreadyDone: true });
  });

  it('throws SMS_CONTRACT_NOT_RETURNED when motorcycle not yet back', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null })
      .mockResolvedValueOnce({
        id: CONTRACT_ID,
        unitId: UNIT_ID,
        closedAt: null,
        returnedAt: null,          // not returned
        receivedAtShowroomId: null, // not received via cross-branch
        returnKind: null,
      });

    mockLockUnit.mockResolvedValue(returnedUnit);

    await expect(
      rtoService.closeRtoContract(CONTRACT_ID, 'key', {}, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_CONTRACT_NOT_RETURNED' });
  });

  it('closes with outcome RETURNED when returnKind is RETURNED_BY_CUSTOMER', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null })
      .mockResolvedValueOnce({
        id: CONTRACT_ID,
        unitId: UNIT_ID,
        closedAt: null,
        returnedAt: new Date(),
        receivedAtShowroomId: null,
        returnKind: 'RETURNED_BY_CUSTOMER',
      });
    (prisma.smsRtoContract.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.smsUnit.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    mockLockUnit.mockResolvedValue(returnedUnit);

    const result = await rtoService.closeRtoContract(CONTRACT_ID, 'key', {}, access, ACTOR);

    expect(result.body).toMatchObject({ alreadyDone: false, outcome: 'RETURNED' });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ event: { type: 'RTO_CONTRACT_CLOSED' } }),
    );
  });

  it('closes with outcome REPOSSESSED when returnKind is REPOSSESSED', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null })
      .mockResolvedValueOnce({
        id: CONTRACT_ID,
        unitId: UNIT_ID,
        closedAt: null,
        returnedAt: new Date(),
        receivedAtShowroomId: null,
        returnKind: 'REPOSSESSED',
      });
    (prisma.smsRtoContract.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.smsUnit.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    mockLockUnit.mockResolvedValue(returnedUnit);

    const result = await rtoService.closeRtoContract(CONTRACT_ID, 'key', {}, access, ACTOR);

    expect(result.body).toMatchObject({ alreadyDone: false, outcome: 'REPOSSESSED' });
  });
});

// ── transferOwnership ─────────────────────────────────────────────────────────

describe('transferOwnership', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.RTO_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  const activeUnit: SmsUnit = {
    ...baseUnit,
    status: 'ACTIVE_RTO',
    openRtoContractId: CONTRACT_ID,
  };

  it('returns alreadyDone:true when contract already closed', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: new Date(), returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: new Date(), returnedAt: null });

    mockLockUnit.mockResolvedValue(activeUnit);

    const result = await rtoService.transferOwnership(CONTRACT_ID, 'key', {}, access, ACTOR);

    expect(result.body).toMatchObject({ alreadyDone: true });
  });

  it('throws SMS_INVALID_TRANSITION when unit is not ACTIVE_RTO', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null });

    mockLockUnit.mockResolvedValue({ ...baseUnit, status: 'INSPECTION', openRtoContractId: CONTRACT_ID });

    await expect(
      rtoService.transferOwnership(CONTRACT_ID, 'key', {}, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_INVALID_TRANSITION' });
  });

  it('throws SMS_CONTRACT_ALREADY_RETURNED when motorcycle already returned', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: new Date() });

    mockLockUnit.mockResolvedValue(activeUnit);

    await expect(
      rtoService.transferOwnership(CONTRACT_ID, 'key', {}, access, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SMS_CONTRACT_ALREADY_RETURNED' });
  });

  it('closes contract and records RTO_OWNERSHIP_TRANSFERRED event on happy path', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsRtoContract.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null })
      .mockResolvedValueOnce({ id: CONTRACT_ID, unitId: UNIT_ID, closedAt: null, returnedAt: null });
    (prisma.smsRtoContract.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    mockLockUnit.mockResolvedValue(activeUnit);

    const result = await rtoService.transferOwnership(CONTRACT_ID, 'key', {}, access, ACTOR);

    expect(result.body).toMatchObject({
      alreadyDone: false,
      outcome: 'OWNERSHIP_TRANSFERRED',
    });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: UNIT_ID }),
      expect.objectContaining({ event: { type: 'RTO_OWNERSHIP_TRANSFERRED' } }),
    );
  });
});
