/**
 * Service tests for the opening-balance slice.
 *
 * Prisma is mocked (no DB). idempotency, ledger and audit helpers are also
 * mocked so the service logic can be tested in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';
import type { SmsAccess } from '../lib/access.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    smsUnit: { findMany: vi.fn(), update: vi.fn() },
    smsShipmentLine: { findMany: vi.fn() },
    smsOrder: { findMany: vi.fn(), create: vi.fn() },
    smsOrderLine: { create: vi.fn() },
    smsRtoContract: { findMany: vi.fn(), create: vi.fn() },
    smsReturnRequest: { create: vi.fn() },
    smsInspection: { create: vi.fn() },
    smsShowLoan: { create: vi.fn() },
    smsUnitEvent: { create: vi.fn() },
    smsVehicleVariant: { findMany: vi.fn() },
    location: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../lib/idempotency.js', () => ({
  requireIdempotencyKey: vi.fn().mockReturnValue('test-key-opening-balance'),
  runIdempotent: vi.fn(),
}));

vi.mock('../lib/ledger.js', () => ({
  createUnitWithEvent: vi.fn(),
  recordUnitEvent: vi.fn(),
  resolveEventDate: vi.fn().mockReturnValue(new Date('2025-11-01T00:00:00.000Z')),
  businessToday: vi.fn().mockReturnValue(new Date('2025-11-01T00:00:00.000Z')),
}));

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('../lib/access.js', () => ({
  getSmsAccess: vi.fn(),
  assertCan: vi.fn(),
  requireSmsPermission: vi.fn(),
  canAnywhere: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  findStockLocation: vi.fn(),
  findAllVariantsForMatching: vi.fn(),
  findActiveUsersForMatching: vi.fn(),
  findActiveStockShowrooms: vi.fn(),
  findExistingUnitVins: vi.fn(),
  findPendingShipmentVins: vi.fn(),
  findExistingSpkKeys: vi.fn(),
  findExistingContractNumbers: vi.fn(),
  generateReturnRequestNumber: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { confirmBalance } from './service.js';
import * as repo from './repository.js';
import * as idempotency from '../lib/idempotency.js';
import * as ledger from '../lib/ledger.js';
import * as audit from '../lib/audit.js';
import * as access from '../lib/access.js';
import type { ObConfirmBody } from './schema.js';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockFindStockLocation = repo.findStockLocation as ReturnType<typeof vi.fn>;
const mockFindAllVariants = repo.findAllVariantsForMatching as ReturnType<typeof vi.fn>;
const mockFindActiveUsers = repo.findActiveUsersForMatching as ReturnType<typeof vi.fn>;
const mockFindActiveShowrooms = repo.findActiveStockShowrooms as ReturnType<typeof vi.fn>;
const mockFindExistingUnitVins = repo.findExistingUnitVins as ReturnType<typeof vi.fn>;
const mockFindPendingShipmentVins = repo.findPendingShipmentVins as ReturnType<typeof vi.fn>;
const mockFindExistingSpkKeys = repo.findExistingSpkKeys as ReturnType<typeof vi.fn>;
const mockFindExistingContractNumbers = repo.findExistingContractNumbers as ReturnType<typeof vi.fn>;
const mockRunIdempotent = idempotency.runIdempotent as ReturnType<typeof vi.fn>;
const mockCreateUnitWithEvent = ledger.createUnitWithEvent as ReturnType<typeof vi.fn>;
const mockCreateAuditLog = audit.createAuditLog as ReturnType<typeof vi.fn>;
const mockGetSmsAccess = access.getSmsAccess as ReturnType<typeof vi.fn>;
const mockAssertCan = access.assertCan as ReturnType<typeof vi.fn>;
const mockResolveEventDate = ledger.resolveEventDate as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SHOWROOM_ID = 'showroom-jkt-01';
const VARIANT_ID = 'variant-uuid-1';
const USER_ID = 'user-uuid-1';
const BALANCE_DATE = new Date('2025-11-01T00:00:00.000Z');

const mockAccess: SmsAccess = {
  userId: USER_ID,
  global: new Set(['sms-receiving:manage']),
  byLocation: new Map(),
};

const mockLocation = { id: SHOWROOM_ID, name: 'Jakarta Showroom', code: 'JKT-01', type: 'SHOWROOM', isActive: true };

function makeReq(): Request {
  return {} as Request;
}

function setupRunIdempotent() {
  mockRunIdempotent.mockImplementation(
    async (_opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import('../../../lib/prisma.js');
      const fakeTx = {
        smsUnit: prisma.smsUnit,
        smsOrder: prisma.smsOrder,
        smsOrderLine: prisma.smsOrderLine,
        smsRtoContract: prisma.smsRtoContract,
        smsReturnRequest: prisma.smsReturnRequest,
        smsInspection: prisma.smsInspection,
        smsShowLoan: prisma.smsShowLoan,
        smsUnitEvent: prisma.smsUnitEvent,
        auditLog: prisma.auditLog,
        $queryRaw: vi.fn(),
      };
      const result = await fn(fakeTx);
      return { statusCode: 201, body: result, replayed: false };
    },
  );
}

// ── confirmBalance tests ──────────────────────────────────────────────────────

describe('confirmBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSmsAccess.mockReturnValue(mockAccess);
    mockAssertCan.mockReturnValue(undefined);
    mockFindStockLocation.mockResolvedValue(mockLocation);
    mockFindAllVariants.mockResolvedValue([]);
    mockFindActiveUsers.mockResolvedValue([]);
    mockFindActiveShowrooms.mockResolvedValue([]);
    mockFindExistingUnitVins.mockResolvedValue(new Set());
    mockFindPendingShipmentVins.mockResolvedValue(new Set());
    mockFindExistingSpkKeys.mockResolvedValue(new Set());
    mockFindExistingContractNumbers.mockResolvedValue(new Set());
    mockResolveEventDate.mockReturnValue(BALANCE_DATE);
    setupRunIdempotent();
  });

  // ── A14: ACTIVE_RTO creates unit + contract and NO order/orderLine ──────────

  it('A14: ACTIVE_RTO row creates a unit + contract, NO order and NO order line', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    mockCreateUnitWithEvent.mockResolvedValue({
      unit: { id: 'unit-rto-1', vin: 'MH1JFB118NK000001', status: 'ACTIVE_RTO', physicalLocationId: null, responsibleShowroomId: SHOWROOM_ID },
      event: {},
    });
    (prisma.smsRtoContract.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'contract-1' });
    (prisma.smsUnit.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ObConfirmBody = {
      rows: [
        {
          row: 2,
          vin: 'MH1JFB118NK000001',
          variantId: VARIANT_ID,
          showroomId: SHOWROOM_ID,
          state: 'ACTIVE_RTO',
          contractNumber: 'KTR-001',
          customerName: 'Hendra',
        },
      ],
    };

    const result = await confirmBalance(body, makeReq());

    expect(result.createdCount).toBe(1);
    expect(result.contractsCreated).toBe(1);
    expect(result.ordersCreated).toBe(0);

    // No order or order line must be created
    expect(prisma.smsOrder.create).not.toHaveBeenCalled();
    expect(prisma.smsOrderLine.create).not.toHaveBeenCalled();
  });

  it('A14: OPENING_BALANCE event for ACTIVE_RTO has physicalLocationId null', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    mockCreateUnitWithEvent.mockResolvedValue({
      unit: { id: 'unit-rto-2', vin: 'MH1JFB118NK000002', status: 'ACTIVE_RTO', physicalLocationId: null },
      event: {},
    });
    (prisma.smsRtoContract.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'contract-2' });
    (prisma.smsUnit.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ObConfirmBody = {
      rows: [
        {
          row: 2,
          vin: 'MH1JFB118NK000002',
          variantId: VARIANT_ID,
          showroomId: SHOWROOM_ID,
          state: 'ACTIVE_RTO',
          contractNumber: 'KTR-002',
          customerName: 'Test Customer',
        },
      ],
    };

    await confirmBalance(body, makeReq());

    const callArgs = mockCreateUnitWithEvent.mock.calls[0]!;
    const eventInput = callArgs[2] as { event: { physicalLocationId: string | null; type: string } };
    expect(eventInput.event.physicalLocationId).toBeNull();
    expect(eventInput.event.type).toBe('OPENING_BALANCE');
  });

  // ── AVAILABLE: physicalLocationId = showroomId ───────────────────────────────

  it('AVAILABLE row passes physicalLocationId = showroomId to OPENING_BALANCE event', async () => {
    mockCreateUnitWithEvent.mockResolvedValue({
      unit: { id: 'unit-av-1', vin: 'MH1JFB118NK000003', status: 'AVAILABLE', physicalLocationId: SHOWROOM_ID },
      event: {},
    });
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ObConfirmBody = {
      rows: [
        {
          row: 2,
          vin: 'MH1JFB118NK000003',
          variantId: VARIANT_ID,
          showroomId: SHOWROOM_ID,
          state: 'AVAILABLE',
        },
      ],
    };

    await confirmBalance(body, makeReq());

    const callArgs = mockCreateUnitWithEvent.mock.calls[0]!;
    const eventInput = callArgs[2] as { event: { physicalLocationId: string | null } };
    expect(eventInput.event.physicalLocationId).toBe(SHOWROOM_ID);
  });

  // ── 403 when user lacks permission at the row's showroom ─────────────────────

  it('throws 403 when assertCan fails for the row showroom', async () => {
    const { AppError } = await import('../../../middleware/error-handler.js');
    mockAssertCan.mockImplementation(() => {
      throw new AppError(403, 'SMS_FORBIDDEN_AT_LOCATION', 'Forbidden');
    });

    const body: ObConfirmBody = {
      rows: [
        {
          row: 2,
          vin: 'MH1JFB118NK000004',
          variantId: VARIANT_ID,
          showroomId: SHOWROOM_ID,
          state: 'AVAILABLE',
        },
      ],
    };

    await expect(confirmBalance(body, makeReq())).rejects.toThrow('Forbidden');
  });

  // ── Validation failure → nothing written ─────────────────────────────────────

  it('throws 422 and writes nothing when a VIN already exists', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    mockFindExistingUnitVins.mockResolvedValue(new Set(['MH1JFB118NK000001']));

    const body: ObConfirmBody = {
      rows: [
        {
          row: 2,
          vin: 'MH1JFB118NK000001',
          variantId: VARIANT_ID,
          showroomId: SHOWROOM_ID,
          state: 'AVAILABLE',
        },
      ],
    };

    await expect(confirmBalance(body, makeReq())).rejects.toMatchObject({
      code: 'SMS_OPENING_BALANCE_VALIDATION_FAILED',
    });

    // runIdempotent (and hence createUnitWithEvent) must NOT be called
    expect(mockRunIdempotent).not.toHaveBeenCalled();
    expect(prisma.smsUnit.update).not.toHaveBeenCalled();
  });

  // ── BOOKED: creates order + order line ───────────────────────────────────────

  it('BOOKED row creates an order and an order line and sets activeOrderLineId', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    mockCreateUnitWithEvent.mockResolvedValue({
      unit: { id: 'unit-bk-1', vin: 'MH1JFB118NK000005', status: 'BOOKED', physicalLocationId: SHOWROOM_ID },
      event: {},
    });
    (prisma.smsOrder.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'order-1' });
    (prisma.smsOrderLine.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'line-1' });
    (prisma.smsUnit.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ObConfirmBody = {
      rows: [
        {
          row: 2,
          vin: 'MH1JFB118NK000005',
          variantId: VARIANT_ID,
          showroomId: SHOWROOM_ID,
          state: 'BOOKED',
          spkNumber: 'SPK-001',
          customerName: 'Budi',
        },
      ],
    };

    const result = await confirmBalance(body, makeReq());

    expect(result.ordersCreated).toBe(1);
    expect(prisma.smsOrder.create).toHaveBeenCalledOnce();
    expect(prisma.smsOrderLine.create).toHaveBeenCalledOnce();
    // pointer update
    expect(prisma.smsUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeOrderLineId: 'line-1' }),
      }),
    );
  });

  // ── Duplicate VIN in payload → 422 before transaction ────────────────────────

  it('rejects when payload contains duplicate VINs', async () => {
    const body: ObConfirmBody = {
      rows: [
        { row: 2, vin: 'MH1JFB118NK000001', variantId: VARIANT_ID, showroomId: SHOWROOM_ID, state: 'AVAILABLE' },
        { row: 3, vin: 'MH1JFB118NK000001', variantId: VARIANT_ID, showroomId: SHOWROOM_ID, state: 'AVAILABLE' },
      ],
    };

    await expect(confirmBalance(body, makeReq())).rejects.toMatchObject({
      code: 'SMS_DUPLICATE_VIN_IN_PAYLOAD',
    });
    expect(mockRunIdempotent).not.toHaveBeenCalled();
  });

  // ── Audit row ─────────────────────────────────────────────────────────────────

  it('writes exactly one audit row (bulk summary) inside the transaction', async () => {
    mockCreateUnitWithEvent.mockResolvedValue({
      unit: { id: 'unit-av-2', vin: 'MH1JFB118NK000006', status: 'AVAILABLE', physicalLocationId: SHOWROOM_ID },
      event: {},
    });
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ObConfirmBody = {
      rows: [
        { row: 2, vin: 'MH1JFB118NK000006', variantId: VARIANT_ID, showroomId: SHOWROOM_ID, state: 'AVAILABLE' },
      ],
    };

    await confirmBalance(body, makeReq());

    expect(mockCreateAuditLog).toHaveBeenCalledOnce();
    const auditCall = mockCreateAuditLog.mock.calls[0]![1] as { action: string; resourceType: string; resourceId: string; newValues: Record<string, unknown> };
    expect(auditCall.action).toBe('IMPORT');
    expect(auditCall.resourceType).toBe('SmsUnit');
    expect(auditCall.resourceId).toBe('bulk');
    expect(auditCall.newValues).toMatchObject({ createdCount: 1 });
  });
});
