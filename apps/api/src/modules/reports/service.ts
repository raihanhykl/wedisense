import { Prisma } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { reportGenerateQueue } from '../../lib/queue.js';
import { storage } from '../../lib/storage.js';
import { generateReport } from './generators/index.js';
import * as repo from './repository.js';
import type { CreateReportInput, UpdateReportInput, ListQuery } from './schema.js';
import type { GenerateReportJobPayload } from './types.js';

const ASYNC_THRESHOLD_ROWS = 5000;

// ── List reports ─────────────────────────────────────────────────────

export async function listReports(
  userId: string,
  isAdmin: boolean,
  query: ListQuery,
) {
  const { page, limit, type, status } = query;
  const { skip, take } = parsePagination({ page, limit });

  const where: Prisma.ReportWhereInput = {};

  // Non-admins only see their own reports
  if (!isAdmin) {
    where.createdByUserId = userId;
  }

  if (type) where.type = type;
  if (status) where.status = status;

  const [reports, total] = await Promise.all([
    repo.findMany({ skip, take, where }),
    repo.count(where),
  ]);

  return { reports, meta: buildPaginationMeta(page, limit, total) };
}

// ── Get single report ─────────────────────────────────────────────────

export async function getReport(id: string, userId: string, isAdmin: boolean) {
  const report = await repo.findById(id);
  if (!report) {
    throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  }

  if (!isAdmin && report.createdByUserId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this report');
  }

  return report;
}

// ── Create report ─────────────────────────────────────────────────────

export async function createReport(input: CreateReportInput, userId: string) {
  const report = await repo.create({
    name: input.name,
    type: input.type,
    parameters: (input.parameters ?? {}) as unknown as Prisma.InputJsonValue,
    schedule: input.schedule ?? null,
    status: 'PENDING',
    createdBy: { connect: { id: userId } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      resourceType: 'Report',
      resourceId: report.id,
      newValues: { name: input.name, type: input.type } as unknown as Prisma.InputJsonValue,
    },
  });

  return report;
}

// ── Update report ─────────────────────────────────────────────────────

export async function updateReport(
  id: string,
  input: UpdateReportInput,
  userId: string,
  isAdmin: boolean,
) {
  const existing = await getReport(id, userId, isAdmin);

  const data: Prisma.ReportUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.parameters !== undefined) data.parameters = input.parameters as unknown as Prisma.InputJsonValue;
  if (input.schedule !== undefined) data.schedule = input.schedule ?? null;

  const updated = await repo.update(id, data);

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'UPDATE',
      resourceType: 'Report',
      resourceId: id,
      oldValues: { name: existing.name, type: existing.type } as unknown as Prisma.InputJsonValue,
      newValues: { name: updated.name, type: updated.type } as unknown as Prisma.InputJsonValue,
    },
  });

  return updated;
}

// ── Delete report ─────────────────────────────────────────────────────

export async function deleteReport(id: string, userId: string, isAdmin: boolean) {
  const existing = await getReport(id, userId, isAdmin);

  // Delete the file if present
  if (existing.fileUrl) {
    const relativePath = existing.fileUrl.replace('/uploads/', '');
    await storage.delete(relativePath).catch(() => {
      // Non-critical: file may already be gone
    });
  }

  await repo.remove(id);

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'DELETE',
      resourceType: 'Report',
      resourceId: id,
      oldValues: { name: existing.name, type: existing.type } as unknown as Prisma.InputJsonValue,
    },
  });
}

// ── Trigger generation ────────────────────────────────────────────────

