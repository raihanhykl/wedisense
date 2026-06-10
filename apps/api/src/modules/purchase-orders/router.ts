import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { AppError } from '../../middleware/error-handler.js';
import { parseOdooPoPdf } from '../../lib/odoo-pdf-parser.js';
import { parsePdfWithAi } from '../../lib/ai-pdf-parser.js';
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  listPurchaseOrderQuerySchema,
  cancelPurchaseOrderSchema,
} from './schema.js';
import * as poService from './service.js';

const router: RouterType = Router();

// Multer instance for PDF upload — kept in memory (no on-disk staging
// needed; the parser reads the buffer directly) and capped at 10 MB.
// We accept only the application/pdf MIME type — backed up by a
// magic-bytes check below since headers are easy to forge.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      cb(new AppError(400, 'INVALID_FILE_TYPE', 'Only PDF files are accepted'));
      return;
    }
    cb(null, true);
  },
});

// POST /api/purchase-orders/parse-pdf — Odoo PO PDF extractor (spec §2.3)
//
// Two modes — selected by the `mode` multipart field:
//   - "ai"    (default): OpenRouter → Claude Haiku 4.5 → fallback to
//             gpt-4o-mini → gemini-2.5-flash. Best accuracy.
//   - "regex": local heuristic parser. No API key needed. Faster but
//             ~70-90% accurate on the standard Odoo template.
//
// Returns ParsedOdooPo (+ `servedBy` field naming the parser that
// actually ran). Fields the parser couldn't confidently extract are
// listed in `unparsedFields` so the UI can prompt for review. NO PO
// is persisted by this endpoint — pure read-side analysis, no audit
// log entry needed.
router.post(
  '/parse-pdf',
  authorize('purchase-orders:create'),
  pdfUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(
        400,
        'NO_FILE',
        'No file uploaded. Use multipart/form-data with field name "file"',
      );
    }
    // Magic-bytes sanity check: every PDF starts with "%PDF-".
    const header = req.file.buffer.slice(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new AppError(
        415,
        'INVALID_FILE_CONTENT',
        'File does not appear to be a PDF (missing %PDF- header)',
      );
    }

    // Parse mode resolution. `mode` arrives as a multipart text field;
    // anything other than the literal "regex" is treated as "ai" so
    // the default is the higher-quality path even if the client omits
    // the field entirely.
    const body = req.body as Record<string, unknown>;
    const requestedMode =
      typeof body['mode'] === 'string' ? body['mode'] : 'ai';
    const mode: 'ai' | 'regex' = requestedMode === 'regex' ? 'regex' : 'ai';

    if (mode === 'ai') {
      if (!process.env['OPENROUTER_API_KEY']) {
        throw new AppError(
          503,
          'AI_PARSER_UNAVAILABLE',
          'AI parser is not configured (OPENROUTER_API_KEY is missing on the server). Switch the toggle to Regex, or contact an admin to set the key.',
        );
      }
      try {
        const aiParsed = await parsePdfWithAi(req.file.buffer);
        const { rawText: _rawText, ...payload } = aiParsed;
        void _rawText;
        sendSuccess(res, payload);
        return;
      } catch (err) {
        // Surface OpenRouter / SDK errors with a clean shape. We
        // deliberately don't auto-fall-back to regex here — the user
        // explicitly picked AI mode, so we want them to see WHY it
        // failed (rate limit, network, schema rejection, etc.) and
        // decide whether to retry or switch mode.
        const detail = err instanceof Error ? err.message : 'Unknown error';
        throw new AppError(
          502,
          'AI_PARSER_FAILED',
          `AI parser failed: ${detail}. You can retry, or switch to the Regex parser.`,
        );
      }
    }

    // Regex path — the deterministic fallback (Tier 7.10 + parser fixes).
    const parsed = await parseOdooPoPdf(req.file.buffer);
    const { rawText: _rawText, ...payload } = parsed;
    void _rawText;
    sendSuccess(res, { ...payload, servedBy: 'regex' });
  }),
);

// GET /api/purchase-orders
router.get(
  '/',
  authorize('purchase-orders:read'),
  asyncHandler(async (req, res) => {
    const query = listPurchaseOrderQuerySchema.parse(req.query);
    const { skip, take, page, limit } = parsePagination(query);

    const filters = {
      status: query.status,
      vendor: query.vendor,
      search: query.search,
      poDateFrom: query.poDateFrom,
      poDateTo: query.poDateTo,
    };

    const { data, total } = await poService.listPurchaseOrders(filters, skip, take);
    const meta = buildPaginationMeta(page, limit, total);
    sendSuccess(res, data, 200, meta);
  }),
);

// POST /api/purchase-orders
router.post(
  '/',
  authorize('purchase-orders:create'),
  asyncHandler(async (req, res) => {
    const input = createPurchaseOrderSchema.parse(req.body);
    const po = await poService.createPurchaseOrder(input, req.user!.id);
    sendCreated(res, po);
  }),
);

// GET /api/purchase-orders/:id
router.get(
  '/:id',
  authorize('purchase-orders:read'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const po = await poService.getPurchaseOrder(id);
    sendSuccess(res, po);
  }),
);

// PUT /api/purchase-orders/:id — metadata only. Status transitions go
// through /close and /cancel so the contract of each transition is
// explicit and individually permission-checked.
router.put(
  '/:id',
  authorize('purchase-orders:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updatePurchaseOrderSchema.parse(req.body);
    const po = await poService.updatePurchaseOrder(id, input, req.user!.id);
    sendSuccess(res, po);
  }),
);

// DELETE /api/purchase-orders/:id — soft-delete, OPEN with zero batches only
router.delete(
  '/:id',
  authorize('purchase-orders:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await poService.deletePurchaseOrder(id, req.user!.id);
    sendNoContent(res);
  }),
);

// PUT /api/purchase-orders/:id/close — transition to CLOSED
router.put(
  '/:id/close',
  authorize('purchase-orders:close'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const po = await poService.closePurchaseOrder(id, req.user!.id);
    sendSuccess(res, po);
  }),
);

// PUT /api/purchase-orders/:id/cancel — transition to CANCELLED
router.put(
  '/:id/cancel',
  authorize('purchase-orders:cancel'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = cancelPurchaseOrderSchema.parse(req.body);
    const po = await poService.cancelPurchaseOrder(id, input, req.user!.id);
    sendSuccess(res, po);
  }),
);

export { router as purchaseOrderRouter };
