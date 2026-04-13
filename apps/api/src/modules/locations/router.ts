import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createLocationSchema,
  updateLocationSchema,
  locationListQuerySchema,
} from './schema.js';
import * as locationService from './service.js';

const router: RouterType = Router();

// GET /api/locations/tree — must be before /:id
router.get(
  '/tree',
  asyncHandler(async (_req, res) => {
    const tree = await locationService.getLocationTree();
    sendSuccess(res, tree);
  }),
);

// GET /api/locations
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = locationListQuerySchema.parse(req.query);
    const { skip, take, page, limit } = parsePagination(query);

    const filters = {
      type: query.type,
      isActive: query.isActive,
      search: query.search,
    };

    const { data, total } = await locationService.listLocations(filters, skip, take);
    const meta = buildPaginationMeta(page, limit, total);
    sendSuccess(res, data, 200, meta);
  }),
);

// POST /api/locations
router.post(
  '/',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const input = createLocationSchema.parse(req.body);
    const location = await locationService.createLocation(input, req.user!.id);
    sendCreated(res, location);
  }),
);

// GET /api/locations/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const location = await locationService.getLocation(id);
    sendSuccess(res, location);
  }),
);

// PUT /api/locations/:id
router.put(
  '/:id',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateLocationSchema.parse(req.body);
    const location = await locationService.updateLocation(id, input, req.user!.id);
    sendSuccess(res, location);
  }),
);

// DELETE /api/locations/:id
router.delete(
  '/:id',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await locationService.deleteLocation(id, req.user!.id);
    sendNoContent(res);
  }),
);

// GET /api/locations/:id/children
router.get(
  '/:id/children',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const children = await locationService.getChildren(id);
    sendSuccess(res, children);
  }),
);

// GET /api/locations/:id/ancestors
router.get(
  '/:id/ancestors',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const ancestors = await locationService.getAncestors(id);
    sendSuccess(res, ancestors);
  }),
);

export { router as locationRouter };