export async function triggerGenerate(
  id: string,
  format: 'excel' | 'pdf',
  userId: string,
  isAdmin: boolean,
) {
  const report = await getReport(id, userId, isAdmin);

  if (report.status === 'GENERATING') {
    throw new AppError(409, 'REPORT_GENERATING', 'Report generation is already in progress');
  }

  // Estimate row count for sync/async decision
  const rowCount = await estimateRowCount(report.type, report.parameters as Record<string, unknown>);

  if (rowCount < ASYNC_THRESHOLD_ROWS) {
    // Sync path — generate immediately
    await repo.updateStatus(id, 'GENERATING');
    try {
      const buffer = await generateReport(report.type, format, report.parameters as Record<string, unknown>);
      const ext = format === 'pdf' ? 'pdf' : 'xlsx';
      const relPath = `reports/${id}.${ext}`;
      const fileUrl = await storage.save(relPath, buffer);

      await repo.updateStatus(id, 'READY', { fileUrl, lastGeneratedAt: new Date() });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'EXPORT',
          resourceType: 'Report',
          resourceId: id,
          newValues: { name: report.name, format } as unknown as Prisma.InputJsonValue,
        },
      });

      return { status: 'READY', fileUrl };
    } catch (err) {
      await repo.updateStatus(id, 'FAILED');
      throw err;
    }
  }

  // Async path — enqueue job
  await repo.updateStatus(id, 'GENERATING');
  const payload: GenerateReportJobPayload = { reportId: id, format };
  await reportGenerateQueue.add('generate', payload, {
    jobId: `report-${id}`,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  });

  return { status: 'GENERATING' };
}

// ── Download report ───────────────────────────────────────────────────

export async function downloadReport(id: string, userId: string, isAdmin: boolean): Promise<{
  filePath: string;
  fileName: string;
  mimeType: string;
}> {
  const report = await getReport(id, userId, isAdmin);

  if (report.status !== 'READY' || !report.fileUrl) {
    throw new AppError(404, 'REPORT_NOT_READY', 'Report file is not ready. Please generate it first.');
  }

  const relativePath = report.fileUrl.replace('/uploads/', '');
  const exists = await storage.exists(relativePath);
  if (!exists) {
    throw new AppError(404, 'REPORT_FILE_NOT_FOUND', 'Report file not found on disk. Please regenerate.');
  }

  const filePath = storage.getAbsolutePath(relativePath);
  const isExcel = relativePath.endsWith('.xlsx');
  const ext = isExcel ? 'xlsx' : 'pdf';
  const safeName = report.name.replace(/[^a-z0-9_-]/gi, '_');
  const fileName = `${safeName}.${ext}`;
  const mimeType = isExcel
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/pdf';

  return { filePath, fileName, mimeType };
}

// ── Internal: estimate row count for sync/async decision ──────────────

