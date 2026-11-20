import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsUnit: { findUnique: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    smsInspection: { findFirst: vi.fn(), create: vi.fn() },
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
    ) => ({ statusCode: 200, body: await fn(prisma), replayed: false })),
    requireIdempotencyKey: vi.fn(() => 'test-idempotency-key'),
  };
});

vi.mock('../lib/ledger.js', () => ({
  lockUnits: vi.fn(),
  recordUnitEvent: vi.fn(),
  resolveEventDate: vi.fn(() => new Date('2024-01-15')),
}));

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  findMany: vi.fn(),
  findById: vi.fn(),
  findRawById: vi.fn(),
  searchUnits: vi.fn(),
  searchExpectedVins: vi.fn(),
  buildSearchResults: vi.fn(),
  rankSearchResult: vi.fn(),
}));

import * as repo from './repository.js';
import * as ledger from '../lib/ledger.js';
import * as unitsService from './service.js';
import { computeAvailableActions } from './actions.js';
import { unitViewWhere } from './views.js';
import type { SmsAccess } from '../lib/access.js';
import type { UnitForActions } from './actions.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import type { SmsUnitStatus } from '@prisma/client';

const mockFindById = repo.findById as ReturnType<typeof vi.fn>;
const mockFindRawById = repo.findRawById as ReturnType<typeof vi.fn>;
const mockLockUnits = ledger.lockUnits as ReturnType<typeof vi.fn>;
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

const SHOWROOM_A = 'showroom-a';
const SHOWROOM_B = 'showroom-b';

const baseUnit = {
  id: 'unit-1',
  vin: 'VIN123',
  engineNumber: null,
  licensePlate: null,
  status: 'INSPECTION' as SmsUnitStatus,
  wasRto: false,
  isOpeningBalance: false,
  notes: null,
  receivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  variant: {
    id: 'variant-1',
    name: 'Beat',
    batteryVariant: null,
    color: 'Black',
    model: { id: 'model-1', code: 'BEAT', name: 'Honda Beat' },
  },
  physicalLocation: { id: SHOWROOM_A, code: 'SA', name: 'Showroom A' },
  responsibleShowroom: { id: SHOWROOM_A, code: 'SA', name: 'Showroom A' },
  shipment: null,
  inspections: [],
  timeline: [],
  availableActions: [],
  releaseBlockers: [],
};

