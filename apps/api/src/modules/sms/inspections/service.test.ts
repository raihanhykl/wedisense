/**
 * Service tests for the SMS inspections slice.
 *
 * Prisma is mocked (no DB required). runIdempotent is mocked to call its fn
 * with the mocked prisma client, so the full service logic runs but no
 * transaction or idempotency machinery executes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmsInspectionResult, SmsUnitStatus } from '@prisma/client';

// ── Module mocks ─────────────────────────────────────────────────────────────
// vi.mock calls are hoisted before imports by Vitest.

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsInspection: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../lib/idempotency.js', () => ({
  runIdempotent: vi.fn(),
  requireIdempotencyKey: vi.fn().mockReturnValue('test-idempotency-key-123456'),
}));

vi.mock('../lib/ledger.js', () => ({
  lockUnits: vi.fn(),
  recordUnitEvent: vi.fn(),
  resolveEventDate: vi.fn().mockReturnValue(new Date('2026-11-19T00:00:00.000Z')),
}));

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  findMany: vi.fn(),
  findById: vi.fn(),
}));

import { prisma } from '../../../lib/prisma.js';
import { runIdempotent } from '../lib/idempotency.js';
import { lockUnits, recordUnitEvent } from '../lib/ledger.js';
import { createAuditLog } from '../lib/audit.js';
import * as repo from './repository.js';
import { startInspection, setInspectionResult, listInspections } from './service.js';
import type { SmsAccess } from '../lib/access.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';

// ── Typed mock helpers ─────────────────────────────────────────────────────

const mockFindFirst = prisma.smsInspection.findFirst as ReturnType<typeof vi.fn>;
const mockCreate = prisma.smsInspection.create as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.smsInspection.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.smsInspection.update as ReturnType<typeof vi.fn>;
const mockUserFindFirst = prisma.user.findFirst as ReturnType<typeof vi.fn>;
const mockLockUnits = lockUnits as ReturnType<typeof vi.fn>;
const mockRecordUnitEvent = recordUnitEvent as ReturnType<typeof vi.fn>;
const mockCreateAuditLog = createAuditLog as ReturnType<typeof vi.fn>;
const mockFindMany = repo.findMany as ReturnType<typeof vi.fn>;
const mockRunIdempotent = runIdempotent as ReturnType<typeof vi.fn>;

// ── Fixtures ───────────────────────────────────────────────────────────────

const SHOWROOM_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHOWROOM_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const UNIT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const INSPECTION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeAccess(opts: {
  global?: string[];
  byLocation?: Map<string, Set<string>>;
}): SmsAccess {
  return {
    userId: USER_ID,
    global: new Set(opts.global ?? []),
    byLocation: opts.byLocation ?? new Map(),
  };
}

/** Access: INSPECTIONS_MANAGE at SHOWROOM_A only. */
function makeManagerAccess(showroomId = SHOWROOM_A): SmsAccess {
  return makeAccess({
    byLocation: new Map([
      [showroomId, new Set([SMS_PERMISSIONS.INSPECTIONS_MANAGE, SMS_PERMISSIONS.STOCK_VIEW])],
    ]),
  });
}

const mockUnit = {
  id: UNIT_ID,
  vin: 'VIN-TEST-001',
  status: 'INSPECTION' as SmsUnitStatus,
  physicalLocationId: SHOWROOM_A,
  responsibleShowroomId: SHOWROOM_A,
  wasRto: false,
};

const mockInspectionFull = {
  id: INSPECTION_ID,
  unitId: UNIT_ID,
  unit: {
    id: UNIT_ID,
    vin: 'VIN-TEST-001',
    status: 'INSPECTION' as SmsUnitStatus,
    physicalLocationId: SHOWROOM_A,
    responsibleShowroomId: SHOWROOM_A,
    variant: {
      name: 'Vario 160',
      color: 'Merah',
      model: { name: 'Honda Vario' },
    },
  },
  reason: 'RTO_RETURN' as const,
  result: 'PENDING' as SmsInspectionResult,
  condition: null,
  odometer: null,
  findings: null,
  notes: null,
  photos: null,
  inspector: null,
  inspectedAt: null,
  createdAt: new Date('2026-11-19T08:00:00.000Z'),
};

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: runIdempotent calls its fn with the mocked prisma as the tx.
  mockRunIdempotent.mockImplementation(
    async (
      opts: { statusCode?: number },
      fn: (tx: typeof prisma) => Promise<unknown>,
    ) => {
      const body = await fn(prisma);
      return { statusCode: opts.statusCode ?? 200, body, replayed: false };
    },
  );

  mockLockUnits.mockResolvedValue([mockUnit]);
  mockRecordUnitEvent.mockResolvedValue({});
  mockCreateAuditLog.mockResolvedValue(undefined);
  mockFindFirst.mockResolvedValue(null); // no existing pending by default
  mockCreate.mockResolvedValue(mockInspectionFull);
  mockUserFindFirst.mockResolvedValue({ id: USER_ID });
  mockFindUnique.mockResolvedValue(null);
});

