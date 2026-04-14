import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createTemplateSchema,
  updateTemplateSchema,
  previewTemplateSchema,
  createPrintJobSchema,
} from './schema.js';
import * as labelService from './service.js';
import { getPrintPdfPath } from '../../lib/pdf.js';

const router: RouterType = Router();

// ── Label Templates ────────────────────────────────────────────

// GET /api/label-templates — list all templates
router.get(
  '/label-templates',
  asyncHandler(async (_req, res) => {
    const templates = await labelService.listTemplates();
    sendSuccess(res, templates);
  }),
);

// POST /api/label-templates — create template
router.post(
  '/label-templates',
  authorize('labels:manage'),
  asyncHandler(async (req, res) => {
    const input = createTemplateSchema.parse(req.body);
    const result = await labelService.createTemplate(input, req.user!.id);
    sendCreated(res, result);
  }),
);

// GET /api/label-templates/:id — single template
router.get(
  '/label-templates/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const template = await labelService.getTemplate(id);
    sendSuccess(res, template);
  }),
);

// PUT /api/label-templates/:id — update template
router.put(
  '/label-templates/:id',
  authorize('labels:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateTemplateSchema.parse(req.body);
    const template = await labelService.updateTemplate(id, input, req.user!.id);
    sendSuccess(res, template);
  }),
);

// DELETE /api/label-templates/:id — delete template
router.delete(
  '/label-templates/:id',
  authorize('labels:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await labelService.deleteTemplate(id, req.user!.id);
    sendNoContent(res);
  }),
);

// POST /api/label-templates/:id/preview — generate preview PDF
router.post(
  '/label-templates/:id/preview',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const { assetId } = previewTemplateSchema.parse(req.body);
    const pdfBuffer = await labelService.previewTemplate(id, assetId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="label-preview-${id}.pdf"`);
    res.send(pdfBuffer);
  }),
);

// ── Print Jobs ─────────────────────────────────────────────────

// POST /api/print-jobs — create print job
router.post(
  '/print-jobs',
  authorize('assets:print'),
  asyncHandler(async (req, res) => {
    const input = createPrintJobSchema.parse(req.body);
    const result = await labelService.createPrintJob(input, req.user!.id);
    sendCreated(res, result);
  }),
);

// GET /api/print-jobs/:id — get print job status
router.get(
  '/print-jobs/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const printJob = await labelService.getPrintJob(id);
    sendSuccess(res, printJob);
  }),
);

// GET /api/print-jobs/:id/download — download the generated PDF
router.get(
  '/print-jobs/:id/download',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const printJob = await labelService.getPrintJob(id);

    if (printJob.status !== 'READY') {
      res.status(400).json({
        success: false,
        error: { code: 'PDF_NOT_READY', message: 'PDF is not yet ready for download' },
      });
      return;
    }

    const pdfPath = getPrintPdfPath(id);
    if (!pdfPath) {
      res.status(404).json({
        success: false,
        error: { code: 'PDF_NOT_FOUND', message: 'PDF file not found on disk' },
      });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="print-job-${id}.pdf"`);
    res.sendFile(pdfPath);
  }),
);

export { router as labelRouter };
