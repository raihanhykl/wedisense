import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createVendorSchema,
  updateVendorSchema,
  listVendorQuerySchema,
  searchVendorQuerySchema,
} from './schema.js';
import * as vendorService from './service.js';

const router: RouterType = Router();

// GET /api/vendors/search — autocomplete picker
// Must be registered BEFORE /:id so the literal "search" path doesn't get
// captured as an :id param.
router.get(
  '/search',
  authorize('vendors:read'),
  asyncHandler(async (req, res) => {
    const query = searchVendorQuerySchema.parse(req.query);
    const data = await vendorService.searchVendors(query);
    sendSuccess(res, data);
  }),
);

// GET /api/vendors — paginated list
router.get(
  '/',
  authorize('vendors:read'),
  asyncHandler(async (req, res) => {
    const query = listVendorQuerySchema.parse(req.query);
    const { skip, take, page, limit } = parsePagination(query);

    const filters = {
      search: query.search,
      isActive: query.isActive,
    };

    const { data, total } = await vendorService.listVendors(filters, skip, take);
    const meta = buildPaginationMeta(page, limit, total);
    sendSuccess(res, data, 200, meta);
  }),
);

// POST /api/vendors — create (supports inline quick-save)
router.post(
  '/',
  authorize('vendors:create'),
  asyncHandler(async (req, res) => {
    const input = createVendorSchema.parse(req.body);
    const vendor = await vendorService.createVendor(input, req.user!.id);
    sendCreated(res, vendor);
  }),
);

// GET /api/vendors/:id
router.get(
  '/:id',
  authorize('vendors:read'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const vendor = await vendorService.getVendor(id);
    sendSuccess(res, vendor);
  }),
);

// PUT /api/vendors/:id
router.put(
  '/:id',
  authorize('vendors:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateVendorSchema.parse(req.body);
    const vendor = await vendorService.updateVendor(id, input, req.user!.id);
    sendSuccess(res, vendor);
  }),
);

// DELETE /api/vendors/:id — soft delete (rejected if vendor has POs)
router.delete(
  '/:id',
  authorize('vendors:delete'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await vendorService.deleteVendor(id, req.user!.id);
    sendNoContent(res);
  }),
);

export { router as vendorRouter };
