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
  getStaleBookings: vi.fn(),
  getAwaitingPickup: vi.fn(),
  getOverdueShowUnits: vi.fn(),
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
const mockGetStaleBookings = dashboardRepo.getStaleBookings as ReturnType<typeof vi.fn>;
const mockGetAwaitingPickup = dashboardRepo.getAwaitingPickup as ReturnType<typeof vi.fn>;
const mockGetOverdueShowUnits = dashboardRepo.getOverdueShowUnits as ReturnType<typeof vi.fn>;

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
        showUnit: 1,
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
      showUnit: 1,
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
      inspection: 0, custody: 0, identityMismatch: 0, outside: 0, showUnit: 0, expected: 0,
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

    mockGetStaleBookings.mockResolvedValue({ data: [], total: 0 });
    mockGetAwaitingPickup.mockResolvedValue({ data: [], total: 0 });
    mockGetOverdueShowUnits.mockResolvedValue({ data: [], total: 0 });

    const tasks = await dashboardService.getDashboardTasks(SHOWROOM_A, showroomWithView);
    expect(tasks.openShipments.total).toBe(1);
    expect(tasks.inspections.total).toBe(1);
    expect(tasks.identityMismatches.total).toBe(1);
    expect(tasks.staleBookings.total).toBe(0);
    expect(tasks.awaitingPickup.total).toBe(0);
    expect(tasks.overdueShowUnits.total).toBe(0);
  });

  it('returns stale bookings and awaiting pickup tasks', async () => {
    mockGetOpenShipments.mockResolvedValue({ data: [], total: 0 });
    mockGetInspectionUnits.mockResolvedValue({ data: [], total: 0 });
    mockGetIdentityMismatchUnits.mockResolvedValue({ data: [], total: 0 });

    const staleBooking = {
      id: 'ol-1',
      orderId: 'o-1',
      spk: 'SPK-001',
      vin: 'VIN001',
      salesName: 'Sales A',
      bookedAt: new Date('2026-11-10T00:00:00Z'),
      followUpAt: new Date('2026-11-15T00:00:00Z'),
      daysSinceBooking: 10,
    };
    mockGetStaleBookings.mockResolvedValue({ data: [staleBooking], total: 1 });

    const awaitingPickupItem = {
      id: 'ol-2',
      orderId: 'o-2',
      spk: 'SPK-002',
      vin: 'VIN002',
      soldAt: new Date('2026-11-18T00:00:00Z'),
      daysWaiting: 2,
    };
    mockGetAwaitingPickup.mockResolvedValue({ data: [awaitingPickupItem], total: 1 });

    const overdueShowUnit = {
      loanId: 'sl-1',
      vin: 'VIN003',
      eventName: 'Jakarta Fair',
      pic: { id: 'pic-1', name: 'PIC Name' },
      expectedReturnDate: new Date('2026-11-19T00:00:00Z'),
      daysOverdue: 1,
    };
    mockGetOverdueShowUnits.mockResolvedValue({ data: [overdueShowUnit], total: 1 });

    const tasks = await dashboardService.getDashboardTasks(SHOWROOM_A, showroomWithView);
    expect(tasks.staleBookings.total).toBe(1);
    expect(tasks.staleBookings.data[0]?.spk).toBe('SPK-001');
    expect(tasks.awaitingPickup.total).toBe(1);
    expect(tasks.awaitingPickup.data[0]?.vin).toBe('VIN002');
    expect(tasks.overdueShowUnits.total).toBe(1);
    expect(tasks.overdueShowUnits.data[0]?.daysOverdue).toBe(1);
  });
});
