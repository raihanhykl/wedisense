import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type { AuditLogFilter } from './schema.js';

/**
 * Translate the API filter shape into a Prisma `where` clause.
 *
 * Each field is appended only when set; absent filters do nothing — the
 * default behaviour returns every audit row. The `search` filter does a
 * case-insensitive prefix match across the three columns most useful for
 * incident response (resourceId, ipAddress, userAgent). It does NOT search
 * the JSONB payloads because:
 *
 *   1. A JSONB ILIKE scan on a 6-figure-row table is slow.
 *   2. JSONB contents are model-specific and not what humans search for.
 *   3. The detail drawer renders the full payload anyway.
 */
export function buildAuditWhere(filter: AuditLogFilter): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.action) where.action = filter.action;
  if (filter.resourceType) where.resourceType = filter.resourceType;
  if (filter.resourceId) where.resourceId = filter.resourceId;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {
      ...(filter.dateFrom && { gte: filter.dateFrom }),
      ...(filter.dateTo && { lte: filter.dateTo }),
    };
  }
  if (filter.search) {
    const search = filter.search;
    where.OR = [
      { resourceId: { contains: search, mode: 'insensitive' } },
      { ipAddress: { contains: search, mode: 'insensitive' } },
      { userAgent: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * The list selection deliberately does NOT include oldValues/newValues —
 * those columns can be large (full diff of an asset edit) and the table
 * view only renders 8 columns of summary. The detail drawer fetches the
 * full row separately via /:id. This keeps list responses under ~5 KB even
 * for 100-row pages.
 */
const LIST_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, name: true, email: true } },
  action: true,
  resourceType: true,
  resourceId: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const;

export function listAuditLogs(
  where: Prisma.AuditLogWhereInput,
  skip: number,
  take: number,
) {
  return prisma.auditLog.findMany({
    where,
    select: LIST_SELECT,
    orderBy: { createdAt: 'desc' },
    skip,
    take,
  });
}

export function countAuditLogs(where: Prisma.AuditLogWhereInput) {
  return prisma.auditLog.count({ where });
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function findAuditLogById(id: string) {
  return prisma.auditLog.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

// ── Export stream ────────────────────────────────────────────────────────────

/**
 * Stream-friendly query: returns a Prisma findMany that callers can iterate
 * via a cursor or paged loop. The route layer chunks through this in
 * batches rather than loading the entire result set into memory, so a
 * 50,000-row export doesn't OOM on a small Node instance.
 *
 * We include the full payloads here because that's what the CSV needs.
 */
const EXPORT_SELECT = {
  id: true,
  userId: true,
  user: { select: { name: true, email: true } },
  action: true,
  resourceType: true,
  resourceId: true,
  oldValues: true,
  newValues: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const;

export function listAuditLogsBatch(
  where: Prisma.AuditLogWhereInput,
  cursor: string | null,
  take: number,
) {
  return prisma.auditLog.findMany({
    where,
    select: EXPORT_SELECT,
    orderBy: { createdAt: 'desc' },
    // Stable secondary sort on id so the cursor doesn't skip rows that
    // share a millisecond timestamp.
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    take,
  });
}
