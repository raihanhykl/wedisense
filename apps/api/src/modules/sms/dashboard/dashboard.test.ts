import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    location: { findUnique: vi.fn() },
    smsShipmentLine: { count: vi.fn() },
    smsShipment: { findMany: vi.fn(), count: vi.fn() },
    smsUnit: { findMany: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('./repository.js', () => ({
  getVariantCounts: vi.fn(),
  countExpected: vi.fn(),
  aggregateTotals: vi.fn(),
  getOpenShipments: vi.fn(),
  getInspectionUnits: vi.fn(),
  getIdentityMismatchUnits: vi.fn(),
}));

import * as dashboardRepo from './repository.js';
import * as dashboardService from './service.js';
import type { SmsAccess } from '../lib/access.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';

const mockGetVariantCounts = dashboardRepo.getVariantCounts as ReturnType<typeof vi.fn>;
const mockCountExpected = dashboardRepo.countExpected as ReturnType<typeof vi.fn>;
const mockAggregateTotals = dashboardRepo.aggregateTotals as ReturnType<typeof vi.fn>;
const mockGetOpenShipments = dashboardRepo.getOpenShipments as ReturnType<typeof vi.fn>;
const mockGetInspectionUnits = dashboardRepo.getInspectionUnits as ReturnType<typeof vi.fn>;
const mockGetIdentityMismatchUnits = dashboardRepo.getIdentityMismatchUnits as ReturnType<typeof vi.fn>;

const SHOWROOM_A = 'showroom-a';

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

const showroomWithView = makeAccess({
  byLocation: { [SHOWROOM_A]: [SMS_PERMISSIONS.STOCK_VIEW] },
});

const showroomWithoutView = makeAccess({ byLocation: {} });

const mockShowroom = { id: SHOWROOM_A, code: 'SA', name: 'Showroom A' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getDashboardSummary ───────────────────────────────────────────────────────

describe('getDashboardSummary', () => {
  it('throws 403 when caller lacks STOCK_VIEW at the showroom', async () => {
    await expect(
      dashboardService.getDashboardSummary(SHOWROOM_A, showroomWithoutView),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns summary with totals and byVariant', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUnique = prisma.location.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue(mockShowroom);

    const variantRows = [
      {
        variantId: 'v-1',
        variantName: 'Beat',
        batteryVariant: null,
        color: 'Black',
        modelId: 'model-1',
        modelCode: 'BEAT',
        modelName: 'Honda Beat',
        physical: 5,
        ready: 3,
        booked: 1,
        soldPendingPickup: 0,
        inspection: 1,
        custody: 0,
        identityMismatch: 0,
        outside: 2,
      },
    ];
    const totals = {
      physical: 5,
      ready: 3,
      booked: 1,
      soldPendingPickup: 0,
      inspection: 1,
      custody: 0,
      identityMismatch: 0,
      outside: 2,
      expected: 4,
    };

    mockGetVariantCounts.mockResolvedValue(variantRows);
    mockCountExpected.mockResolvedValue(4);
    mockAggregateTotals.mockReturnValue(totals);

    const summary = await dashboardService.getDashboardSummary(SHOWROOM_A, showroomWithView);
    expect(summary.showroom).toEqual(mockShowroom);
    expect(summary.totals).toEqual(totals);
    expect(summary.byVariant).toHaveLength(1);
  });

  it('throws 404 when showroom does not exist', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    const mockFindUnique = prisma.location.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue(null);
    mockGetVariantCounts.mockResolvedValue([]);
    mockCountExpected.mockResolvedValue(0);
    mockAggregateTotals.mockReturnValue({
      physical: 0, ready: 0, booked: 0, soldPendingPickup: 0,
      inspection: 0, custody: 0, identityMismatch: 0, outside: 0, expected: 0,
    });

    await expect(
      dashboardService.getDashboardSummary(SHOWROOM_A, showroomWithView),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── getDashboardTasks ─────────────────────────────────────────────────────────

describe('getDashboardTasks', () => {
  it('throws 403 when caller lacks STOCK_VIEW at the showroom', async () => {
    await expect(
      dashboardService.getDashboardTasks(SHOWROOM_A, showroomWithoutView),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns open shipments, inspections, and identity mismatches', async () => {
    mockGetOpenShipments.mockResolvedValue({
      data: [{ id: 's-1', batchNumber: 'B001', deliveryNoteNumber: 'SJ001', expectedCount: 5, receivedCount: 3, pendingCount: 2, createdAt: new Date() }],
      total: 1,
    });
    mockGetInspectionUnits.mockResolvedValue({
      data: [{ unitId: 'u-1', vin: 'VIN001', variantLabel: 'Honda Beat · Standard · Black', latestInspectionResult: 'PENDING' }],
      total: 1,
    });
    mockGetIdentityMismatchUnits.mockResolvedValue({
      data: [{ unitId: 'u-2', vin: 'VIN002', variantLabel: 'Honda Beat · Standard · Red' }],
      total: 1,
    });

    const tasks = await dashboardService.getDashboardTasks(SHOWROOM_A, showroomWithView);
    expect(tasks.openShipments.total).toBe(1);
    expect(tasks.inspections.total).toBe(1);
    expect(tasks.identityMismatches.total).toBe(1);
  });
});
