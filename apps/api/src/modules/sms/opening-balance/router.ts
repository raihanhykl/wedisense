/**
 * Opening-balance router — mounted at /api/sms/opening-balance.
 *
 * Routes are behind `authenticate` + `loadSmsAccess` (applied in the parent
 * SMS router). Each mutating route applies a coarse `requireSmsPermission`
 * gate; the authoritative per-location check runs in the service with
 * `assertCan`.
 */
import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../../utils/response.js';
import { AppError } from '../../../middleware/error-handler.js';
import { validateUploadedFile } from '../../../lib/upload-validator.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { requireSmsPermission } from '../lib/access.js';
import {
  obInspectTextBodySchema,
  obInspectFileQuerySchema,
  obPreviewOptionsSchema,
  obPreviewTextBodySchema,
  obConfirmBodySchema,
} from './schema.js';
import * as svc from './service.js';

const router: RouterType = Router();

const IMPORT_SIZE_LIMIT = 10 * 1024 * 1024;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_SIZE_LIMIT, files: 1 },
});

// ── POST /api/sms/opening-balance/inspect ─────────────────────────────────────
//
// Accepts: multipart file (xlsx/xls/csv) OR JSON { text }
// Permission: RECEIVING_MANAGE anywhere (coarse gate — read-only analysis)
router.post(
  '/inspect',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.file) {
      const validation = validateUploadedFile(req.file.buffer, req.file.mimetype);
      if (!validation.valid) {
        throw new AppError(
          415,
          'INVALID_FILE_CONTENT',
          validation.reason ?? 'File content does not match an allowed type',
        );
      }
      const query = obInspectFileQuerySchema.parse(req.query);
      const result = await svc.inspectSource({
        kind: 'file',
        buffer: req.file.buffer,
        mime: validation.resolvedMime ?? req.file.mimetype,
        fileName: req.file.originalname,
        sheetName: query.sheetName,
      });
      sendSuccess(res, result);
    } else {
      const body = obInspectTextBodySchema.parse(req.body);
      const result = await svc.inspectSource({ kind: 'text', text: body.text });
      sendSuccess(res, result);
    }
  }),
);

// ── POST /api/sms/opening-balance/preview ─────────────────────────────────────
//
// Accepts: multipart (file + options JSON string) OR JSON { text, options }
// Permission: RECEIVING_MANAGE anywhere (coarse gate — read-only analysis)
router.post(
  '/preview',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.file) {
      const validation = validateUploadedFile(req.file.buffer, req.file.mimetype);
      if (!validation.valid) {
        throw new AppError(
          415,
          'INVALID_FILE_CONTENT',
          validation.reason ?? 'File content does not match an allowed type',
        );
      }
      const rawOptions = (req.body as Record<string, unknown>)['options'];
      let parsedOptions: unknown;
      try {
        parsedOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions;
      } catch {
        throw new AppError(400, 'INVALID_OPTIONS', 'options field must be valid JSON');
      }
      const options = obPreviewOptionsSchema.parse(parsedOptions);
      const result = await svc.previewBalance(
        {
          kind: 'file',
          buffer: req.file.buffer,
          mime: validation.resolvedMime ?? req.file.mimetype,
          fileName: req.file.originalname,
          sheetName: options.sheetName,
        },
        options,
        req,
      );
      sendSuccess(res, result);
    } else {
      const body = obPreviewTextBodySchema.parse(req.body);
      const result = await svc.previewBalance({ kind: 'text', text: body.text }, body.options, req);
      sendSuccess(res, result);
    }
  }),
);

// ── POST /api/sms/opening-balance/confirm ─────────────────────────────────────
//
// JSON body. Requires Idempotency-Key header.
// Permission: RECEIVING_MANAGE at every row's showroom.
router.post(
  '/confirm',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = obConfirmBodySchema.parse(req.body);
    const result = await svc.confirmBalance(body, req);
    sendCreated(res, result);
  }),
);

// ── GET /api/sms/opening-balance/template ─────────────────────────────────────
//
// Returns an xlsx template for the opening-balance import.
// Permission: RECEIVING_MANAGE anywhere.
router.get(
  '/template',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (_req, res) => {
    const buffer = await svc.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="opening-balance-template.xlsx"');
    res.send(buffer);
  }),
);

export { router as smsOpeningBalanceRouter };
