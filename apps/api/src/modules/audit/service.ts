import type { Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import {
  buildAuditWhere,
  countAuditLogs,
  findAuditLogById,
  listAuditLogs,
  listAuditLogsBatch,
} from './repository.js';
import type { AuditLogListQuery, AuditLogFilter } from './schema.js';
import type { AuditLogDto } from './types.js';

/** Hard cap for CSV export. Above this, the user should narrow the filter
 *  rather than wait for a 100k-row file. Streamed write keeps memory flat
 *  but Postgres still has to scan the rows; an unbounded export turns into
 *  a slow query under load. */
export const EXPORT_MAX_ROWS = 50_000;

/** Page size for the export's internal cursor loop. Tuned for a reasonable
 *  network-vs-memory balance: 500 rows fits comfortably in memory while
 *  amortising the round-trip cost of cursor pagination. */
const EXPORT_PAGE_SIZE = 500;

// ── List ─────────────────────────────────────────────────────────────────────

function toListDto(row: Awaited<ReturnType<typeof listAuditLogs>>[number]): AuditLogDto {
  return {
    id: row.id,
    userId: row.userId,
    user: row.user
      ? { id: row.user.id, name: row.user.name, email: row.user.email }
      : null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    // List response omits the heavy payloads; detail endpoint returns them.
    oldValues: null,
    newValues: null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAuditLogsPaginated(query: AuditLogListQuery) {
  const { skip, take, page, limit } = parsePagination(query);
  const where = buildAuditWhere(extractFilter(query));
  const [rows, total] = await Promise.all([
    listAuditLogs(where, skip, take),
    countAuditLogs(where),
  ]);
  return {
    items: rows.map(toListDto),
    meta: buildPaginationMeta(page, limit, total),
  };
}

// ── Detail ───────────────────────────────────────────────────────────────────

export async function getAuditLog(id: string): Promise<AuditLogDto> {
  const row = await findAuditLogById(id);
  if (!row) {
    throw new AppError(404, 'AUDIT_LOG_NOT_FOUND', 'Audit log not found');
  }
  return {
    id: row.id,
    userId: row.userId,
    user: row.user
      ? { id: row.user.id, name: row.user.name, email: row.user.email }
      : null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    oldValues: row.oldValues,
    newValues: row.newValues,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── CSV export ───────────────────────────────────────────────────────────────

/**
 * Stream audit rows to the response as CSV. We chunk via cursor pagination
 * (not skip/take) so the database doesn't have to count past N rows for
 * every page — important once the table is into the millions.
 *
 * The stream writes the header row, then loops batches until either:
 *   - The query exhausts, or
 *   - We hit EXPORT_MAX_ROWS (in which case we append a trailing comment
 *     row noting truncation).
 *
 * Each cell is properly CSV-escaped: double-quote wrap if the value
 * contains a comma, newline, or double-quote, with embedded double-quotes
 * doubled. We use a single hand-rolled escaper rather than pull in a CSV
 * library — the format is simple enough that the dependency cost isn't
 * worth it.
 */
export async function streamAuditCsv(
  filter: AuditLogFilter,
  actorUserId: string,
  res: Response,
): Promise<void> {
  const where = buildAuditWhere(filter);

  const filename = `audit-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // BOM so Excel opens it as UTF-8 without prompting.
  res.write('﻿');
  res.write(
    'timestamp,user_id,user_name,user_email,action,resource_type,resource_id,ip_address,user_agent,old_values,new_values\n',
  );

  let cursor: string | null = null;
  let written = 0;
  let truncated = false;

  // Pull pages until exhausted or cap hit. We intentionally bail BEFORE
  // writing more than EXPORT_MAX_ROWS rows — the trailing comment row in
  // the truncated branch tells the user the cap was reached.
  while (written < EXPORT_MAX_ROWS) {
    const remaining = EXPORT_MAX_ROWS - written;
    const take = Math.min(EXPORT_PAGE_SIZE, remaining);
    const batch = await listAuditLogsBatch(where, cursor, take);
    if (batch.length === 0) break;

    for (const row of batch) {
      res.write(
        [
          row.createdAt.toISOString(),
          row.userId ?? '',
          row.user?.name ?? '',
          row.user?.email ?? '',
          row.action,
          row.resourceType,
          row.resourceId,
          row.ipAddress ?? '',
          row.userAgent ?? '',
          row.oldValues == null ? '' : JSON.stringify(row.oldValues),
          row.newValues == null ? '' : JSON.stringify(row.newValues),
        ]
          .map(csvCell)
          .join(',') + '\n',
      );
    }

    written += batch.length;
    const lastRow = batch[batch.length - 1];
    if (batch.length < take || !lastRow) break;
    cursor = lastRow.id;

    if (written >= EXPORT_MAX_ROWS) {
      truncated = true;
    }
  }

  if (truncated) {
    // CSV-comment style trailing notice — most spreadsheets show this as
    // a normal cell, which is fine. We could also surface this in a
    // response header but headers must precede body; once we've written
    // the body it's too late.
    res.write(
      `# Truncated at ${EXPORT_MAX_ROWS} rows. Narrow the filter to capture older entries.\n`,
    );
  }

  // Audit the export itself. The /export endpoint is in the inventory as
  // "audited: true" via this call. We swallow audit failures because the
  // CSV stream has already gone over the wire; failing the response after
  // the fact would just leave the user with a broken file download.
  try {
    await prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'EXPORT',
        resourceType: 'AuditLog',
        resourceId: 'bulk',
        newValues: {
          rowCount: written,
          truncated,
          filter,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('[audit] EXPORT audit-of-audit write failed', err);
  }

  res.end();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pull only the filter fields out of a list-query object, leaving pagination
 *  fields behind. Keeps `buildAuditWhere` from accidentally receiving page/limit. */
function extractFilter(query: AuditLogListQuery): AuditLogFilter {
  const { page: _p, limit: _l, ...rest } = query;
  void _p;
  void _l;
  return rest;
}

/** CSV cell escape per RFC 4180. */
function csvCell(value: string): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