const baseRaw = {
  id: 'unit-1',
  vin: 'VIN123',
  status: 'INSPECTION' as SmsUnitStatus,
  physicalLocationId: SHOWROOM_A,
  responsibleShowroomId: SHOWROOM_A,
  activeOrderLineId: null,
  openRtoContractId: null,
  openReturnRequestId: null,
  engineNumber: null,
  licensePlate: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── unitViewWhere ─────────────────────────────────────────────────────────────

describe('unitViewWhere', () => {
  const SID = 'showroom-id';

  it('physical: physicalLocationId = showroom', () => {
    expect(unitViewWhere('physical', SID)).toEqual({ physicalLocationId: SID });
  });

  it('ready: physicalLocationId = showroom AND status = AVAILABLE', () => {
    expect(unitViewWhere('ready', SID)).toEqual({
      physicalLocationId: SID,
      status: 'AVAILABLE',
    });
  });

  it('booked: physicalLocationId = showroom AND status = BOOKED', () => {
    expect(unitViewWhere('booked', SID)).toEqual({
      physicalLocationId: SID,
      status: 'BOOKED',
    });
  });

  it('sold_pending_pickup: physicalLocationId = showroom AND status = SOLD_PENDING_PICKUP', () => {
    expect(unitViewWhere('sold_pending_pickup', SID)).toEqual({
      physicalLocationId: SID,
      status: 'SOLD_PENDING_PICKUP',
    });
  });

  it('inspection: physicalLocationId = showroom AND status = INSPECTION', () => {
    expect(unitViewWhere('inspection', SID)).toEqual({
      physicalLocationId: SID,
      status: 'INSPECTION',
    });
  });

  it('custody: physicalLocationId = showroom AND status = CUSTODY', () => {
    expect(unitViewWhere('custody', SID)).toEqual({
      physicalLocationId: SID,
      status: 'CUSTODY',
    });
  });

  it('identity_mismatch: physicalLocationId = showroom AND status = IDENTITY_MISMATCH', () => {
    expect(unitViewWhere('identity_mismatch', SID)).toEqual({
      physicalLocationId: SID,
      status: 'IDENTITY_MISMATCH',
    });
  });

  it('outside: responsibleShowroomId = showroom AND physicalLocationId null AND status in SHOW_UNIT/ACTIVE_RTO', () => {
    expect(unitViewWhere('outside', SID)).toEqual({
      responsibleShowroomId: SID,
      physicalLocationId: null,
      status: { in: ['SHOW_UNIT', 'ACTIVE_RTO'] },
    });
  });

  it('all: physicalLocationId = showroom OR responsibleShowroomId = showroom', () => {
    expect(unitViewWhere('all', SID)).toEqual({
      OR: [{ physicalLocationId: SID }, { responsibleShowroomId: SID }],
    });
  });
});

// ── computeAvailableActions ───────────────────────────────────────────────────

describe('computeAvailableActions', () => {
  const baseUnitForActions: UnitForActions = {
    status: 'INSPECTION',
    physicalLocationId: SHOWROOM_A,
    responsibleShowroomId: SHOWROOM_A,
    activeOrderLineId: null,
    openRtoContractId: null,
    openReturnRequestId: null,
    openShowLoanId: null,
  };

  it('RELEASE available when INSPECTION, INSPECTIONS_MANAGE, no commitments, latest passed', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const result = computeAvailableActions({
      unit: baseUnitForActions,
      latestInspection: { result: 'PASSED' },
      permissionsAtRelevantLocation: perms,
    });
    expect(result.availableActions).toContain('RELEASE');
    expect(result.releaseBlockers).toHaveLength(0);
  });

  it('RELEASE blocked when latest inspection is FAILED', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { availableActions, releaseBlockers } = computeAvailableActions({
      unit: baseUnitForActions,
      latestInspection: { result: 'FAILED' },
      permissionsAtRelevantLocation: perms,
    });
    expect(availableActions).not.toContain('RELEASE');
    expect(releaseBlockers).toContain('Latest inspection has not passed');
  });

  it('RELEASE blocked when latest inspection is PENDING', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { releaseBlockers } = computeAvailableActions({
      unit: baseUnitForActions,
      latestInspection: { result: 'PENDING' },
      permissionsAtRelevantLocation: perms,
    });
    expect(releaseBlockers).toContain('Latest inspection has not passed');
  });

  it('RELEASE blocked when no inspection at all', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { releaseBlockers } = computeAvailableActions({
      unit: baseUnitForActions,
      latestInspection: null,
      permissionsAtRelevantLocation: perms,
    });
    expect(releaseBlockers).toContain('No inspection has been recorded yet');
  });

  it('RELEASE blocked by activeOrderLineId', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { releaseBlockers } = computeAvailableActions({
      unit: { ...baseUnitForActions, activeOrderLineId: 'order-line-1' },
      latestInspection: { result: 'PASSED' },
      permissionsAtRelevantLocation: perms,
    });
    expect(releaseBlockers).toContain('Active order line is still open');
  });

  it('RELEASE blocked by openRtoContractId', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { releaseBlockers } = computeAvailableActions({
      unit: { ...baseUnitForActions, openRtoContractId: 'rto-contract-1' },
      latestInspection: { result: 'PASSED' },
      permissionsAtRelevantLocation: perms,
    });
    expect(releaseBlockers).toContain('RTO contract is still open');
  });

  it('RELEASE blocked by openReturnRequestId', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { releaseBlockers } = computeAvailableActions({
      unit: { ...baseUnitForActions, openReturnRequestId: 'return-request-1' },
      latestInspection: { result: 'PASSED' },
      permissionsAtRelevantLocation: perms,
    });
    expect(releaseBlockers).toContain('Return request is still open');
  });

  it('RELEASE not in actions when missing INSPECTIONS_MANAGE even with no blockers', () => {
    const perms = new Set<string>([]);
    const { availableActions } = computeAvailableActions({
      unit: baseUnitForActions,
      latestInspection: { result: 'PASSED' },
      permissionsAtRelevantLocation: perms,
    });
    expect(availableActions).not.toContain('RELEASE');
  });

  it('RESOLVE_IDENTITY available when status is IDENTITY_MISMATCH and RECEIVING_MANAGE', () => {
    const perms = new Set([SMS_PERMISSIONS.RECEIVING_MANAGE]);
    const { availableActions } = computeAvailableActions({
      unit: { ...baseUnitForActions, status: 'IDENTITY_MISMATCH' },
      latestInspection: null,
      permissionsAtRelevantLocation: perms,
    });
    expect(availableActions).toContain('RESOLVE_IDENTITY');
  });

  it('RECORD_INSPECTION available when status is INSPECTION and INSPECTIONS_MANAGE', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { availableActions } = computeAvailableActions({
      unit: baseUnitForActions,
      latestInspection: { result: 'PENDING' },
      permissionsAtRelevantLocation: perms,
    });
    expect(availableActions).toContain('RECORD_INSPECTION');
  });

  it('releaseBlockers is empty when status is not INSPECTION', () => {
    const perms = new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE]);
    const { releaseBlockers } = computeAvailableActions({
      unit: { ...baseUnitForActions, status: 'AVAILABLE' },
      latestInspection: null,
      permissionsAtRelevantLocation: perms,
    });
    expect(releaseBlockers).toHaveLength(0);
  });
});