// ── startInspection ────────────────────────────────────────────────────────

describe('startInspection', () => {
  const baseInput = {
    unitId: UNIT_ID,
    reason: 'RTO_RETURN' as const,
  };

  it('creates the inspection and records INSPECTION_STARTED when the unit is in INSPECTION status', async () => {
    const access = makeManagerAccess();
    mockFindFirst.mockResolvedValue(null); // no pending inspection

    await startInspection(access, baseInput, 'key-001');

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      prisma,
      mockUnit,
      expect.objectContaining({
        event: { type: 'INSPECTION_STARTED' },
        links: expect.objectContaining({ inspectionId: INSPECTION_ID }),
      }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'CREATE', resourceType: 'SmsInspection' }),
    );
  });

  it('throws SMS_INSPECTION_ALREADY_PENDING when the unit already has a pending inspection', async () => {
    const access = makeManagerAccess();
    // Simulate an existing pending inspection
    mockFindFirst.mockResolvedValue({ id: 'existing-pending-id' });

    await expect(startInspection(access, baseInput, 'key-002')).rejects.toMatchObject({
      code: 'SMS_INSPECTION_ALREADY_PENDING',
      statusCode: 409,
      details: [{ inspectionId: 'existing-pending-id' }],
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('throws SMS_UNIT_NOT_IN_INSPECTION when the unit is not in INSPECTION status', async () => {
    const access = makeManagerAccess();
    mockLockUnits.mockResolvedValue([{ ...mockUnit, status: 'AVAILABLE' as SmsUnitStatus }]);

    await expect(startInspection(access, baseInput, 'key-003')).rejects.toMatchObject({
      code: 'SMS_UNIT_NOT_IN_INSPECTION',
      statusCode: 409,
    });
  });

  it('answers 404 when the user cannot see the unit at all (manager elsewhere only)', async () => {
    // User is manager at SHOWROOM_B, but the unit is physically at SHOWROOM_A
    const access = makeManagerAccess(SHOWROOM_B);

    await expect(startInspection(access, baseInput, 'key-004')).rejects.toMatchObject({
      code: 'SMS_UNIT_NOT_FOUND',
      statusCode: 404,
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 403 when the user can see the unit but may not inspect it there', async () => {
    const access = makeAccess({
      byLocation: new Map([[SHOWROOM_A, new Set([SMS_PERMISSIONS.STOCK_VIEW])]]),
    });

    await expect(startInspection(access, baseInput, 'key-004b')).rejects.toMatchObject({
      code: 'SMS_FORBIDDEN_AT_LOCATION',
      statusCode: 403,
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('passes the correct inspectionId in links to recordUnitEvent', async () => {
    const access = makeManagerAccess();

    await startInspection(access, baseInput, 'key-005');

    const [, , recordInput] = mockRecordUnitEvent.mock.calls[0] as [
      unknown,
      unknown,
      { event: { type: string }; links: { inspectionId: string } },
    ];
    expect(recordInput.event.type).toBe('INSPECTION_STARTED');
    expect(recordInput.links.inspectionId).toBe(INSPECTION_ID);
  });
});

// ── setInspectionResult ───────────────────────────────────────────────────

describe('setInspectionResult', () => {
  const passedInput = {
    result: 'PASSED' as const,
    condition: 'GOOD' as const,
    odometer: 150,
  };

  const failedInput = {
    result: 'FAILED' as const,
    condition: 'POOR' as const,
    findings: 'Frame scratch observed on left side',
  };

  beforeEach(() => {
    // Bootstrap read (outside runIdempotent): inspection exists
    mockFindUnique
      .mockResolvedValueOnce({ id: INSPECTION_ID, unitId: UNIT_ID }) // preliminary
      .mockResolvedValueOnce({ id: INSPECTION_ID, unitId: UNIT_ID, result: SmsInspectionResult.PENDING }); // authoritative

    mockUpdate.mockResolvedValue({ ...mockInspectionFull, result: SmsInspectionResult.PASSED });
  });

  it('updates inspection to PASSED and records INSPECTION_PASSED event', async () => {
    const access = makeManagerAccess();

    await setInspectionResult(access, INSPECTION_ID, passedInput, 'key-100');

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockRecordUnitEvent).toHaveBeenCalledWith(
      prisma,
      mockUnit,
      expect.objectContaining({
        event: { type: 'INSPECTION_PASSED' },
        links: expect.objectContaining({ inspectionId: INSPECTION_ID }),
      }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'UPDATE', resourceType: 'SmsInspection' }),
    );
  });

  it('records INSPECTION_FAILED event when result is FAILED', async () => {
    const access = makeManagerAccess();

    await setInspectionResult(access, INSPECTION_ID, failedInput, 'key-101');

    const [, , recordInput] = mockRecordUnitEvent.mock.calls[0] as [
      unknown,
      unknown,
      { event: { type: string }; links: { inspectionId: string } },
    ];
    expect(recordInput.event.type).toBe('INSPECTION_FAILED');
    expect(recordInput.links.inspectionId).toBe(INSPECTION_ID);
  });

  it('throws SMS_INSPECTION_ALREADY_DECIDED (409) when the inspection is not PENDING', async () => {
    // Reset and re-setup: authoritative read returns non-PENDING
    mockFindUnique
      .mockReset()
      .mockResolvedValueOnce({ id: INSPECTION_ID, unitId: UNIT_ID }) // preliminary
      .mockResolvedValueOnce({
        id: INSPECTION_ID,
        unitId: UNIT_ID,
        result: SmsInspectionResult.PASSED,
      }); // authoritative → already decided

    const access = makeManagerAccess();

    await expect(
      setInspectionResult(access, INSPECTION_ID, passedInput, 'key-102'),
    ).rejects.toMatchObject({
      code: 'SMS_INSPECTION_ALREADY_DECIDED',
      statusCode: 409,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws SMS_FINDINGS_REQUIRED (422) when result is FAILED without findings', async () => {
    const access = makeManagerAccess();
    const noFindings = { result: 'FAILED' as const };

    await expect(
      setInspectionResult(access, INSPECTION_ID, noFindings, 'key-103'),
    ).rejects.toMatchObject({
      code: 'SMS_FINDINGS_REQUIRED',
      statusCode: 422,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 when the user cannot see the unit at all (manager elsewhere only)', async () => {
    // User is manager at SHOWROOM_B; unit is physically at SHOWROOM_A
    const access = makeManagerAccess(SHOWROOM_B);

    await expect(
      setInspectionResult(access, INSPECTION_ID, passedInput, 'key-104'),
    ).rejects.toMatchObject({
      code: 'SMS_UNIT_NOT_FOUND',
      statusCode: 404,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 403 when the user can see the unit but may not record inspections there', async () => {
    const access = makeAccess({
      byLocation: new Map([[SHOWROOM_A, new Set([SMS_PERMISSIONS.STOCK_VIEW])]]),
    });

    await expect(
      setInspectionResult(access, INSPECTION_ID, passedInput, 'key-104b'),
    ).rejects.toMatchObject({
      code: 'SMS_FORBIDDEN_AT_LOCATION',
      statusCode: 403,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws SMS_INSPECTION_NOT_FOUND (404) when the inspection does not exist', async () => {
    // Bootstrap read returns null
    mockFindUnique.mockReset().mockResolvedValue(null);
    const access = makeManagerAccess();

    await expect(
      setInspectionResult(access, 'nonexistent-id', passedInput, 'key-105'),
    ).rejects.toMatchObject({
      code: 'SMS_INSPECTION_NOT_FOUND',
      statusCode: 404,
    });

    // runIdempotent should not be called since we 404 before it
    expect(mockRunIdempotent).not.toHaveBeenCalled();
  });
});

// ── listInspections ───────────────────────────────────────────────────────

describe('listInspections', () => {
  it('calls findMany scoped to the requested showroomId', async () => {
    const access = makeManagerAccess(SHOWROOM_A);
    mockFindMany.mockResolvedValue({ data: [], total: 0 });

    await listInspections(access, { showroomId: SHOWROOM_A, page: 1, limit: 20 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ showroomId: SHOWROOM_A }),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('throws SMS_FORBIDDEN_AT_LOCATION (403) when the user cannot STOCK_VIEW the requested showroom', async () => {
    // User only has access to SHOWROOM_B
    const access = makeManagerAccess(SHOWROOM_B);

    await expect(
      listInspections(access, { showroomId: SHOWROOM_A }),
    ).rejects.toMatchObject({
      code: 'SMS_FORBIDDEN_AT_LOCATION',
      statusCode: 403,
    });

    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('applies optional result filter to the repository call', async () => {
    const access = makeManagerAccess(SHOWROOM_A);
    mockFindMany.mockResolvedValue({ data: [], total: 0 });

    await listInspections(access, {
      showroomId: SHOWROOM_A,
      result: SmsInspectionResult.PASSED,
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        showroomId: SHOWROOM_A,
        result: SmsInspectionResult.PASSED,
      }),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
