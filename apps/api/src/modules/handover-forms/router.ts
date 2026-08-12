import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createHandoverFormSchema,
  updateHandoverFormSchema,
  cancelHandoverFormSchema,
  listHandoverFormQuerySchema,
} from './schema.js';
import * as handoverService from './service.js';

const router: RouterType = Router();

const SCAN_SIZE_LIMIT = 10 * 1024 * 1024;

// Memory storage so the service can verify the PDF magic bytes before
// anything is written — a rejected upload leaves no file behind.
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SCAN_SIZE_LIMIT, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      cb(new AppError(400, 'INVALID_FILE_TYPE', 'Signed scan must be a PDF file'));
      return;
    }
    cb(null, true);
  },
});

// GET /api/handover-forms — paginated list
router.get(
  '/',
  authorize('handover-forms:read'),
  asyncHandler(async (req, res) => {
    const query = listHandoverFormQuerySchema.parse(req.query);
    const { skip, take, page, limit } = parsePagination(query);

    const { data, total } = await handoverService.listHandoverForms(
      handoverService.buildListFilters(query),
      skip,
      take,
    );

    sendSuccess(res, data, 200, buildPaginationMeta(page, limit, total));
  }),
);

// POST /api/handover-forms — create a DRAFT and allocate its letter number
router.post(
  '/',
  authorize('handover-forms:create'),
  asyncHandler(async (req, res) => {
    const input = createHandoverFormSchema.parse(req.body);
    const form = await handoverService.createHandoverForm(input, req.user!.id);
    sendCreated(res, form);
  }),
);

// GET /api/handover-forms/:id
router.get(
  '/:id',
  authorize('handover-forms:read'),
  asyncHandler(async (req, res) => {
    const form = await handoverService.getHandoverForm(req.params['id'] as string);
    sendSuccess(res, form);
  }),
);

// PUT /api/handover-forms/:id — full replace, DRAFT only
router.put(
  '/:id',
  authorize('handover-forms:update'),
  asyncHandler(async (req, res) => {
    const input = updateHandoverFormSchema.parse(req.body);
    const form = await handoverService.updateHandoverForm(
      req.params['id'] as string,
      input,
      req.user!.id,
    );
    sendSuccess(res, form);
  }),
);

// DELETE /api/handover-forms/:id — soft delete, DRAFT only
router.delete(
  '/:id',
  authorize('handover-forms:update'),
  asyncHandler(async (req, res) => {
    await handoverService.deleteHandoverForm(req.params['id'] as string, req.user!.id);
    sendNoContent(res);
  }),
);

// POST /api/handover-forms/:id/cancel — the escape hatch for issued forms
router.post(
  '/:id/cancel',
  authorize('handover-forms:update'),
  asyncHandler(async (req, res) => {
    const { reason } = cancelHandoverFormSchema.parse(req.body);
    const form = await handoverService.cancelHandoverForm(
      req.params['id'] as string,
      reason,
      req.user!.id,
    );
    sendSuccess(res, form);
  }),
);

// GET /api/handover-forms/:id/pdf — renders inline; first call locks the form
router.get(
  '/:id/pdf',
  authorize('handover-forms:read'),
  asyncHandler(async (req, res) => {
    const { buffer, formNumber } = await handoverService.generateHandoverFormPdf(
      req.params['id'] as string,
      req.user!.id,
    );

    // Slashes in the letter number would be read as path separators by some
    // download managers, so flatten them for the filename only.
    const fileName = `BAST-${formNumber.replace(/\//g, '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }),
);

// POST /api/handover-forms/:id/scan — multipart, field name "file"
router.post(
  '/:id/scan',
  authorize('handover-forms:update'),
  scanUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'FILE_REQUIRED', 'A scanned PDF is required (field name: "file")');
    }
    const form = await handoverService.attachSignedScan(
      req.params['id'] as string,
      { buffer: req.file.buffer, originalname: req.file.originalname },
      req.user!.id,
    );
    sendSuccess(res, form);
  }),
);

// GET /api/handover-forms/:id/scan — authenticated download of the signed scan.
// Deliberately NOT served from /uploads: the file carries real signatures and
// employee details, so every read passes through authenticate + authorize.
router.get(
  '/:id/scan',
  authorize('handover-forms:read'),
  asyncHandler(async (req, res) => {
    const { absolutePath, fileName } = await handoverService.getSignedScan(
      req.params['id'] as string,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.sendFile(absolutePath);
  }),
);

// DELETE /api/handover-forms/:id/scan — undo a mis-upload
router.delete(
  '/:id/scan',
  authorize('handover-forms:update'),
  asyncHandler(async (req, res) => {
    const form = await handoverService.deleteSignedScan(
      req.params['id'] as string,
      req.user!.id,
    );
    sendSuccess(res, form);
  }),
);

export { router as handoverFormRouter };
