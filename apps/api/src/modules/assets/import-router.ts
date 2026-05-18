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
import { buildAssetImportTemplate, parseAssetImportSheet } from '../../lib/excel.js';
import { importProcessQueue } from '../../lib/queue.js';
import { bulkImport } from './import-service.js';

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

    const { rows, errors } = await parseAssetImportSheet(req.file.buffer);

    if (rows.length === 0 && errors.length === 0) {
      throw new AppError(400, 'EMPTY_FILE', 'The uploaded file contains no data rows');
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

      await importProcessQueue.add(
        'process',
        { importId, userId: req.user!.id, filePath },
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
        message: `File queued for background processing (${rows.length} rows)`,
      });
      return;
    }

    // Sync path — return rows for client preview before confirm
    sendSuccess(res, {
      mode: 'sync',
      preview: rows.slice(0, 10),
      validatedRows: rows,
      rowCount: rows.length,
      parseErrors: errors,
    });
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
        failed: result.failed.length,
        errors: result.failed,
        assets: result.created,
      },
      201,
    );
  }),
);

export { router as assetImportRouter };
