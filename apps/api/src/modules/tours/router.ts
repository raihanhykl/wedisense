/**
 * Onboarding Tours API.
 *
 *  GET    /my               — authenticated user's tours (server-side permission-filtered steps)
 *  GET    /                 — admin list (tours:manage)
 *  GET    /:id              — admin detail (tours:manage)
 *  POST   /                 — create tour (tours:manage)
 *  PUT    /:id              — update tour (tours:manage)
 *  DELETE /:id              — delete tour (tours:manage)
 *  PUT    /:id/progress     — save step progress (any authenticated user)
 *  PUT    /:id/restart      — restart tour (any authenticated user)
 *  POST   /:id/sync         — trigger tour-sync job (tours:manage)
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { createTourSchema, updateTourSchema, updateProgressSchema } from './schema.js';
import {
  getMyTours,
  listAllTours,
  getTourById,
  createTour,
  updateTour,
  deleteTour,
  updateProgress,
  restartTour,
  triggerSync,
} from './service.js';

const router: RouterType = Router();

// ── GET /api/tours/my ────────────────────────────────────────────────────────
// NOTE: must be registered BEFORE /:id so Express doesn't interpret "my" as an id.
router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const tours = await getMyTours(req.user!);
    sendSuccess(res, tours);
  }),
);

// ── GET /api/tours ───────────────────────────────────────────────────────────
router.get(
  '/',
  authorize('tours:manage'),
  asyncHandler(async (req, res) => {
    const query = {
      page: req.query['page'] ? Number(req.query['page']) : undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    };
    const { dtos, meta } = await listAllTours(query);
    sendSuccess(res, dtos, 200, meta);
  }),
);

// ── GET /api/tours/:id ───────────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('tours:manage'),
  asyncHandler(async (req, res) => {
    const tour = await getTourById(req.params['id'] as string);
    sendSuccess(res, tour);
  }),
);

// ── POST /api/tours ──────────────────────────────────────────────────────────
router.post(
  '/',
  authorize('tours:manage'),
  asyncHandler(async (req, res) => {
    const input = createTourSchema.parse(req.body);
    const tour = await createTour(input, req.user!.id);
    sendSuccess(res, tour, 201);
  }),
);

// ── PUT /api/tours/:id ───────────────────────────────────────────────────────
router.put(
  '/:id',
  authorize('tours:manage'),
  asyncHandler(async (req, res) => {
    const input = updateTourSchema.parse(req.body);
    const tour = await updateTour(req.params['id'] as string, input, req.user!.id);
    sendSuccess(res, tour);
  }),
);

// ── DELETE /api/tours/:id ────────────────────────────────────────────────────
router.delete(
  '/:id',
  authorize('tours:manage'),
  asyncHandler(async (req, res) => {
    await deleteTour(req.params['id'] as string, req.user!.id);
    sendSuccess(res, { deleted: true });
  }),
);

// ── PUT /api/tours/:id/progress ──────────────────────────────────────────────
router.put(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    const input = updateProgressSchema.parse(req.body);
    const progress = await updateProgress(req.user!, req.params['id'] as string, input);
    sendSuccess(res, progress);
  }),
);

// ── PUT /api/tours/:id/restart ───────────────────────────────────────────────
router.put(
  '/:id/restart',
  asyncHandler(async (req, res) => {
    const progress = await restartTour(req.user!, req.params['id'] as string);
    sendSuccess(res, progress);
  }),
);

// ── POST /api/tours/:id/sync ─────────────────────────────────────────────────
router.post(
  '/:id/sync',
  authorize('tours:manage'),
  asyncHandler(async (req, res) => {
    await triggerSync(req.params['id'] as string, req.user!.id);
    sendSuccess(res, { queued: true });
  }),
);

export { router as toursRouter };
