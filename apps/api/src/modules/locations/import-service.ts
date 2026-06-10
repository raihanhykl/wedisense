import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import * as locationRepo from './repository.js';
import {
  parseLocationImportSheet,
  type ImportParseError,
} from './import-excel.js';

/**
 * Bulk-import Locations from an .xlsx buffer. Snipe-IT two-pass pattern:
 *
 *   Pass 1 — Validate + insert ALL rows without parent. We use the row's
 *            code as the stable identity key. Rows whose code already exists
 *            in the DB are reported as `skipped` (idempotent re-runs).
 *   Pass 2 — For each row that referenced a parent_code, look up the parent
 *            (newly inserted OR existing) and update the child's parentId.
 *            Cycle detection isn't needed here because pass-1 inserts every
 *            node as a root; the only way to form a cycle would be a row
 *            that points its parent_code at one of its own descendants in
 *            the same sheet — caught at pass-2 by the cyclic-parent guard
 *            we already have in the service.
 *
 * Sync-only by design — sheets for an internal AMS rarely exceed a few
 * hundred rows. The whole flow holds the request open.
 *
 * Cap: 500 rows per sheet. Larger drops are typically a sign the data needs
 * curation anyway.
 */

const MAX_ROWS = 500;

export interface ImportResult {
  /** Rows we inserted as new location records. */
  created: { rowIndex: number; id: string; name: string; code: string }[];
  /** Rows we left alone because a location with the same code already exists. */
  skipped: { rowIndex: number; code: string; reason: string }[];
  /** Rows we couldn't insert or wire up. */
  failed: { rowIndex: number; code: string; reason: string }[];
  /** Field-level parse/validation errors. When non-empty the whole sheet was
   *  rejected and no rows were committed. */
  parseErrors: ImportParseError[];
}

export async function importLocations(
  buffer: Buffer,
  userId: string,
): Promise<ImportResult> {
  const { rows, errors } = await parseLocationImportSheet(buffer);

  if (errors.length > 0) {
    return { created: [], skipped: [], failed: [], parseErrors: errors };
  }

  if (rows.length === 0) {
    throw new AppError(
      400,
      'EMPTY_SHEET',
      'No data rows found in the workbook. Check that the second row onwards is filled.',
    );
  }

  if (rows.length > MAX_ROWS) {
    throw new AppError(
      400,
      'TOO_MANY_ROWS',
      `Sheet has ${rows.length} rows; limit is ${MAX_ROWS}. Split the file and try again.`,
    );
  }

  // Pre-flight: which codes already exist in the DB?  This is a single
  // batched query — we'll either skip or re-use them in pass 2.
  const codes = rows.map((r) => r.code);
  const existing = await prisma.location.findMany({
    where: { code: { in: codes }, deletedAt: null },
    select: { id: true, code: true },
  });
  const existingByCode = new Map(existing.map((l) => [l.code, l.id]));

  const result: ImportResult = {
    created: [],
    skipped: [],
    failed: [],
    parseErrors: [],
  };

  // Map from code → id for parents we'll need in pass 2. Seeded with
  // existing-in-DB locations so a row referencing an already-installed
  // parent works without inserting it first.
  const codeToId = new Map<string, string>(existingByCode);

  // ── Pass 1: insert all rows as root ──────────────────────────────────
  // We do this row-by-row (rather than one big batch) so a single failure
  // doesn't abort the whole import. Per-row try/catch + result push mirrors
  // the bulkMoveAssets contract from the assets module.
  for (const row of rows) {
    if (existingByCode.has(row.code)) {
      result.skipped.push({
        rowIndex: row.rowIndex,
        code: row.code,
        reason: 'Location with this code already exists',
      });
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const inserted = await locationRepo.create(
          {
            name: row.name,
            code: row.code,
            type: row.type,
            address: row.address,
            city: row.city,
            province: row.province,
            isActive: row.isActive,
            // Pass-2 wires parents. Insert as root for now.
          },
          tx,
        );
        await tx.auditLog.create({
          data: {
            userId,
            action: 'CREATE',
            resourceType: 'Location',
            resourceId: inserted.id,
            newValues: { ...inserted, importedFromSheet: true } as unknown as Prisma.InputJsonValue,
          },
        });
        return inserted;
      });
      codeToId.set(created.code, created.id);
      result.created.push({
        rowIndex: row.rowIndex,
        id: created.id,
        name: created.name,
        code: created.code,
      });
    } catch (err) {
      result.failed.push({
        rowIndex: row.rowIndex,
        code: row.code,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // ── Pass 2: wire parent_code references ──────────────────────────────
  // Only rows that named a parent need a touch here. We look up the parent
  // in our codeToId map (which holds both freshly-inserted and pre-existing
  // locations). Rows whose parent_code didn't resolve get a soft failure —
  // the location was inserted in pass 1, just without a parent.
  const pass2Targets = rows.filter(
    (r) => r.parentCode && codeToId.has(r.code), // skipped rows have no id to wire
  );

  for (const row of pass2Targets) {
    const parentId = codeToId.get(row.parentCode!);
    const childId = codeToId.get(row.code);
    if (!parentId) {
      result.failed.push({
        rowIndex: row.rowIndex,
        code: row.code,
        reason: `Parent code "${row.parentCode}" not found in this sheet or in the existing locations.`,
      });
      continue;
    }
    if (!childId) continue;
    if (parentId === childId) {
      result.failed.push({
        rowIndex: row.rowIndex,
        code: row.code,
        reason: 'Parent code refers to the same row — cannot self-parent.',
      });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await locationRepo.update(
          childId,
          { parent: { connect: { id: parentId } } },
          tx,
        );
        await tx.auditLog.create({
          data: {
            userId,
            action: 'UPDATE',
            resourceType: 'Location',
            resourceId: childId,
            oldValues: { parentId: null } as unknown as Prisma.InputJsonValue,
            newValues: {
              parentId,
              importedParentLink: true,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (err) {
      result.failed.push({
        rowIndex: row.rowIndex,
        code: row.code,
        reason:
          err instanceof Error
            ? `Could not link parent: ${err.message}`
            : 'Could not link parent',
      });
    }
  }

  return result;
}
