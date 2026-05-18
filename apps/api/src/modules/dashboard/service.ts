import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

// ── Date helpers ────────────────────────────────────────────────────────────

function startOfCurrentMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function nDaysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Build a Prisma-compatible array filter. When the scope is empty the user is
// unrestricted (SUPER_ADMIN / global ADMIN) — no location filter is applied.
function locationScope(accessibleLocationIds: string[]): Prisma.StringFilter | undefined {
  if (accessibleLocationIds.length === 0) return undefined;
  return { in: accessibleLocationIds };
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  totalAssets: number;
  totalAssetsLastMonth: number;
  totalBookValue: string;
  totalBookValueLastMonth: string;
  newAssetsThisMonth: number;
  byStatus: { status: string; count: number }[];
  byCondition: { condition: string; count: number }[];
}

export async function getSummary(
  _userId: string,
  accessibleLocationIds: string[],
): Promise<DashboardSummary> {
  const locFilter = locationScope(accessibleLocationIds);
  const baseWhere: Prisma.AssetWhereInput = {
    deletedAt: null,
    ...(locFilter && { locationId: locFilter }),
  };

  const startOfMonth = startOfCurrentMonth();

  const [
    totalAssets,
    totalAssetsLastMonth,
    bvNow,
    bvLastMonth,
    newAssetsThisMonth,
    byStatusRaw,
    byConditionRaw,
  ] = await Promise.all([
    prisma.asset.count({ where: baseWhere }),

    prisma.asset.count({
      where: {
        ...baseWhere,
        createdAt: { lt: startOfMonth },
      },
    }),

    prisma.asset.aggregate({
      where: { ...baseWhere, status: { not: 'DISPOSED' } },
      _sum: { currentBookValue: true },
    }),

    // Book value "last month" approximation: same filter but exclude assets created this month
    prisma.asset.aggregate({
      where: {
        ...baseWhere,
        status: { not: 'DISPOSED' },
        createdAt: { lt: startOfMonth },
      },
      _sum: { currentBookValue: true },
    }),

    prisma.asset.count({
      where: { ...baseWhere, createdAt: { gte: startOfMonth } },
    }),

    prisma.asset.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    }),

    prisma.asset.groupBy({
      by: ['condition'],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  return {
    totalAssets,
    totalAssetsLastMonth,
    totalBookValue: (bvNow._sum.currentBookValue ?? new Prisma.Decimal(0)).toString(),
    totalBookValueLastMonth: (bvLastMonth._sum.currentBookValue ?? new Prisma.Decimal(0)).toString(),
    newAssetsThisMonth,
    byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
    byCondition: byConditionRaw.map((r) => ({ condition: r.condition, count: r._count._all })),
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export interface DashboardAlerts {
  warrantyExpiring: number;
  loanOverdue: number;
  maintenanceDue: number;
  unreadNotifications: number;
}

export async function getAlerts(
  userId: string,
  accessibleLocationIds: string[],
): Promise<DashboardAlerts> {
  const locFilter = locationScope(accessibleLocationIds);
  const now = new Date();
  const in30Days = nDaysFromNow(30);
  const in7Days = nDaysFromNow(7);

  const assetLocWhere: Prisma.AssetWhereInput = {
    deletedAt: null,
    ...(locFilter && { locationId: locFilter }),
  };

  const [warrantyExpiring, loanOverdue, maintenanceDue, unreadNotifications] = await Promise.all([
    prisma.asset.count({
      where: {
        ...assetLocWhere,
        warrantyEndDate: { gte: now, lte: in30Days },
      },
    }),

    prisma.assetMovement.count({
      where: {
        movementType: 'LOAN_OUT',
        actualReturnDate: null,
        expectedReturnDate: { lt: now },
        ...(locFilter && {
          asset: { deletedAt: null, locationId: locFilter },
        }),
      },
    }),

    prisma.maintenanceSchedule.count({
      where: {
        isActive: true,
        nextDueDate: { gte: now, lte: in7Days },
        ...(locFilter && {
          asset: { deletedAt: null, locationId: locFilter },
        }),
      },
    }),

    prisma.notification.count({
      where: { userId, isRead: false },
    }),
  ]);

  return { warrantyExpiring, loanOverdue, maintenanceDue, unreadNotifications };
}

// ── Recent movements ─────────────────────────────────────────────────────────

export interface RecentMovementItem {
  id: string;
  referenceNumber: string;
  movementType: string;
  status: string;
  createdAt: Date;
  asset: { id: string; assetNumber: string; name: string };
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  fromLocation: { id: string; name: string } | null;
  toLocation: { id: string; name: string } | null;
  performedBy: { id: string; name: string };
}

export async function getRecentMovements(
  _userId: string,
  accessibleLocationIds: string[],
): Promise<RecentMovementItem[]> {
  const locFilter = locationScope(accessibleLocationIds);

  const movements = await prisma.assetMovement.findMany({
    where: {
      ...(locFilter && {
        asset: { deletedAt: null, locationId: locFilter },
      }),
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      referenceNumber: true,
      movementType: true,
      status: true,
      createdAt: true,
      asset: { select: { id: true, assetNumber: true, name: true } },
      fromUser: { select: { id: true, name: true } },
      toUser: { select: { id: true, name: true } },
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      performedBy: { select: { id: true, name: true } },
    },
  });

  return movements as RecentMovementItem[];
}

// ── Assets by location ───────────────────────────────────────────────────────

export interface AssetsByLocationItem {
  locationId: string | null;
  locationName: string;
  count: number;
}

export async function getAssetsByLocation(
  _userId: string,
  accessibleLocationIds: string[],
): Promise<AssetsByLocationItem[]> {
  const locFilter = locationScope(accessibleLocationIds);

  const grouped = await prisma.asset.groupBy({
    by: ['locationId'],
    where: {
      deletedAt: null,
      ...(locFilter && { locationId: locFilter }),
    },
    _count: { _all: true },
    orderBy: { _count: { locationId: 'desc' } },
    take: 10,
  });

  const locationIds = grouped
    .map((g) => g.locationId)
    .filter((id): id is string => id !== null);

  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, name: true },
  });

  const nameMap = new Map(locations.map((l) => [l.id, l.name]));

  return grouped.map((g) => ({
    locationId: g.locationId,
    locationName: g.locationId ? (nameMap.get(g.locationId) ?? 'Unknown') : 'Unknown',
    count: g._count._all,
  }));
}

// ── Assets by category ───────────────────────────────────────────────────────

export interface AssetsByCategoryItem {
  categoryId: string;
  categoryName: string;
  count: number;
}

export async function getAssetsByCategory(
  _userId: string,
  accessibleLocationIds: string[],
): Promise<AssetsByCategoryItem[]> {
  // Two-hop: asset → product → category.
  // Prisma groupBy cannot traverse nested relations, so we use a raw query.
  // bigint from COUNT is cast to number after a safe range check — asset counts
  // will never reach Number.MAX_SAFE_INTEGER in practice.
  const locFilter = locationScope(accessibleLocationIds);

  const rows = await prisma.$queryRaw<
    Array<{ categoryId: string; categoryName: string; count: bigint }>
  >(
    Prisma.sql`
      SELECT
        c.id           AS "categoryId",
        c.name         AS "categoryName",
        COUNT(a.id)    AS "count"
      FROM assets a
      JOIN products     p ON p.id          = a.product_id
      JOIN asset_categories c ON c.id     = p.category_id
      WHERE a.deleted_at IS NULL
      ${locFilter ? Prisma.sql`AND a.location_id = ANY(${accessibleLocationIds}::uuid[])` : Prisma.empty}
      GROUP BY c.id, c.name
      ORDER BY "count" DESC
      LIMIT 10
    `,
  );

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    count: Number(r.count),
  }));
}

