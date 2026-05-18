import { Router, type Router as RouterType, type Request } from 'express';
import fs from 'fs';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createReportSchema,
  updateReportSchema,
  listQuerySchema,
  generateReportSchema,
} from './schema.js';
import * as reportService from './service.js';

const router: RouterType = Router();

/** Determine if the user has admin-level access (can see all reports). */
function isAdmin(req: Request): boolean {
  return req.user?.permissions.includes('audit:read') ?? false;
}

// ── GET /api/reports ──────────────────────────────────────────────────
router.get(
  '/',
  authorize('reports:view'),
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const { reports, meta } = await reportService.listReports(req.user!.id, isAdmin(req), query);
    sendSuccess(res, reports, 200, meta);
  }),
);

// ── POST /api/reports ─────────────────────────────────────────────────
router.post(
  '/',
  authorize('reports:generate'),
  asyncHandler(async (req, res) => {
    const input = createReportSchema.parse(req.body);
    const report = await reportService.createReport(input, req.user!.id);
    sendCreated(res, report);
  }),
);

// ── GET /api/reports/:id ──────────────────────────────────────────────
router.get(
  '/:id',
  authorize('reports:view'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const report = await reportService.getReport(id, req.user!.id, isAdmin(req));
    sendSuccess(res, report);
  }),
);

// ── PUT /api/reports/:id ──────────────────────────────────────────────
router.put(
  '/:id',
  authorize('reports:generate'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateReportSchema.parse(req.body);
    const report = await reportService.updateReport(id, input, req.user!.id, isAdmin(req));
    sendSuccess(res, report);
  }),
);

// ── DELETE /api/reports/:id ───────────────────────────────────────────
router.delete(
  '/:id',
  authorize('reports:generate'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await reportService.deleteReport(id, req.user!.id, isAdmin(req));
    sendNoContent(res);
  }),
);

// ── POST /api/reports/:id/generate ───────────────────────────────────
router.post(
  '/:id/generate',
  authorize('reports:generate'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const { format } = generateReportSchema.parse(req.body);
    const result = await reportService.triggerGenerate(id, format, req.user!.id, isAdmin(req));
    sendSuccess(res, result);
  }),
);

// ── GET /api/reports/:id/download ────────────────────────────────────
router.get(
  '/:id/download',
  authorize('reports:view'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const { filePath, fileName, mimeType } = await reportService.downloadReport(
      id,
      req.user!.id,
      isAdmin(req),
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }),
);

export { router as reportsRouter };
