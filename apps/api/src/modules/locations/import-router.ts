/**
 * Location import sub-router — mounted at /api/locations/import
 *
 * Routes:
 *   GET  /template — download .xlsx template
 *   POST /         — upload + parse + commit (sync, max 500 rows). Returns
 *                    a structured ImportResult with created/skipped/failed
 *                    arrays so the frontend can render per-row outcomes.
 *
 * Simpler than the Asset import equivalent: no async/BullMQ path, no column
 * mapping UI, no re-validate endpoint. Internal AMS location sheets are
 * small enough that a single sync request handles realistic loads.
 */
import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/error-handler.js';
import { validateUploadedFile } from '../../lib/upload-validator.js';
import { buildLocationImportTemplate } from './import-excel.js';
import { importLocations } from './import-service.js';

const router: RouterType = Router();

// Multer config — keep entirely in memory. The sync handler returns
// immediately so we never need to spool to disk like the async asset
// import path does.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

// ── GET /api/locations/import/template ──────────────────────────────
router.get(
  '/template',
  asyncHandler(async (_req, res) => {
    const buf = await buildLocationImportTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="wedisense-locations-template.xlsx"',
    );
    res.send(buf);
  }),
);

// ── POST /api/locations/import ──────────────────────────────────────
router.post(
  '/',
  authorize('assets:create'),
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'No file uploaded — provide a "file" field');
    }

    // Magic-byte validator catches zipped-text and other tricks where a
    // .xlsx extension doesn't match the actual content.
    const fileCheck = validateUploadedFile(req.file.buffer, req.file.mimetype);
    if (!fileCheck.valid) {
      throw new AppError(400, 'INVALID_FILE', fileCheck.reason ?? 'File rejected');
    }

    const result = await importLocations(req.file.buffer, req.user!.id);
    sendSuccess(res, result);
  }),
);

export { router as locationImportRouter };