async function estimateRowCount(type: string, _parameters: Record<string, unknown>): Promise<number> {
  try {
    switch (type) {
      case 'ASSET_LIST':
      case 'CUSTOM':
        return await prisma.asset.count({ where: { deletedAt: null } });
      case 'MOVEMENT':
        return await prisma.assetMovement.count();
      case 'MAINTENANCE':
        return await prisma.maintenanceLog.count();
      case 'DEPRECIATION':
        return await prisma.asset.count({ where: { deletedAt: null, status: { not: 'DISPOSED' } } });
      case 'AUDIT':
        return await prisma.auditLog.count();
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

// ── Inline generator used by the background job ───────────────────────

export { generateReport };

// ── Re-export for job usage ───────────────────────────────────────────

export async function runReportJob(payload: GenerateReportJobPayload): Promise<void> {
  const { reportId, format } = payload;

  const report = await repo.findById(reportId);
  if (!report) {
    throw new Error(`Report ${reportId} not found`);
  }

  try {
    const buffer = await generateReport(
      report.type,
      format,
      (report.parameters ?? {}) as Record<string, unknown>,
    );

    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const relPath = `reports/${reportId}.${ext}`;
    const fileUrl = await storage.save(relPath, buffer);

    await repo.updateStatus(reportId, 'READY', { fileUrl, lastGeneratedAt: new Date() });

    // Notify user
    const { notify } = await import('../notifications/service.js');
    await notify({
      userId: report.createdByUserId,
      type: 'REPORT_READY',
      titleKey: 'report_ready.title',
      messageKey: 'report_ready.message',
      vars: { reportName: report.name },
      data: { reportId, url: `/admin/reports/${reportId}` },
    });

    await prisma.auditLog.create({
      data: {
        userId: report.createdByUserId,
        action: 'EXPORT',
        resourceType: 'Report',
        resourceId: reportId,
        newValues: { name: report.name, format } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    await repo.updateStatus(reportId, 'FAILED');

    await prisma.auditLog.create({
      data: {
        userId: report.createdByUserId,
        action: 'EXPORT',
        resourceType: 'Report',
        resourceId: reportId,
        newValues: {
          error: err instanceof Error ? err.message : String(err),
          format,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    throw err;
  }
}

// ── Inline bulk import runner (used by the import job) ────────────────

// Status keys live in Redis with a TTL so completed imports auto-evict.
// Frontend polls the status endpoint until either status === 'completed' or
// the key is gone (treated as "result expired, view result file directly").
const IMPORT_STATUS_TTL_SECONDS = 60 * 60; // 1 hour

function importStatusKey(importId: string): string {
  return `import:${importId}:status`;
}

async function writeImportStatus(
  importId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { redis } = await import('../../lib/redis.js');
  // We always overwrite the full object — partial updates are not safe with
  // a string-encoded JSON value and the payload is small (<1KB).
  await redis.set(
    importStatusKey(importId),
    JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }),
    'EX',
    IMPORT_STATUS_TTL_SECONDS,
  );
}

export async function readImportStatus(
  importId: string,
): Promise<Record<string, unknown> | null> {
  const { redis } = await import('../../lib/redis.js');
  const raw = await redis.get(importStatusKey(importId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runImportJob(payload: {
  importId: string;
  userId: string;
  filePath: string;
  /** Optional column-mapping override captured at upload time. Persisted on
   *  the job so the worker resolves columns the same way the user confirmed
   *  in the wizard, even if the worker runs minutes later. */
  columnMapping?: Partial<Record<string, number | string>>;
}): Promise<void> {
  const { importId, userId, filePath, columnMapping } = payload;

  const { parseAssetImportSheet } = await import('../../lib/excel.js');
  const { bulkImport } = await import('../assets/import-service.js');
  const { notify } = await import('../notifications/service.js');

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  await writeImportStatus(importId, {
    status: 'processing',
    progress: { processed: 0, total: 0 },
    created: 0,
    skipped: 0,
    failed: 0,
  });

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const { rows, errors } = await parseAssetImportSheet(
      fileBuffer,
      columnMapping ? { columnMappingOverride: columnMapping } : {},
    );

    failCount = errors.length;

    // Reflect parse-level failures in the status payload so the bar moves
    // immediately even before bulkImport starts pushing checkpoints.
    await writeImportStatus(importId, {
      status: 'processing',
      progress: { processed: 0, total: rows.length },
      created: 0,
      skipped: 0,
      failed: failCount,
    });

    if (rows.length > 0) {
      const result = await bulkImport(rows, userId, {
        onProgress: async (update) => {
          // Combine bulkImport's per-row progress with parse-level failures
          // (which it doesn't know about). `update.failed` is just bulkImport's
          // own failure count.
          await writeImportStatus(importId, {
            status: 'processing',
            progress: {
              processed: update.processed,
              total: update.total,
            },
            created: update.created,
            skipped: update.skipped,
            failed: errors.length + update.failed,
          });
        },
      });
      successCount = result.created.length;
      skipCount = result.skipped.length;
      failCount += result.failed.length;
    }

    // Write result JSON
    const resultPath = path.resolve(
      process.env['STORAGE_PATH'] ?? './uploads',
      'imports',
      `${importId}-result.json`,
    );
    fs.writeFileSync(
      resultPath,
      JSON.stringify({ importId, successCount, skipCount, failCount, errors, timestamp: new Date().toISOString() }),
    );

    // Audit log for the async import. The sync path's bulkImport already
    // writes its own audit row for the asset module; this one captures the
    // file-level operation explicitly.
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'IMPORT',
        resourceType: 'Asset',
        resourceId: `import:${importId}`,
        newValues: {
          mode: 'async',
          importId,
          created: successCount,
          skipped: skipCount,
          failed: failCount,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await writeImportStatus(importId, {
      status: 'completed',
      progress: { processed: rows.length + errors.length, total: rows.length + errors.length },
      created: successCount,
      skipped: skipCount,
      failed: failCount,
    });
  } catch (err) {
    await writeImportStatus(importId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // Delete the uploaded file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  await notify({
    userId,
    type: 'IMPORT_COMPLETE',
    titleKey: 'import_complete.title',
    messageKey: 'import_complete.message',
    vars: {
      successCount: String(successCount),
      failCount: String(failCount),
    },
    data: { importId, url: `/admin/imports/${importId}` },
  });
}
