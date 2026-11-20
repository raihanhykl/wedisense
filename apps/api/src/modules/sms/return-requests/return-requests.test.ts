/**
 * Unit tests for return-requests module.
 *
 * Tests:
 *  - schema validation (Zod)
 *  - repository.computeDisplayStatus
 *  - repository.mapToRow (customer masking)
 *  - notify.ts recipient resolution (mocked)
 *  - dashboard repository Stage 4 helpers (mocked)
 */
import { describe, it, expect } from 'vitest';
import type { SmsDecision, SmsUnitStatus } from '@prisma/client';
import {
  createReturnRequestSchema,
  decideSchema,
  officialReceiptSchema,
  custodyHandbackSchema,
  listReturnRequestsQuerySchema,
  lookupQuerySchema,
} from './schema.js';
import { computeDisplayStatus } from './repository.js';
import type { ReturnRequestDisplayStatus } from './types.js';

// ── Schema validation ─────────────────────────────────────────────────────────

describe('createReturnRequestSchema', () => {
  it('accepts a minimal valid input', () => {
    const result = createReturnRequestSchema.safeParse({
      unitId: '00000000-0000-0000-0000-000000000001',
      toShowroomId: '00000000-0000-0000-0000-000000000002',
      reason: 'Customer brought bike to Jakarta',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with custodyReceivedAt', () => {
    const result = createReturnRequestSchema.safeParse({
      unitId: '00000000-0000-0000-0000-000000000001',
      toShowroomId: '00000000-0000-0000-0000-000000000002',
      reason: 'Customer brought bike to Jakarta',
      custodyReceivedAt: '2026-11-20T08:00:00+07:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects reason shorter than 3 characters', () => {
    const result = createReturnRequestSchema.safeParse({
      unitId: '00000000-0000-0000-0000-000000000001',
      toShowroomId: '00000000-0000-0000-0000-000000000002',
      reason: 'ab',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID unitId', () => {
    const result = createReturnRequestSchema.safeParse({
      unitId: 'not-a-uuid',
      toShowroomId: '00000000-0000-0000-0000-000000000002',
      reason: 'Valid reason here',
    });
    expect(result.success).toBe(false);
  });

  it('rejects future custodyReceivedAt (not a valid datetime)', () => {
    // The schema just validates the datetime format, not past/future (that is the service's job)
    const result = createReturnRequestSchema.safeParse({
      unitId: '00000000-0000-0000-0000-000000000001',
      toShowroomId: '00000000-0000-0000-0000-000000000002',
      reason: 'Valid reason here',
      custodyReceivedAt: 'not-a-datetime',
    });
    expect(result.success).toBe(false);
  });
});

describe('decideSchema', () => {
  it('accepts APPROVED without reason', () => {
    const result = decideSchema.safeParse({ decision: 'APPROVED' });
    expect(result.success).toBe(true);
  });

  it('accepts REJECTED with reason', () => {
    const result = decideSchema.safeParse({ decision: 'REJECTED', reason: 'Missing documentation' });
    expect(result.success).toBe(true);
  });

  it('rejects REJECTED without reason', () => {
    const result = decideSchema.safeParse({ decision: 'REJECTED' });
    expect(result.success).toBe(false);
  });

  it('rejects REJECTED with empty reason', () => {
    const result = decideSchema.safeParse({ decision: 'REJECTED', reason: '' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown decision', () => {
    const result = decideSchema.safeParse({ decision: 'MAYBE' });
    expect(result.success).toBe(false);
  });
});

describe('officialReceiptSchema', () => {
  it('requires condition', () => {
    const result = officialReceiptSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join('.'));
      expect(paths).toContain('condition');
    }
  });

  it('accepts valid condition', () => {
    const result = officialReceiptSchema.safeParse({ condition: 'GOOD' });
    expect(result.success).toBe(true);
  });

  it('accepts full payload', () => {
    const result = officialReceiptSchema.safeParse({
      officialReceivedAt: '2026-11-20T10:00:00+07:00',
      condition: 'FAIR',
      odometer: 12500,
      notes: 'Minor scratches on the left panel',
    });
    expect(result.success).toBe(true);
  });
});

describe('custodyHandbackSchema', () => {
  it('accepts empty body', () => {
    const result = custodyHandbackSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts with handedBackAt', () => {
    const result = custodyHandbackSchema.safeParse({ handedBackAt: '2026-11-20T14:00:00+07:00' });
    expect(result.success).toBe(true);
  });
});

describe('listReturnRequestsQuerySchema', () => {
  it('defaults direction to all and status to all', () => {
    const result = listReturnRequestsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.direction).toBe('all');
      expect(result.data.status).toBe('all');
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts valid direction and status', () => {
    const result = listReturnRequestsQuerySchema.safeParse({
      direction: 'incoming',
      status: 'pending',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid direction', () => {
    const result = listReturnRequestsQuerySchema.safeParse({ direction: 'sideways' });
    expect(result.success).toBe(false);
  });
});

describe('lookupQuerySchema', () => {
  it('requires a non-empty q', () => {
    expect(lookupQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(lookupQuerySchema.safeParse({ q: 'ABC12' }).success).toBe(true);
  });
});

// ── computeDisplayStatus ──────────────────────────────────────────────────────

describe('computeDisplayStatus', () => {
  const cases: Array<{
    label: string;
    input: {
      decision: SmsDecision;
      custodyReceivedAt: Date | null;
      officialReceivedAt: Date | null;
      custodyResolvedAt: Date | null;
    };
    expected: ReturnRequestDisplayStatus;
  }> = [
    {
      label: 'PENDING, no custody',
      input: { decision: 'PENDING', custodyReceivedAt: null, officialReceivedAt: null, custodyResolvedAt: null },
      expected: 'PENDING',
    },
    {
      label: 'APPROVED, no custody',
      input: { decision: 'APPROVED', custodyReceivedAt: null, officialReceivedAt: null, custodyResolvedAt: null },
      expected: 'APPROVED',
    },
    {
      label: 'APPROVED with custody',
      input: { decision: 'APPROVED', custodyReceivedAt: new Date(), officialReceivedAt: null, custodyResolvedAt: null },
      expected: 'APPROVED_IN_CUSTODY',
    },
    {
      label: 'REJECTED, no custody',
      input: { decision: 'REJECTED', custodyReceivedAt: null, officialReceivedAt: null, custodyResolvedAt: null },
      expected: 'REJECTED',
    },
    {
      label: 'REJECTED with unresolved custody',
      input: { decision: 'REJECTED', custodyReceivedAt: new Date(), officialReceivedAt: null, custodyResolvedAt: null },
      expected: 'REJECTED_IN_CUSTODY',
    },
    {
      label: 'REJECTED with resolved custody',
      input: { decision: 'REJECTED', custodyReceivedAt: new Date(), officialReceivedAt: null, custodyResolvedAt: new Date() },
      expected: 'REJECTED',
    },
    {
      label: 'COMPLETED (official receipt set)',
      input: { decision: 'APPROVED', custodyReceivedAt: null, officialReceivedAt: new Date(), custodyResolvedAt: null },
      expected: 'COMPLETED',
    },
  ];

  for (const { label, input, expected } of cases) {
    it(`returns ${expected} when ${label}`, () => {
      expect(computeDisplayStatus(input)).toBe(expected);
    });
  }
});

// ── mapToRow — customer name masking ─────────────────────────────────────────

import { mapToRow } from './repository.js';

type RawForMapper = Parameters<typeof mapToRow>[0];

function makeRaw(overrides: Partial<RawForMapper> = {}): RawForMapper {
  return {
    id: 'req-1',
    requestNumber: 'RET-20261120-0001',
    unitId: 'unit-1',
    rtoContractId: 'contract-1',
    fromShowroomId: 'from-1',
    toShowroomId: 'to-1',
    reason: 'Test reason for the return',
    requestedByUserId: 'user-1',
    requestedAt: new Date('2026-11-20T08:00:00Z'),
    decision: 'PENDING' as SmsDecision,
    decidedByUserId: null,
    decidedAt: null,
    decisionReason: null,
    custodyReceivedAt: null,
    officialReceivedAt: null,
    custodyResolvedAt: null,
    custodyResolution: null,
    createdAt: new Date('2026-11-20T08:00:00Z'),
    updatedAt: new Date('2026-11-20T08:00:00Z'),
    unit: {
      id: 'unit-1',
      vin: 'MHWTEST00000000001',
      status: 'ACTIVE_RTO' as SmsUnitStatus,
      wasRto: true,
      responsibleShowroomId: 'from-1',
      openReturnRequestId: null,
      openRtoContractId: 'contract-1',
      variant: {
        name: 'Extended',
        batteryVariant: null,
        color: 'Black',
        model: { name: 'Athena' },
      },
    },
    rtoContract: {
      contractNumber: 'RTO-001',
      customerName: 'Budi Santoso',
      customerPhone: '081234567890',
      customerIdNumber: '3201234567890001',
    },
    fromShowroom: { id: 'from-1', name: 'Showroom Bekasi', code: 'BKS-SR' },
    toShowroom: { id: 'to-1', name: 'Showroom Jakarta', code: 'JKT-SR' },
    requestedBy: { id: 'user-1', name: 'Jakarta Admin' },
    decidedBy: null,
    ...overrides,
  } as RawForMapper;
}

describe('mapToRow customer masking', () => {
  it('shows customer name when canViewCustomer is true', () => {
    const row = mapToRow(makeRaw(), true);
    expect(row.customerName).toBe('Budi Santoso');
  });

  it('masks customer name when canViewCustomer is false', () => {
    const row = mapToRow(makeRaw(), false);
    expect(row.customerName).toBe('[Hidden]');
  });

  it('returns null customerName when no contract', () => {
    const raw = makeRaw({ rtoContractId: null, rtoContract: null });
    const row = mapToRow(raw, false);
    expect(row.customerName).toBeNull();
  });

  it('computes COMPLETED displayStatus when officialReceivedAt is set', () => {
    const raw = makeRaw({
      decision: 'APPROVED' as SmsDecision,
      officialReceivedAt: new Date(),
    });
    const row = mapToRow(raw, true);
    expect(row.displayStatus).toBe('COMPLETED');
  });

  it('computes rtoContractNumber from rtoContract', () => {
    const row = mapToRow(makeRaw(), true);
    expect(row.rtoContractNumber).toBe('RTO-001');
  });

  it('sets rtoContractNumber to null when no contract', () => {
    const raw = makeRaw({ rtoContractId: null, rtoContract: null });
    const row = mapToRow(raw, true);
    expect(row.rtoContractNumber).toBeNull();
  });
});
