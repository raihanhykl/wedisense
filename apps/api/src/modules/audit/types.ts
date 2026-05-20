import type { AuditAction } from '@prisma/client';

/**
 * DTO returned by /api/audit-logs and /api/audit-logs/:id.
 *
 * Why we hand-shape this rather than re-exporting the Prisma row: the
 * client-facing field names use camelCase consistently across the API, and
 * we serialise `createdAt` to ISO string at the boundary (Prisma gives a
 * Date object) so consumers get one consistent JSON shape regardless of
 * Express's date serialisation behaviour.
 */
export interface AuditLogDto {
  id: string;
  userId: string | null;
  user: { id: string; name: string; email: string } | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  oldValues: unknown | null;
  newValues: unknown | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Slim row shape used by the CSV exporter — only the fields the spreadsheet
 *  columns need, so the Prisma `select` doesn't pull large JSONB columns
 *  needlessly across the wire. */
export interface AuditLogExportRow {
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  // Full payload included for compliance — stringified at write time.
  oldValues: string;
  newValues: string;
}
