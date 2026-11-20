/**
 * Service tests for the shipments slice.
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
    smsShipment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    smsShipmentLine: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    smsUnit: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    smsInspection: {
      create: vi.fn(),
    },
    smsVehicleVariant: {
      findMany: vi.fn(),
    },
    location: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/idempotency.js', () => ({
  requireIdempotencyKey: vi.fn().mockReturnValue('test-idempotency-key'),
  runIdempotent: vi.fn(),
}));

vi.mock('../lib/ledger.js', () => ({
  createUnitWithEvent: vi.fn(),
  recordUnitEvent: vi.fn(),
  resolveEventDate: vi.fn().mockReturnValue(new Date('2024-01-15T00:00:00.000Z')),
}));

vi.mock('../lib/audit.js', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('../lib/access.js', () => ({
  getSmsAccess: vi.fn(),
  assertCan: vi.fn(),
  assertCanActOn: vi.fn(),
  can: vi.fn(() => true),
  locationScope: vi.fn(),
  requireSmsPermission: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  findShipmentById: vi.fn(),
  findShipmentByKey: vi.fn(),
  findExistingLinesInShipment: vi.fn(),
  findLinesInOtherShipments: vi.fn(),
  findExistingUnits: vi.fn(),
  findAllVariantsForMatching: vi.fn(),
  findDestinationLocation: vi.fn(),
  listShipments: vi.fn(),
  getShipmentCounts: vi.fn(),
  findLinesByShipmentId: vi.fn(),
  lockLines: vi.fn(),
  findLockedLines: vi.fn(),
  updateLine: vi.fn(),
  createLine: vi.fn(),
  createInspection: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { confirmImport, receiveItems } from './service.js';
import * as repo from './repository.js';
import * as idempotency from '../lib/idempotency.js';
import * as ledger from '../lib/ledger.js';
import * as audit from '../lib/audit.js';
import * as access from '../lib/access.js';
import type { ConfirmBody } from './schema.js';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockFindDestinationLocation = repo.findDestinationLocation as ReturnType<typeof vi.fn>;
const mockGetShipmentCounts = repo.getShipmentCounts as ReturnType<typeof vi.fn>;
const mockLockLines = repo.lockLines as ReturnType<typeof vi.fn>;
const mockFindLockedLines = repo.findLockedLines as ReturnType<typeof vi.fn>;
const mockUpdateLine = repo.updateLine as ReturnType<typeof vi.fn>;
const mockCreateInspection = repo.createInspection as ReturnType<typeof vi.fn>;
const mockFindShipmentById = repo.findShipmentById as ReturnType<typeof vi.fn>;
const mockRunIdempotent = idempotency.runIdempotent as ReturnType<typeof vi.fn>;
const mockCreateUnitWithEvent = ledger.createUnitWithEvent as ReturnType<typeof vi.fn>;
const mockRecordUnitEvent = ledger.recordUnitEvent as ReturnType<typeof vi.fn>;
const mockCreateAuditLog = audit.createAuditLog as ReturnType<typeof vi.fn>;
const mockGetSmsAccess = access.getSmsAccess as ReturnType<typeof vi.fn>;
const mockAssertCan = access.assertCan as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEST_LOCATION_ID = 'loc-showroom-1';
const SHIPMENT_ID = 'shipment-uuid-1';
const BATCH = 'BATCH-2024-001';
const DELIVERY_NOTE = 'DN-001';

const mockAccess: SmsAccess = {
  userId: 'user-1',
  global: new Set(['sms-receiving:manage', 'sms-stock:view']),
  byLocation: new Map(),
};

const mockLocation = {
  id: DEST_LOCATION_ID,
  name: 'Main Showroom',
  type: 'SHOWROOM',
  isActive: true,
};

const mockShipment = {
  id: SHIPMENT_ID,
  batchNumber: BATCH,
  deliveryNoteNumber: DELIVERY_NOTE,
  destinationLocationId: DEST_LOCATION_ID,
  originLocationId: null,
  destinationLocation: { id: DEST_LOCATION_ID, name: 'Main Showroom', type: 'SHOWROOM' },
  originLocation: null,
  createdBy: { name: 'Admin' },
  dispatchDate: null,
  notes: null,
  sourceFileName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeReq(): Request {
  return {} as Request;
}

// ── runIdempotent passthrough helper ──────────────────────────────────────────

/**
 * Makes runIdempotent call its `fn` callback directly with a fake tx, so the
 * service's transaction body executes in tests without a real DB.
 */
