/**
 * Unit tests for the show-loans service.
 *
 * All external dependencies are mocked; no database required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsShowLoan: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    smsUnit: { findMany: vi.fn() },
    smsInspection: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/idempotency.js', () => ({
  requireIdempotencyKey: vi.fn().mockReturnValue('test-key'),
  runIdempotent: vi.fn(),
}));

vi.mock('../lib/ledger.js', () => ({
  lockUnit: vi.fn(),
  recordUnitEvent: vi.fn(),
  businessToday: vi.fn().mockReturnValue(new Date('2026-11-20T00:00:00.000Z')),
  resolveEventDate: vi.fn().mockReturnValue(new Date('2026-11-20T00:00:00.000Z')),
}));

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('../lib/access.js', () => ({
  assertCan: vi.fn(),
  assertCanActOn: vi.fn(),
  can: vi.fn(() => true),
  locationScope: vi.fn(() => 'ALL'),
  requireSmsPermission: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getSmsAccess: vi.fn(),
  canAnywhere: vi.fn(() => true),
}));

vi.mock('./repository.js', () => ({
  findMany: vi.fn(),
  findById: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import * as showLoanService from './service.js';
import * as showLoanRepo from './repository.js';
import * as idempotency from '../lib/idempotency.js';
import * as ledger from '../lib/ledger.js';
import * as access from '../lib/access.js';
import type { SmsAccess } from '../lib/access.js';
import type { ShowLoanFull } from './repository.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { returnShowLoanSchema } from './schema.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const SHOWROOM_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UNIT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LOAN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const TODAY = new Date('2026-11-20T00:00:00.000Z');
const TWO_DAYS_AGO = new Date('2026-11-18T00:00:00.000Z');
const YESTERDAY = new Date('2026-11-19T00:00:00.000Z');
const TOMORROW = new Date('2026-11-21T00:00:00.000Z');

function makeLoanFull(overrides: Partial<ShowLoanFull> = {}): ShowLoanFull {
  return {
    id: LOAN_ID,
    unitId: UNIT_ID,
    unit: {
      id: UNIT_ID,
      vin: 'VIN001',
      status: 'SHOW_UNIT',
      physicalLocationId: null,
      responsibleShowroomId: SHOWROOM_ID,
      variant: {
        name: 'Extended',
        color: 'Black',
        model: { name: 'Athena' },
      },
    },
    showroomId: SHOWROOM_ID,
    eventName: 'Jakarta Fair',
    eventLocation: 'JIExpo',
    pic: { id: 'pic-user-id', name: 'PIC Name' },
    dispatchedAt: TWO_DAYS_AGO,
    expectedReturnDate: TOMORROW,
    returnedAt: null,
    returnCondition: null,
    hasFindings: false,
    notes: null,
    createdAt: TWO_DAYS_AGO,
    updatedAt: TWO_DAYS_AGO,
    ...overrides,
  };
}

const globalAdmin = makeAccess({
  global: [SMS_PERMISSIONS.STOCK_VIEW, SMS_PERMISSIONS.SHOW_UNITS_MANAGE],
});

const mockFindMany = showLoanRepo.findMany as ReturnType<typeof vi.fn>;
const mockFindById = showLoanRepo.findById as ReturnType<typeof vi.fn>;
const mockRunIdempotent = idempotency.runIdempotent as ReturnType<typeof vi.fn>;
const mockBusinessToday = ledger.businessToday as ReturnType<typeof vi.fn>;
const mockAssertCan = access.assertCan as ReturnType<typeof vi.fn>;
const mockCan = access.can as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockBusinessToday.mockReturnValue(TODAY);
  mockCan.mockReturnValue(true);
  mockAssertCan.mockReturnValue(undefined);
});

// ── mapToRow / overdue computation ────────────────────────────────────────────

describe('mapToRow (overdue logic)', () => {
  it('status OUT when returnedAt=null and expectedReturnDate >= today', () => {
    const row = showLoanService.mapToRow(makeLoanFull({ expectedReturnDate: TOMORROW }));
    expect(row.status).toBe('OUT');
    expect(row.overdue).toBe(false);
    expect(row.daysOverdue).toBe(0);
  });

  it('status OVERDUE when returnedAt=null and expectedReturnDate < today', () => {
    const row = showLoanService.mapToRow(makeLoanFull({ expectedReturnDate: YESTERDAY }));
    expect(row.status).toBe('OVERDUE');
    expect(row.overdue).toBe(true);
    expect(row.daysOverdue).toBe(1);
  });

  it('status RETURNED when returnedAt is set, regardless of expectedReturnDate', () => {
    const row = showLoanService.mapToRow(
      makeLoanFull({ expectedReturnDate: YESTERDAY, returnedAt: new Date('2026-11-15T10:00:00Z') }),
    );
    expect(row.status).toBe('RETURNED');
    expect(row.overdue).toBe(false);
    expect(row.daysOverdue).toBe(0);
  });
});

// ── listShowLoans ─────────────────────────────────────────────────────────────

describe('listShowLoans', () => {
  it('passes specific showroomId to repository when provided', async () => {
    mockFindMany.mockResolvedValue({ data: [], total: 0 });

    await showLoanService.listShowLoans(globalAdmin, { showroomId: SHOWROOM_ID });

    const [filters] = mockFindMany.mock.calls[0] as Parameters<typeof showLoanRepo.findMany>;
    expect(filters.showroomId).toBe(SHOWROOM_ID);
    expect(mockAssertCan).toHaveBeenCalledWith(
      globalAdmin,
      SMS_PERMISSIONS.STOCK_VIEW,
      SHOWROOM_ID,
    );
  });

  it('uses locationScope when showroomId is not provided', async () => {
    const mockLocationScope = access.locationScope as ReturnType<typeof vi.fn>;
    mockLocationScope.mockReturnValue('ALL');
    mockFindMany.mockResolvedValue({ data: [], total: 0 });

    await showLoanService.listShowLoans(globalAdmin, {});

    const [filters] = mockFindMany.mock.calls[0] as Parameters<typeof showLoanRepo.findMany>;
    expect(filters.showroomId).toBeUndefined();
    expect(filters.scopeShowroomIds).toBe('ALL');
  });

  it('maps rows with overdue info', async () => {
    const overdueLoan = makeLoanFull({ expectedReturnDate: YESTERDAY });
    mockFindMany.mockResolvedValue({ data: [overdueLoan], total: 1 });

    const { data } = await showLoanService.listShowLoans(globalAdmin, { showroomId: SHOWROOM_ID });

    expect(data).toHaveLength(1);
    expect(data[0]!.overdue).toBe(true);
    expect(data[0]!.daysOverdue).toBe(1);
  });
});

// ── getShowLoan ───────────────────────────────────────────────────────────────

describe('getShowLoan', () => {
  it('returns loan when user has STOCK_VIEW at the showroom', async () => {
    mockFindById.mockResolvedValue(makeLoanFull());

    const result = await showLoanService.getShowLoan(globalAdmin, LOAN_ID);
    expect(result.id).toBe(LOAN_ID);
  });

  it('throws 404 when loan does not exist', async () => {
    mockFindById.mockResolvedValue(null);

    await expect(showLoanService.getShowLoan(globalAdmin, LOAN_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'SMS_SHOW_LOAN_NOT_FOUND',
    });
  });

  it('throws 404 (not 403) when user lacks STOCK_VIEW at the loan showroom', async () => {
    mockFindById.mockResolvedValue(makeLoanFull());
    mockCan.mockReturnValue(false);

    await expect(showLoanService.getShowLoan(globalAdmin, LOAN_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ── createShowLoan ────────────────────────────────────────────────────────────

describe('createShowLoan', () => {
  it('calls runIdempotent with correct operation', async () => {
    mockRunIdempotent.mockResolvedValue({ statusCode: 201, body: makeLoanFull(), replayed: false });

    await showLoanService.createShowLoan(
      globalAdmin,
      {
        unitId: UNIT_ID,
        eventName: 'Test Event',
        eventLocation: 'Test Location',
        picUserId: 'pic-user-id',
        expectedReturnDate: '2026-12-01',
      },
      'idempotency-key-123',
    );

    expect(mockRunIdempotent).toHaveBeenCalledOnce();
    const [opts] = mockRunIdempotent.mock.calls[0] as [{ operation: string; statusCode: number }];
    expect(opts.operation).toBe('show-loans.dispatch');
    expect(opts.statusCode).toBe(201);
  });
});

// ── returnShowLoan ────────────────────────────────────────────────────────────

describe('returnShowLoan', () => {
  it('throws 404 when loan does not exist (preliminary check)', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    const mockPrelim = prisma.smsShowLoan.findUnique as ReturnType<typeof vi.fn>;
    mockPrelim.mockResolvedValue(null);

    await expect(
      showLoanService.returnShowLoan(
        globalAdmin,
        LOAN_ID,
        { condition: 'GOOD', hasFindings: false },
        'key',
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SMS_SHOW_LOAN_NOT_FOUND' });

    expect(mockRunIdempotent).not.toHaveBeenCalled();
  });

  it('calls runIdempotent with correct operation', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    const mockPrelim = prisma.smsShowLoan.findUnique as ReturnType<typeof vi.fn>;
    mockPrelim.mockResolvedValue({ id: LOAN_ID, unitId: UNIT_ID });

    mockRunIdempotent.mockResolvedValue({
      statusCode: 200,
      body: { ...mapLoanToExpectedRow(makeLoanFull()), alreadyDone: false },
      replayed: false,
    });

    await showLoanService.returnShowLoan(
      globalAdmin,
      LOAN_ID,
      { condition: 'GOOD', hasFindings: false },
      'key',
    );

    const [opts] = mockRunIdempotent.mock.calls[0] as [{ operation: string }];
    expect(opts.operation).toBe('show-loans.return');
  });
});

// ── idempotent repeat (no-op) ────────────────────────────────────────────────

describe('returnShowLoan idempotent repeat', () => {
  it('returns alreadyDone:true when loan is already returned', async () => {
    const alreadyReturnedLoan = makeLoanFull({
      returnedAt: YESTERDAY,
      returnCondition: 'GOOD',
      hasFindings: false,
      unit: {
        id: UNIT_ID,
        vin: 'VIN001',
        status: 'AVAILABLE',
        physicalLocationId: SHOWROOM_ID,
        responsibleShowroomId: SHOWROOM_ID,
        variant: { name: 'Extended', color: 'Black', model: { name: 'Athena' } },
      },
    });

    // Simulate what happens inside runIdempotent's fn.
    // The tx arg must carry smsShowLoan.findUnique because the service calls
    // tx.smsShowLoan.findUnique (not prisma.smsShowLoan.findUnique) inside the
    // transaction callback.
    mockRunIdempotent.mockImplementation(
      async (_opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
        const mockLock = ledger.lockUnit as ReturnType<typeof vi.fn>;
        mockLock.mockResolvedValue({
          id: UNIT_ID,
          vin: 'VIN001',
          status: 'AVAILABLE',
          physicalLocationId: SHOWROOM_ID,
          responsibleShowroomId: SHOWROOM_ID,
        });

        // Build a minimal Prisma tx mock that the idempotency-guard path needs.
        const txMock = {
          smsShowLoan: {
            findUnique: vi.fn().mockResolvedValue(alreadyReturnedLoan),
            update: vi.fn(),
          },
          smsInspection: { create: vi.fn() },
          auditLog: { create: vi.fn() },
        };

        const result = await fn(txMock);
        return { statusCode: 200, body: result, replayed: false };
      },
    );

    const { prisma } = await import('../../../lib/prisma.js');
    (prisma.smsShowLoan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: LOAN_ID,
      unitId: UNIT_ID,
    });

    const result = await showLoanService.returnShowLoan(
      globalAdmin,
      LOAN_ID,
      { condition: 'GOOD', hasFindings: false },
      'key',
    );

    expect(result.body).toMatchObject({ alreadyDone: true });
    // No ledger event should be recorded
    expect(ledger.recordUnitEvent).not.toHaveBeenCalled();
  });
});

// ── Zod schema validation ─────────────────────────────────────────────────────

describe('returnShowLoan Zod validation', () => {
  it('requires findings when hasFindings is true', () => {
    const result = returnShowLoanSchema.safeParse({ condition: 'GOOD', hasFindings: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.path).toContain('findings');
    }
  });

  it('accepts findings when hasFindings is true', () => {
    const result = returnShowLoanSchema.safeParse({
      condition: 'GOOD',
      hasFindings: true,
      findings: 'Scratches on the left panel',
    });
    expect(result.success).toBe(true);
  });

  it('allows no findings when hasFindings is false', () => {
    const result = returnShowLoanSchema.safeParse({ condition: 'GOOD', hasFindings: false });
    expect(result.success).toBe(true);
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────

function mapLoanToExpectedRow(loan: ShowLoanFull) {
  return showLoanService.mapToRow(loan);
}