// ── Depreciation summary ─────────────────────────────────────────────────────

export interface DepreciationByCategoryItem {
  categoryId: string;
  categoryName: string;
  purchasePrice: string;
  currentBookValue: string;
  depreciationPercent: number;
}

export interface DepreciationSummary {
  totalPurchasePrice: string;
  totalCurrentBookValue: string;
  totalDepreciation: string;
  byCategory: DepreciationByCategoryItem[];
}

export async function getDepreciationSummary(
  _userId: string,
  accessibleLocationIds: string[],
): Promise<DepreciationSummary> {
  const locFilter = locationScope(accessibleLocationIds);

  const nonDisposedWhere: Prisma.AssetWhereInput = {
    deletedAt: null,
    status: { not: 'DISPOSED' },
    ...(locFilter && { locationId: locFilter }),
  };

  // Round-trip 1: totals aggregate
  const totals = await prisma.asset.aggregate({
    where: nonDisposedWhere,
    _sum: { purchasePrice: true, currentBookValue: true },
  });

  // Round-trip 2: per-category raw aggregation (two-hop join)
  const categoryRows = await prisma.$queryRaw<
    Array<{
      categoryId: string;
      categoryName: string;
      purchasePrice: string;
      currentBookValue: string;
    }>
  >(
    Prisma.sql`
      SELECT
        c.id                          AS "categoryId",
        c.name                        AS "categoryName",
        COALESCE(SUM(a.purchase_price), 0)::text     AS "purchasePrice",
        COALESCE(SUM(a.current_book_value), 0)::text AS "currentBookValue"
      FROM assets a
      JOIN products     p ON p.id          = a.product_id
      JOIN asset_categories c ON c.id     = p.category_id
      WHERE a.deleted_at IS NULL
        AND a.status != 'DISPOSED'
      ${locFilter ? Prisma.sql`AND a.location_id = ANY(${accessibleLocationIds}::uuid[])` : Prisma.empty}
      GROUP BY c.id, c.name
      ORDER BY SUM(a.purchase_price) DESC NULLS LAST
    `,
  );

  const totalPP = totals._sum.purchasePrice ?? new Prisma.Decimal(0);
  const totalBV = totals._sum.currentBookValue ?? new Prisma.Decimal(0);
  const totalDepreciation = totalPP.sub(totalBV);

  const byCategory: DepreciationByCategoryItem[] = categoryRows.map((r) => {
    const pp = new Prisma.Decimal(r.purchasePrice);
    const bv = new Prisma.Decimal(r.currentBookValue);
    const depreciationPct =
      pp.isZero() ? 0 : pp.sub(bv).div(pp).mul(100).toDecimalPlaces(2).toNumber();

    return {
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      purchasePrice: pp.toString(),
      currentBookValue: bv.toString(),
      depreciationPercent: depreciationPct,
    };
  });

  return {
    totalPurchasePrice: totalPP.toString(),
    totalCurrentBookValue: totalBV.toString(),
    totalDepreciation: totalDepreciation.toString(),
    byCategory,
  };
}
