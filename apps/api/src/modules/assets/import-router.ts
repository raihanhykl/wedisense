/**
 * Asset import sub-router — mounted at /api/assets/import
 *
 * Routes:
 *   GET  /template        — download .xlsx template
 *   POST /                — upload file, parse, return preview (or queue async)
 *   POST /confirm         — create assets from validated rows (sync ≤5000)
 */
import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/error-handler.js';
import { validateUploadedFile } from '../../lib/upload-validator.js';
import {
  buildAssetImportTemplate,
  buildImportErrorReport,
  parseAssetImportSheet,
  revalidateAssetImportRow,
} from '../../lib/excel.js';
import { importProcessQueue } from '../../lib/queue.js';
import { bulkImport, previewImportDedup } from './import-service.js';
import { readImportStatus } from '../reports/service.js';
import { redis as redisClient } from '../../lib/redis.js';

// Zod schema that mirrors AssetImportRow in lib/excel.ts.
// Enforced on /confirm so callers cannot inject arbitrary enum values
// past the parse step.
const assetStatusEnum = z.enum([
  'ACTIVE',
  'IDLE',
  'IN_MAINTENANCE',
  'DISPOSED',
  'LOST',
  'BORROWED',
]);
const assetConditionEnum = z.enum([
  'NEW',
  'GOOD',
  'FAIR',
  'POOR',
  'DAMAGED',
]);

// Spec carried over from the preview phase when the row wants a new
// product created (rather than matched to an existing one).
const newProductSpecSchema = z.object({
  name: z.string().min(1).max(255),
  categoryName: z.string().min(1).max(255),
  brand: z.string().min(1).max(255).optional(),
  model: z.string().min(1).max(255).optional(),
  eanCode: z.string().min(1).max(64).optional(),
});

const importRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  // productId is normally a UUID after parse, but when the row will create
  // a new product it stays as the raw user-typed name carrying a
  // newProductSpec. The bulkImport service replaces it with the new
  // product's UUID before asset creation.
  productId: z.string().min(1),
  newProductSpec: newProductSpecSchema.optional(),
  name: z.string().min(1).max(255),
  serialNumber: z.string().trim().min(1).optional(),
  status: assetStatusEnum,
  condition: assetConditionEnum,
  locationId: z.string().uuid(),
  assignedToUserId: z.string().uuid().optional(),
  purchaseDate: z.coerce.date().optional(),
  purchasePrice: z.number().nonnegative().optional(),
  currency: z.string().length(3),
  vendor: z.string().optional(),
  invoiceNumber: z.string().optional(),
  warrantyStartDate: z.coerce.date().optional(),
  warrantyEndDate: z.coerce.date().optional(),
  usefulLifeMonths: z.number().int().positive().optional(),
  notes: z.string().optional(),
}).refine(
  (r) => z.string().uuid().safeParse(r.productId).success || r.newProductSpec !== undefined,
  { message: 'productId must be a UUID, or newProductSpec must be provided to create the product on-the-fly', path: ['productId'] },
);

const confirmBodySchema = z.object({
  validatedRows: z.array(importRowSchema).min(1),
});

const router: RouterType = Router();

const IMPORT_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
const ASYNC_ROW_THRESHOLD = 5000;

const ALLOWED_IMPORT_EXTS = new Set(['.xlsx', '.xls']);
const ALLOWED_IMPORT_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/octet-stream', // some browsers (Safari) fall back to this
]);

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_SIZE_LIMIT, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMPORT_EXTS.has(ext)) {
      cb(new AppError(400, 'INVALID_FILE_TYPE', 'Only .xlsx and .xls files are accepted'));
      return;
    }
    if (!ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
      cb(
        new AppError(
          400,
          'INVALID_FILE_MIME',
          `Unexpected MIME type: ${file.mimetype}. File extension must match the spreadsheet content.`,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

// ── GET /api/assets/import/template ───────────────────────────────────
router.get(
  '/template',
  authorize('assets:import'),
  asyncHandler(async (_req, res) => {
    const buffer = await buildAssetImportTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="wedisense-asset-import-template.xlsx"',
    );
    res.send(buffer);
  }),
);

// Zod schema for the multipart `columnMapping` form field. Accepted as a
// JSON-encoded string because multer surfaces non-file fields as strings.
// Keys are canonical column keys; values are either a 1-based column number
// or a raw header string (frontend persists by header text so a saved
// mapping works across files with different column orderings).
const columnMappingFormSchema = z.record(
  z.string().min(1),
  z.union([z.number().int().positive(), z.string().min(1)]),
);

function parseColumnMappingField(raw: unknown): Partial<Record<string, number | string>> | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'INVALID_COLUMN_MAPPING', 'columnMapping must be valid JSON');
  }
  const result = columnMappingFormSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      400,
      'INVALID_COLUMN_MAPPING',
      'columnMapping must map canonical-key strings to column numbers or header strings',
    );
  }
  return result.data;
}