function setupRunIdempotent() {
  mockRunIdempotent.mockImplementation(
    async (_opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      // Build a minimal fake tx with the methods our service calls
      const { prisma } = await import('../../../lib/prisma.js');
      const fakeTx = {
        smsShipment: prisma.smsShipment,
        smsShipmentLine: prisma.smsShipmentLine,
        smsUnit: prisma.smsUnit,
        smsInspection: prisma.smsInspection,
        auditLog: prisma.auditLog,
        $queryRaw: vi.fn(),
      };
      const result = await fn(fakeTx);
      return { statusCode: 201, body: result, replayed: false };
    },
  );
}

// ── confirmImport tests ───────────────────────────────────────────────────────

describe('confirmImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSmsAccess.mockReturnValue(mockAccess);
    mockAssertCan.mockReturnValue(undefined);
    mockFindDestinationLocation.mockResolvedValue(mockLocation);
    setupRunIdempotent();
  });

  it('creates new lines and skips already-existing VINs', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    // Existing shipment with one of the VINs already in it
    (prisma.smsShipment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShipment);
    (prisma.smsShipmentLine.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ vin: 'VIN12345678901234' }]) // already in this shipment
      .mockResolvedValueOnce([]) // no other shipments
    ;
    (prisma.smsUnit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.smsShipmentLine.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ConfirmBody = {
      destinationLocationId: DEST_LOCATION_ID,
      batchNumber: BATCH,
      deliveryNoteNumber: DELIVERY_NOTE,
      lines: [
        {
          vin: 'VIN12345678901234', // already in shipment
          sourceRows: [{ row: 2, values: {} }],
        },
        {
          vin: 'VIN12345678901235', // new
          sourceRows: [{ row: 3, values: {} }],
        },
      ],
    };

    const result = await confirmImport(body, makeReq());

    expect(result.createdCount).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.vin).toBe('VIN12345678901234');
    expect(result.skipped[0]!.reason).toMatch(/already listed in this shipment/i);
  });

  it('appends to an existing shipment (find-or-create)', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    // Shipment already exists
    (prisma.smsShipment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShipment);
    (prisma.smsShipmentLine.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // nothing in this shipment
      .mockResolvedValueOnce([]); // nothing elsewhere
    (prisma.smsUnit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.smsShipmentLine.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ConfirmBody = {
      destinationLocationId: DEST_LOCATION_ID,
      batchNumber: BATCH,
      deliveryNoteNumber: DELIVERY_NOTE,
      lines: [{ vin: 'VIN12345678901235', sourceRows: [{ row: 2, values: {} }] }],
    };

    const result = await confirmImport(body, makeReq());

    expect(result.shipment.id).toBe(SHIPMENT_ID);
    expect(result.createdCount).toBe(1);
    expect(result.skipped).toHaveLength(0);
    // confirm shipment was NOT re-created
    expect((prisma.smsShipment.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('skips VINs that are already received units', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    (prisma.smsShipment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShipment);
    (prisma.smsShipmentLine.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // not in this shipment
      .mockResolvedValueOnce([]); // not elsewhere
    (prisma.smsUnit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { vin: 'VIN12345678901234' }, // already a unit
    ]);
    (prisma.smsShipmentLine.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    mockCreateAuditLog.mockResolvedValue(undefined);

    const body: ConfirmBody = {
      destinationLocationId: DEST_LOCATION_ID,
      batchNumber: BATCH,
      lines: [{ vin: 'VIN12345678901234', sourceRows: [{ row: 2, values: {} }] }],
    };

    const result = await confirmImport(body, makeReq());
    expect(result.skipped[0]!.reason).toMatch(/already exists as a received unit/i);
  });

  it('throws 422 for duplicate VINs in the payload', async () => {
    const body: ConfirmBody = {
      destinationLocationId: DEST_LOCATION_ID,
      batchNumber: BATCH,
      lines: [
        { vin: 'VIN12345678901234', sourceRows: [{ row: 2, values: {} }] },
        { vin: 'VIN12345678901234', sourceRows: [{ row: 3, values: {} }] }, // duplicate
      ],
    };

    await expect(confirmImport(body, makeReq())).rejects.toMatchObject({
      statusCode: 422,
      code: 'SMS_DUPLICATE_VIN_IN_PAYLOAD',
    });
  });
});

// ── receiveItems tests ────────────────────────────────────────────────────────

describe('receiveItems', () => {
  const LINE_ID_1 = 'line-uuid-1';
  const VIN_1 = 'VIN12345678901234';
  const VARIANT_ID = 'variant-uuid-1';

  const mockPendingLine = {
    id: LINE_ID_1,
    shipmentId: SHIPMENT_ID,
    vin: VIN_1,
    engineNumber: null,
    variantId: VARIANT_ID,
    receiptStatus: 'PENDING',
    unitId: null,
    discrepancyNotes: null,
    receivedAt: null,
    receivedByUserId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSmsAccess.mockReturnValue(mockAccess);
    mockAssertCan.mockReturnValue(undefined);
    mockFindShipmentById.mockResolvedValue(mockShipment);
    mockLockLines.mockResolvedValue(undefined);
    mockUpdateLine.mockResolvedValue({});
    mockCreateAuditLog.mockResolvedValue(undefined);
    mockGetShipmentCounts.mockResolvedValue(
      new Map([[SHIPMENT_ID, { expected: 1, receivedOk: 1, receivedDamaged: 0, discrepancy: 0, pending: 0 }]]),
    );
    setupRunIdempotent();
  });

  it('creates a unit for a pending line and returns it', async () => {
    const mockUnit = { id: 'unit-1', vin: VIN_1, status: 'AVAILABLE' };
    mockFindLockedLines.mockResolvedValue([mockPendingLine]);
    mockCreateUnitWithEvent.mockResolvedValue({ unit: mockUnit, event: {} });

    const result = await receiveItems(
      SHIPMENT_ID,
      { items: [{ lineId: LINE_ID_1, condition: 'OK' }] },
      makeReq(),
    );

    expect(result.received).toHaveLength(1);
    expect(result.received[0]!.unit.vin).toBe(VIN_1);
    expect(result.alreadyReceived).toHaveLength(0);
  });

  it('treats an already-received line as alreadyReceived without creating a second unit', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    const receivedLine = {
      ...mockPendingLine,
      receiptStatus: 'RECEIVED_OK',
      unitId: 'existing-unit-1',
    };
    mockFindLockedLines.mockResolvedValue([receivedLine]);
    (prisma.smsUnit.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'existing-unit-1',
      vin: VIN_1,
      status: 'AVAILABLE',
    });

    const result = await receiveItems(
      SHIPMENT_ID,
      { items: [{ lineId: LINE_ID_1, condition: 'OK' }] },
      makeReq(),
    );

    expect(result.alreadyReceived).toHaveLength(1);
    expect(result.alreadyReceived[0]!.unit.id).toBe('existing-unit-1');
    expect(result.received).toHaveLength(0);
    expect(mockCreateUnitWithEvent).not.toHaveBeenCalled();
  });

  it('throws 422 when variantId is missing for a pending line', async () => {
    const lineWithoutVariant = { ...mockPendingLine, variantId: null };
    mockFindLockedLines.mockResolvedValue([lineWithoutVariant]);

    await expect(
      receiveItems(
        SHIPMENT_ID,
        { items: [{ lineId: LINE_ID_1, condition: 'OK' }] },
        makeReq(),
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'SMS_RECEIVE_VALIDATION_FAILED',
    });

    expect(mockCreateUnitWithEvent).not.toHaveBeenCalled();
  });

  it('requires damageNotes for DAMAGED condition and creates an inspection', async () => {
    // The Zod schema rejects DAMAGED without damageNotes at the router level,
    // so here we test the service's inspection-creation path with valid input.
    const mockUnit = { id: 'unit-damaged', vin: VIN_1, status: 'INSPECTION' };
    const mockInspection = { id: 'insp-1' };

    mockFindLockedLines.mockResolvedValue([mockPendingLine]);
    mockCreateUnitWithEvent.mockResolvedValue({ unit: mockUnit, event: {} });
    mockCreateInspection.mockResolvedValue(mockInspection);
    mockRecordUnitEvent.mockResolvedValue({ unit: mockUnit, event: {} });

    const result = await receiveItems(
      SHIPMENT_ID,
      {
        items: [
          {
            lineId: LINE_ID_1,
            condition: 'DAMAGED',
            damageNotes: 'Dented front panel',
          },
        ],
      },
      makeReq(),
    );

    expect(result.received[0]!.unit.status).toBe('INSPECTION');
    expect(mockCreateInspection).toHaveBeenCalledOnce();
    expect(mockRecordUnitEvent).toHaveBeenCalledOnce();
    // Verify INSPECTION_STARTED event was recorded
    const eventCall = mockRecordUnitEvent.mock.calls[0];
    expect(eventCall![2]!.event.type).toBe('INSPECTION_STARTED');
  });

  it('throws 403 when the user lacks RECEIVING_MANAGE at the shipment destination', async () => {
    // The authorization helper throws — simulate a 403 with statusCode.
    const forbidden = Object.assign(new Error('Forbidden'), {
      statusCode: 403,
      code: 'SMS_FORBIDDEN_AT_LOCATION',
    });
    (access.assertCanActOn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw forbidden;
    });

    await expect(
      receiveItems(
        SHIPMENT_ID,
        { items: [{ lineId: LINE_ID_1, condition: 'OK' }] },
        makeReq(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
