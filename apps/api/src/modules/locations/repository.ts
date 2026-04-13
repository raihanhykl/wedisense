import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { LocationListFilters } from './types.js';

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

export async function create(data: Prisma.LocationCreateInput) {
  return prisma.location.create({ data });
}

export async function update(id: string, data: Prisma.LocationUpdateInput) {
  return prisma.location.update({ where: { id }, data });
}

export async function softDelete(id: string) {
  return prisma.location.update({
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

export async function findTree() {
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
    SELECT id, name, code, type, parent_id, is_active, address, city, province
    FROM location_tree
    ORDER BY depth, name
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