// ── POST /api/assets/import — upload + parse + preview ────────────────
router.post(
  '/',
  authorize('assets:import'),
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(
        400,
        'NO_FILE',
        'No file uploaded. Use multipart/form-data with field name "file"',
      );
    }

    // Magic-byte verification — the multer fileFilter above only checks the
    // extension and the client-declared MIME header, both of which are easy
    // to spoof (rename `evil.exe` to `report.xlsx`, multer accepts). This
    // step inspects the actual first bytes of the buffer; the multer pass
    // becomes a cheap pre-filter rather than the security boundary.
    const validation = validateUploadedFile(req.file.buffer, req.file.mimetype);
    if (!validation.valid) {
      throw new AppError(
        415,
        'INVALID_FILE_CONTENT',
        validation.reason ?? 'File content does not match an allowed type',
      );
    }

    const columnMappingOverride = parseColumnMappingField(
      (req.body as { columnMapping?: unknown }).columnMapping,
    );

    const { rows, errors, detectedMapping } = await parseAssetImportSheet(
      req.file.buffer,
      columnMappingOverride ? { columnMappingOverride } : {},
    );

    // Distinguish "file has no header" / "missing required columns" from
    // "file is genuinely empty". The former case has errors[0] but no rows
    // and the user needs the mapping UI; we return success so the frontend
    // can render that UI rather than treating it as a top-level upload failure.
    const hasHeaderProblem =
      rows.length === 0 &&
      errors.length === 1 &&
      errors[0]?.field === 'headers';

    if (rows.length === 0 && errors.length === 0) {
      throw new AppError(400, 'EMPTY_FILE', 'The uploaded file contains no data rows');
    }

    if (hasHeaderProblem) {
      sendSuccess(res, {
        mode: 'sync',
        preview: [],
        validatedRows: [],
        rowCount: 0,
        parseErrors: errors,
        willSkip: [],
        detectedMapping,
      });
      return;
    }

    if (rows.length >= ASYNC_ROW_THRESHOLD) {
      // Save to disk for async processing
      const importId = randomUUID();
      const importDir = path.resolve(process.env['STORAGE_PATH'] ?? './uploads', 'imports');
      if (!fs.existsSync(importDir)) {
        fs.mkdirSync(importDir, { recursive: true });
      }
      const filePath = path.join(importDir, `${importId}.xlsx`);
      fs.writeFileSync(filePath, req.file.buffer);

      // Seed an initial "queued" status before enqueuing so a poll right
      // after upload returns useful state rather than 404.
      await redisClient.set(
        `import:${importId}:status`,
        JSON.stringify({
          status: 'queued',
          progress: { processed: 0, total: rows.length },
          created: 0,
          skipped: 0,
          failed: 0,
          queuedAt: new Date().toISOString(),
        }),
        'EX',
        60 * 60,
      );

      await importProcessQueue.add(
        'process',
        {
          importId,
          userId: req.user!.id,
          filePath,
          // Persist mapping with the job so the worker uses the same column
          // resolution the user confirmed at upload time.
          ...(columnMappingOverride && { columnMapping: columnMappingOverride }),
        },
        {
          jobId: `import-${importId}`,
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      );

      sendSuccess(res, {
        mode: 'async',
        importId,
        rowCount: rows.length,
        parseErrors: errors,
        detectedMapping,
        message: `File queued for background processing (${rows.length} rows)`,
      });
      return;
    }

    // Sync path — return rows for client preview before confirm. Run the
    // pre-flight dedup so the Review step can tell the user up-front which
    // rows will be skipped because their serial already matches a live asset.
    const { willSkip } = await previewImportDedup(rows);

    sendSuccess(res, {
      mode: 'sync',
      preview: rows.slice(0, 10),
      validatedRows: rows,
      rowCount: rows.length,
      parseErrors: errors,
      willSkip,
      detectedMapping,
    });
  }),
);

// Zod schema for the revalidate-row endpoint. `values` is a permissive
// string-keyed map because the frontend's inline editor surfaces all the
// raw cell values as strings (HTML inputs emit strings). Server-side
// validation in revalidateAssetImportRow does the strict typing.
const revalidateRowBodySchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  values: z.record(
    z.string().min(1),
    z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .transform((v) => (v == null ? '' : String(v))),
  ),
});

// ── POST /api/assets/import/revalidate-row ────────────────────────────
// Surfaces the same two-pass validation (field rules + natural-key
// resolution) parseAssetImportSheet uses internally, but for a single
// caller-supplied row. The inline-repair UI hits this after the user
// edits an errored row.
//
// Response shape mirrors the rest of the import API:
//   200 { success: true, data: { valid: true,  row: AssetImportRow } }
//   200 { success: true, data: { valid: false, errors: ParseError[] } }
//
// A failed re-validation is NOT a 4xx — the row is still "in flight" and
// the user is expected to fix and try again. We surface success at the
// HTTP layer and let the body carry the validation verdict.
router.post(
  '/revalidate-row',
  authorize('assets:import'),
  asyncHandler(async (req, res) => {
    const { rowIndex, values } = revalidateRowBodySchema.parse(req.body);
    const { row, errors } = await revalidateAssetImportRow(rowIndex, values);
    if (row) {
      sendSuccess(res, { valid: true, row });
    } else {
      sendSuccess(res, { valid: false, errors });
    }
  }),
);

