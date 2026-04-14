import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { paginationSchema } from '@wedisense/shared';
import { createMovementSchema, movementListFilterSchema } from './schema.js';
import * as movementService from './service.js';

const router: RouterType = Router();

// GET /api/movements — paginated list with filters
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const filters = movementListFilterSchema.parse(req.query);

    const { movements, meta } = await movementService.listMovements({
      ...pagination,
      ...filters,
    });
    sendSuccess(res, movements, 200, meta);
  }),
);

// GET /api/movements/:id — single movement
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const movement = await movementService.getMovement(id);
    sendSuccess(res, movement);
  }),
);

// POST /api/movements — create movement
router.post(
  '/',
  authorize('movements:create'),
  asyncHandler(async (req, res) => {
    const input = createMovementSchema.parse(req.body);
    const result = await movementService.createMovement(input, req.user!.id);
    sendCreated(res, result);
  }),
);

// PUT /api/movements/:id/approve — approve movement
router.put(
  '/:id/approve',
  authorize('movements:approve'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const movement = await movementService.approveMovement(id, req.user!.id);
    sendSuccess(res, movement);
  }),
);

// PUT /api/movements/:id/reject — reject movement
router.put(
  '/:id/reject',
  authorize('movements:approve'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const movement = await movementService.rejectMovement(id, req.user!.id);
    sendSuccess(res, movement);
  }),
);

// PUT /api/movements/:id/complete — complete movement
router.put(
  '/:id/complete',
  authorize('movements:approve'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const movement = await movementService.completeMovement(id, req.user!.id);
    sendSuccess(res, movement);
  }),
);

export { router as movementRouter };
