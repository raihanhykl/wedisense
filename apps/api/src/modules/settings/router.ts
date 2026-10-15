import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/error-handler.js';
import { updateCompanySettingSchema } from './schema.js';
import * as settingsService from './service.js';

const router: RouterType = Router();

const LOGO_SIZE_LIMIT = 2 * 1024 * 1024;
const ALLOWED_LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

// Memory storage: the service inspects magic bytes before anything reaches
// disk, so a rejected upload never leaves a file behind.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_SIZE_LIMIT, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_LOGO_MIMES.has(file.mimetype)) {
      cb(new AppError(400, 'INVALID_LOGO_FORMAT', 'Logo must be a PNG or JPEG image'));
      return;
    }
    cb(null, true);
  },
});

// GET /api/settings/company
// Readable by any authenticated user: the letterhead is shown in the BAST
// preview, which anyone with handover-forms:read can open.
router.get(
  '/company',
  asyncHandler(async (_req, res) => {
    const setting = await settingsService.getCompanySetting();
    sendSuccess(res, setting);
  }),
);

// PUT /api/settings/company
router.put(
  '/company',
  authorize('settings:manage'),
  asyncHandler(async (req, res) => {
    const input = updateCompanySettingSchema.parse(req.body);
    const setting = await settingsService.updateCompanySetting(input, req.user!.id);
    sendSuccess(res, setting);
  }),
);

// POST /api/settings/company/logo — multipart, field name "file"
router.post(
  '/company/logo',
  authorize('settings:manage'),
  logoUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'FILE_REQUIRED', 'A logo file is required (field name: "file")');
    }
    const setting = await settingsService.uploadCompanyLogo(req.file.buffer, req.user!.id);
    sendSuccess(res, setting);
  }),
);

export { router as settingsRouter };