// ── getUnit — authorization ───────────────────────────────────────────────────

describe('getUnit — 404 when user lacks STOCK_VIEW at both locations', () => {
  it('returns 404 when user holds STOCK_VIEW only at SHOWROOM_B', async () => {
    const access = makeAccess({
      byLocation: { [SHOWROOM_B]: [SMS_PERMISSIONS.STOCK_VIEW] },
    });

    // Unit is at SHOWROOM_A.
    mockFindById.mockResolvedValue(baseUnit);
    mockFindRawById.mockResolvedValue(baseRaw);

    await expect(unitsService.getUnit('unit-1', access)).rejects.toMatchObject({
      statusCode: 404,
      code: 'SMS_UNIT_NOT_FOUND',
    });
  });

  it('returns unit when user holds STOCK_VIEW at physicalLocationId', async () => {
    const access = makeAccess({
      byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] },
    });
    mockFindById.mockResolvedValue(baseUnit);
    mockFindRawById.mockResolvedValue(baseRaw);

    const result = await unitsService.getUnit('unit-1', access);
    expect(result.id).toBe('unit-1');
  });
});

// ── releaseUnit ──────────────────────────────────────────────────────────────

describe('releaseUnit', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.INSPECTIONS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  const unitInInspection = {
    ...baseRaw,
    status: 'INSPECTION' as SmsUnitStatus,
    activeOrderLineId: null,
    openRtoContractId: null,
    openReturnRequestId: null,
  };

  it('records UNIT_RELEASED when all checks pass', async () => {
    mockLockUnits.mockResolvedValue([unitInInspection]);
    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindFirstInspection = prisma.smsInspection.findFirst as ReturnType<typeof vi.fn>;
    mockFindFirstInspection.mockResolvedValue({ id: 'insp-1', result: 'PASSED' });
    mockRecordUnitEvent.mockResolvedValue({
      unit: { ...unitInInspection, status: 'AVAILABLE' },
      event: { id: 'event-1' },
    });

    const result = await unitsService.releaseUnit(
      'unit-1',
      'idem-key',
      {},
      access,
      { userId: 'user-1' },
    );
    expect(result.body).toMatchObject({ unitId: 'unit-1', statusAfter: 'AVAILABLE' });
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      expect.anything(),
      unitInInspection,
      expect.objectContaining({ event: { type: 'UNIT_RELEASED' } }),
    );
  });

  it('throws 409 when activeOrderLineId is set', async () => {
    mockLockUnits.mockResolvedValue([
      { ...unitInInspection, activeOrderLineId: 'order-line-1' },
    ]);

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, access, { userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'SMS_UNIT_HAS_OPEN_COMMITMENT', statusCode: 409 });
  });

  it('throws 409 when openRtoContractId is set', async () => {
    mockLockUnits.mockResolvedValue([
      { ...unitInInspection, openRtoContractId: 'rto-contract-1' },
    ]);

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, access, { userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'SMS_UNIT_HAS_OPEN_COMMITMENT', statusCode: 409 });
  });

  it('throws 409 when openReturnRequestId is set', async () => {
    mockLockUnits.mockResolvedValue([
      { ...unitInInspection, openReturnRequestId: 'return-req-1' },
    ]);

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, access, { userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'SMS_UNIT_HAS_OPEN_COMMITMENT', statusCode: 409 });
  });

  it('throws SMS_INSPECTION_NOT_PASSED when latest inspection result is not PASSED', async () => {
    mockLockUnits.mockResolvedValue([unitInInspection]);
    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindFirstInspection = prisma.smsInspection.findFirst as ReturnType<typeof vi.fn>;
    mockFindFirstInspection.mockResolvedValue({ id: 'insp-1', result: 'FAILED' });

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, access, { userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'SMS_INSPECTION_NOT_PASSED', statusCode: 409 });
  });

  it('throws SMS_INSPECTION_NOT_PASSED when no inspection exists', async () => {
    mockLockUnits.mockResolvedValue([unitInInspection]);
    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindFirstInspection = prisma.smsInspection.findFirst as ReturnType<typeof vi.fn>;
    mockFindFirstInspection.mockResolvedValue(null);

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, access, { userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'SMS_INSPECTION_NOT_PASSED', statusCode: 409 });
  });

  it('answers 404 when the caller cannot see the unit (rights at another showroom only)', async () => {
    const elsewhere = makeAccess({
      byLocation: {
        [SHOWROOM_B]: [SMS_PERMISSIONS.INSPECTIONS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW],
      },
    });
    mockLockUnits.mockResolvedValue([unitInInspection]);

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, elsewhere, { userId: 'user-1' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_UNIT_NOT_FOUND' });
  });

  it('answers 403 when the caller can see the unit but may not release it there', async () => {
    const viewer = makeAccess({ byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] } });
    mockLockUnits.mockResolvedValue([unitInInspection]);

    await expect(
      unitsService.releaseUnit('unit-1', 'idem-key', {}, viewer, { userId: 'user-1' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ── resolveIdentity ───────────────────────────────────────────────────────────

describe('resolveIdentity', () => {
  const access = makeAccess({
    byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.RECEIVING_MANAGE, SMS_PERMISSIONS.STOCK_VIEW] },
  });

  const unitInMismatch = {
    ...baseRaw,
    status: 'IDENTITY_MISMATCH' as SmsUnitStatus,
  };

  it('throws SMS_INVALID_TRANSITION when unit is not IDENTITY_MISMATCH', async () => {
    mockLockUnits.mockResolvedValue([
      { ...baseRaw, status: 'AVAILABLE' as SmsUnitStatus },
    ]);

    await expect(
      unitsService.resolveIdentity(
        'unit-1',
        'idem-key',
        { outcome: 'AVAILABLE', notes: 'test' },
        access,
        { userId: 'user-1' },
      ),
    ).rejects.toMatchObject({ code: 'SMS_INVALID_TRANSITION', statusCode: 409 });
  });

  it('throws 403 when caller lacks RECEIVING_MANAGE at physicalLocationId', async () => {
    // Can see the unit (STOCK_VIEW at its showroom) but may only receive elsewhere.
    const wrongAccess = makeAccess({
      byLocation: {
        [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW],
        [SHOWROOM_B]: [SMS_PERMISSIONS.RECEIVING_MANAGE],
      },
    });
    mockLockUnits.mockResolvedValue([unitInMismatch]);

    await expect(
      unitsService.resolveIdentity(
        'unit-1',
        'idem-key',
        { outcome: 'AVAILABLE', notes: 'test' },
        wrongAccess,
        { userId: 'user-1' },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('calls recordUnitEvent with IDENTITY_RESOLVED and INSPECTION_STARTED when outcome is INSPECTION', async () => {
    mockLockUnits.mockResolvedValue([unitInMismatch]);
    mockRecordUnitEvent.mockResolvedValue({
      unit: { ...unitInMismatch, status: 'INSPECTION' },
      event: { id: 'event-1' },
    });
    const { prisma } = await import('../../../lib/prisma.js');
    const mockCreateInspection = prisma.smsInspection.create as ReturnType<typeof vi.fn>;
    mockCreateInspection.mockResolvedValue({ id: 'insp-1' });
    const mockFindUniqueOrThrow = prisma.smsUnit.findUniqueOrThrow as ReturnType<typeof vi.fn>;
    mockFindUniqueOrThrow.mockResolvedValue({ ...unitInMismatch, status: 'INSPECTION' as SmsUnitStatus });

    await unitsService.resolveIdentity(
      'unit-1',
      'idem-key',
      { outcome: 'INSPECTION', notes: 'Found VIN mismatch' },
      access,
      { userId: 'user-1' },
    );

    // Should record both IDENTITY_RESOLVED and INSPECTION_STARTED.
    expect(mockRecordUnitEvent).toHaveBeenCalledTimes(2);
    const calls = mockRecordUnitEvent.mock.calls as Array<[unknown, unknown, { event: { type: string } }]>;
    const firstCall = calls[0];
    const secondCall = calls[1];
    expect(firstCall?.[2].event.type).toBe('IDENTITY_RESOLVED');
    expect(secondCall?.[2].event.type).toBe('INSPECTION_STARTED');
  });
});
