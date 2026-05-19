/**
 * Saved Views — per-user filter/sort/column configurations for list pages.
 *
 *  GET    /?resource=assets     — list the caller's views for a resource
 *  POST   /                      — create a view
 *  PUT    /:id                   — update name / config / default flag
 *  DELETE /:id                   — delete
 *
 * Authentication-only; no special permission. A saved view is the user's
 * own preference — every authenticated user can manage their own.
 */
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../middleware/error-handler.js';
import {
  createSavedViewSchema,
  savedViewResourceSchema,
  updateSavedViewSchema,
} from './schema.js';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from './service.js';

const router: RouterType = Router();

// ── GET /api/saved-views ──────────────────────────────────────────
const listQuerySchema = z.object({
  resource: savedViewResourceSchema,
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { resource } = listQuerySchema.parse(req.query);
    const views = await listSavedViews(req.user!.id, resource);
    sendSuccess(res, views);
  }),
);

// ── POST /api/saved-views ─────────────────────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSavedViewSchema.parse(req.body);
    const view = await createSavedView(req.user!.id, input);
    sendSuccess(res, view, 201);
  }),
);

// ── PUT /api/saved-views/:id ──────────────────────────────────────
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(400, 'BAD_REQUEST', 'Missing view id');
    const input = updateSavedViewSchema.parse(req.body);
    const view = await updateSavedView(req.user!.id, id, input);
    sendSuccess(res, view);
  }),
);

// ── DELETE /api/saved-views/:id ───────────────────────────────────
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(400, 'BAD_REQUEST', 'Missing view id');
    await deleteSavedView(req.user!.id, id);
    sendSuccess(res, { deleted: true });
  }),
);

export { router as savedViewsRouter };
