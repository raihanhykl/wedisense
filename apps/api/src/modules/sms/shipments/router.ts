/**
 * Shipments router — mounted at /api/sms/shipments.
 *
 * Routes are behind `authenticate` + `loadSmsAccess` (applied in the parent
 * SMS router). Each route applies a coarse `requireSmsPermission` gate; the
 * authoritative per-location check runs in the service with `assertCan`.
 */
import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../../utils/response.js';
import { AppError } from '../../../middleware/error-handler.js';
import { validateUploadedFile } from '../../../lib/upload-validator.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { requireSmsPermission } from '../lib/access.js';
import {
  inspectTextBodySchema,
  inspectFileQuerySchema,
  previewOptionsSchema,
  previewTextBodySchema,
  confirmBodySchema,
  listShipmentsQuerySchema,
  receiveBodySchema,
  findingsBodySchema,
} from './schema.js';
import * as svc from './service.js';

const router: RouterType = Router();

// ── Multer (memory storage, 10 MB, xlsx / xls / csv) ─────────────────────────

const IMPORT_SIZE_LIMIT = 10 * 1024 * 1024;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_SIZE_LIMIT, files: 1 },
});

// ── POST /api/sms/shipments/import/inspect ────────────────────────────────────
//
// Accepts: multipart file (xlsx/xls/csv) OR JSON { text }
// Permission: RECEIVING_MANAGE anywhere (coarse gate)
router.post(
  '/import/inspect',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.file) {
      // Validate magic bytes
      const validation = validateUploadedFile(req.file.buffer, req.file.mimetype);
      if (!validation.valid) {
        throw new AppError(
          415,
          'INVALID_FILE_CONTENT',
          validation.reason ?? 'File content does not match an allowed type',
        );
      }

      const query = inspectFileQuerySchema.parse(req.query);
      const result = await svc.inspectSource({
        kind: 'file',
        buffer: req.file.buffer,
        mime: validation.resolvedMime ?? req.file.mimetype,
        fileName: req.file.originalname,
        sheetName: query.sheetName,
      });
      sendSuccess(res, result);
    } else {
      // JSON body path
      const body = inspectTextBodySchema.parse(req.body);
      const result = await svc.inspectSource({
        kind: 'text',
        text: body.text,
      });
      sendSuccess(res, result);
    }
  }),
);

// ── POST /api/sms/shipments/import/preview ────────────────────────────────────
//
// Accepts: multipart (file + options JSON string) OR JSON { text, options }
// Permission: RECEIVING_MANAGE at the destination (coarse gate: RECEIVING_MANAGE anywhere)
router.post(
  '/import/preview',
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

      // `options` is a JSON string field sent alongside the file
      const rawOptions = (req.body as Record<string, unknown>)['options'];
      let parsedOptions: unknown;
      try {
        parsedOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions;
      } catch {
        throw new AppError(400, 'INVALID_OPTIONS', 'options field must be valid JSON');
      }
      const options = previewOptionsSchema.parse(parsedOptions);

      const result = await svc.previewManifest(
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
      const body = previewTextBodySchema.parse(req.body);
      const result = await svc.previewManifest(
        { kind: 'text', text: body.text },
        body.options,
        req,
      );
      sendSuccess(res, result);
    }
  }),
);

// ── POST /api/sms/shipments/import/confirm ────────────────────────────────────
//
// JSON body. Requires Idempotency-Key header.
// Permission: RECEIVING_MANAGE at the destination.
router.post(
  '/import/confirm',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = confirmBodySchema.parse(req.body);
    const result = await svc.confirmImport(body, req);
    sendCreated(res, result);
  }),
);

// ── GET /api/sms/shipments ────────────────────────────────────────────────────
//
// Paginated list. Permission: STOCK_VIEW.
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = listShipmentsQuerySchema.parse(req.query);
    const { data, meta } = await svc.listShipments(
      {
        destinationLocationId: query.destinationLocationId,
        state: query.state,
        search: query.search,
        page: query.page,
        limit: query.limit,
      },
      req,
    );
    sendSuccess(res, data, 200, meta);
  }),
);

// ── GET /api/sms/shipments/:id ────────────────────────────────────────────────
//
// Detail with all lines. Permission: STOCK_VIEW at the destination.
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params['id']);
    const result = await svc.getShipment(id, req);
    sendSuccess(res, result);
  }),
);

// ── POST /api/sms/shipments/:id/receive ──────────────────────────────────────
//
// Confirm physical receipt of line items. Requires Idempotency-Key header.
// Permission: RECEIVING_MANAGE at the shipment's destination.
router.post(
  '/:id/receive',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params['id']);
    const body = receiveBodySchema.parse(req.body);
    const result = await svc.receiveItems(id, body, req);
    sendSuccess(res, result);
  }),
);

// ── POST /api/sms/shipments/:id/findings ─────────────────────────────────────
//
// Record a motorcycle that arrived with a different identity from the manifest.
// Requires Idempotency-Key header.
// Permission: RECEIVING_MANAGE at the shipment's destination.
router.post(
  '/:id/findings',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params['id']);
    const body = findingsBodySchema.parse(req.body);
    const result = await svc.recordFinding(id, body, req);
    sendCreated(res, result);
  }),
);

export { router as smsShipmentsRouter };
