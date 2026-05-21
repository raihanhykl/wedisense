import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { LocationListFilters } from './types.js';

// Subset of the Prisma client surface exposed inside a $transaction callback.
// Letting create/update/softDelete accept this so service-layer atomic writes
// can stitch them together with the matching audit-log insert.
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function buildWhereClause(filters: LocationListFilters): Prisma.LocationWhereInput {
  const where: Prisma.LocationWhereInput = { deletedAt: null };

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { code: { contains: filters.search, mode: 'insensitive' } },
      { city: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export async function findMany(
  filters: LocationListFilters,
  skip: number,
  take: number,
) {
  const where = buildWhereClause(filters);

  const [data, total] = await Promise.all([
    prisma.location.findMany({
      where,
      skip,
      take,
      orderBy: { name: 'asc' },
    }),
    prisma.location.count({ where }),
  ]);

  return { data, total };
}

export async function findById(id: string) {
  return prisma.location.findFirst({
    where: { id, deletedAt: null },
    include: {
      parent: { select: { id: true, name: true, code: true } },
    },
  });
}

export async function create(
  data: Prisma.LocationCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).location.create({ data });
}

export async function update(
  id: string,
  data: Prisma.LocationUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).location.update({ where: { id }, data });
}

export async function softDelete(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).location.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function hasAssets(id: string): Promise<boolean> {
  const count = await prisma.asset.count({
    where: { locationId: id, deletedAt: null },
  });
  return count > 0;
}

/**
 * Return the IDs of assets pinned *directly* to a location (not its
 * descendants). Used by the archive flow to feed bulkMoveAssets. Capped
 * at 500 to stay within the bulk-move endpoint's reasonable limit; if a
 * location ever holds more, the UI surfaces a clear error and the user
 * needs to split the migration manually.
 */
export async function findDirectAssetIds(locationId: string): Promise<string[]> {
  const rows = await prisma.asset.findMany({
    where: { locationId, deletedAt: null },
    select: { id: true },
    take: 500,
  });
  return rows.map((r) => r.id);
}

export async function findTree() {
  // Single recursive CTE + LEFT JOIN to derive each location's *direct* asset
  // count (assets pinned to this exact location, not its subtree). The subtree
  // rollup happens in the service layer via JS post-order traversal — cheap
  // and keeps the SQL readable. Assets.location_id is indexed (FK) so the
  // GROUP BY is fast.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      code: string;
      type: string;
      parent_id: string | null;
      is_active: boolean;
      address: string | null;
      city: string | null;
      province: string | null;
      direct_asset_count: number;
    }>
  >`
    WITH RECURSIVE location_tree AS (
      SELECT id, name, code, type, parent_id, is_active, address, city, province, 0 AS depth
      FROM locations
      WHERE parent_id IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT l.id, l.name, l.code, l.type, l.parent_id, l.is_active, l.address, l.city, l.province, lt.depth + 1
      FROM locations l
      INNER JOIN location_tree lt ON l.parent_id = lt.id
      WHERE l.deleted_at IS NULL
    )
    SELECT
      lt.id, lt.name, lt.code, lt.type, lt.parent_id, lt.is_active,
      lt.address, lt.city, lt.province,
      COALESCE(ac.cnt, 0)::int AS direct_asset_count
    FROM location_tree lt
    LEFT JOIN (
      SELECT location_id, COUNT(*) AS cnt
      FROM assets
      WHERE deleted_at IS NULL
      GROUP BY location_id
    ) ac ON ac.location_id = lt.id
    ORDER BY lt.depth, lt.name
  `;

  return rows;
}

export async function findChildren(parentId: string) {
  return prisma.location.findMany({
    where: { parentId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
}

export async function findAncestors(id: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      code: string;
      type: string;
      parent_id: string | null;
      is_active: boolean;
      depth: number;
    }>
  >`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, code, type, parent_id, is_active, 0 AS depth
      FROM locations
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      UNION ALL
      SELECT l.id, l.name, l.code, l.type, l.parent_id, l.is_active, a.depth + 1
      FROM locations l
      INNER JOIN ancestors a ON l.id = a.parent_id
      WHERE l.deleted_at IS NULL
    )
    SELECT id, name, code, type, parent_id, is_active, depth
    FROM ancestors
    ORDER BY depth DESC
  `;

  return rows;
}

export async function findByCode(code: string, excludeId?: string) {
  const where: Prisma.LocationWhereInput = { code, deletedAt: null };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return prisma.location.findFirst({ where });
}

/**
 * Aggregate asset counts grouped by status, scoped to a single location
 * AND scoped to its entire descendant subtree (separately). Returns two
 * passes in one round-trip so the detail page can show both rollups
 * without a follow-up query.
 *
 * Returns shape: { status, direct_count, subtree_count } per status. Statuses
 * with zero counts are still included so the UI can render a stable legend.
 */
export async function findAssetSummary(locationId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      status: string;
      direct_count: number;
      subtree_count: number;
    }>
  >`
    WITH RECURSIVE descendant_ids AS (
      SELECT id FROM locations
      WHERE id = ${locationId}::uuid AND deleted_at IS NULL
      UNION ALL
      SELECT l.id FROM locations l
      INNER JOIN descendant_ids d ON l.parent_id = d.id
      WHERE l.deleted_at IS NULL
    )
    SELECT
      a.status::text AS status,
      COUNT(*) FILTER (WHERE a.location_id = ${locationId}::uuid)::int AS direct_count,
      COUNT(*)::int AS subtree_count
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND a.location_id IN (SELECT id FROM descendant_ids)
    GROUP BY a.status
    ORDER BY a.status
  `;
  return rows;
}