// Schema for the error-report endpoint. Loose by design — the report is
// a downstream artifact, not a write to the system, so we just need enough
// shape to render the XLSX. `rawValues` is whatever the client has on
// hand; missing entries just leave blank cells in the report.
const errorReportBodySchema = z.object({
  errors: z
    .array(
      z.object({
        rowIndex: z.number().int().nonnegative(),
        field: z.string(),
        message: z.string(),
        value: z.unknown().optional(),
        rawValues: z.record(z.string(), z.string()).optional(),
      }),
    )
    // Hard cap: well above any realistic import error count, but bounded
    // so a malicious client can't ask us to allocate a 1M-row workbook.
    .max(50_000),
});

// ── POST /api/assets/import/errors-report.xlsx ─────────────────────────
// Returns an Excel file listing every failed row with the user's original
// values + the error messages. Used by both the sync Result step and the
// async progress panel — both have the errors in client state by the time
// they offer the download.
router.post(
  '/errors-report.xlsx',
  authorize('assets:import'),
  asyncHandler(async (req, res) => {
    const { errors } = errorReportBodySchema.parse(req.body);
    if (errors.length === 0) {
      throw new AppError(400, 'NO_ERRORS', 'No errors to report');
    }
    const buffer = await buildImportErrorReport(errors);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="wedisense-import-errors-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    );
    res.send(buffer);
  }),
);

// ── POST /api/assets/import/confirm — create assets ───────────────────
router.post(
  '/confirm',
  authorize('assets:import'),
  asyncHandler(async (req, res) => {
    // Zod parse — throws AppError(422) via the project's standard error
    // handler if the body shape is wrong or any row contains an invalid
    // enum, malformed UUID, etc.
    const { validatedRows } = confirmBodySchema.parse(req.body);

    if (validatedRows.length >= ASYNC_ROW_THRESHOLD) {
      throw new AppError(
        400,
        'TOO_MANY_ROWS',
        `Confirm endpoint accepts max ${ASYNC_ROW_THRESHOLD - 1} rows. Upload a file for larger imports.`,
      );
    }

    const result = await bulkImport(validatedRows, req.user!.id);

    sendSuccess(
      res,
      {
        created: result.created.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
        errors: result.failed,
        skippedRows: result.skipped,
        assets: result.created,
      },
      201,
    );
  }),
);

// ── GET /api/assets/import/:importId/status ───────────────────────────
// Status payload shape:
//   { status: 'queued' | 'processing' | 'completed' | 'failed',
//     progress?: { processed, total },
//     created, skipped, failed,
//     result?: { errors }  // attached when status === 'completed'
//     error?: string       // attached when status === 'failed'
//   }
//
// The frontend polls this until status is in a terminal state. Redis is the
// source of truth while the job runs; once the job finalises, the
// `{importId}-result.json` file is the durable record (Redis TTLs out
// after 1h).
router.get(
  '/:importId/status',
  authorize('assets:import'),
  asyncHandler(async (req, res) => {
    const importId = req.params['importId'] as string;
    // Light validation — bail early on garbage rather than scanning files.
    if (!/^[0-9a-f-]{8,40}$/i.test(importId)) {
      throw new AppError(400, 'INVALID_IMPORT_ID', 'Malformed importId');
    }

    const status = await readImportStatus(importId);

    // If we still have a live status record, return it as-is, augmenting
    // with the result-file errors when the job has completed.
    if (status) {
      if (status['status'] === 'completed') {
        const resultPath = path.resolve(
          process.env['STORAGE_PATH'] ?? './uploads',
          'imports',
          `${importId}-result.json`,
        );
        if (fs.existsSync(resultPath)) {
          try {
            const file = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
              errors?: unknown[];
            };
            sendSuccess(res, { ...status, result: { errors: file.errors ?? [] } });
            return;
          } catch {
            // Fall through to the basic payload if the JSON is malformed.
          }
        }
      }
      sendSuccess(res, status);
      return;
    }

    // No Redis record — either the import never existed or the TTL expired
    // and the file is the only remaining trace. Check the result file as a
    // fallback so old completed imports are still queryable.
    const resultPath = path.resolve(
      process.env['STORAGE_PATH'] ?? './uploads',
      'imports',
      `${importId}-result.json`,
    );
    if (fs.existsSync(resultPath)) {
      const file = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
        successCount?: number;
        skipCount?: number;
        failCount?: number;
        errors?: unknown[];
      };
      sendSuccess(res, {
        status: 'completed',
        created: file.successCount ?? 0,
        skipped: file.skipCount ?? 0,
        failed: file.failCount ?? 0,
        result: { errors: file.errors ?? [] },
      });
      return;
    }

    // Neither Redis nor the file — let the caller distinguish "doesn't
    // exist" from "still pending" via the 404.
    throw new AppError(404, 'IMPORT_NOT_FOUND', 'No import found for this ID');
  }),
);

export { router as assetImportRouter };
