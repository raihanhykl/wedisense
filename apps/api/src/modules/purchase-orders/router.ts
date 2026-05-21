import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  listPurchaseOrderQuerySchema,
  cancelPurchaseOrderSchema,
} from './schema.js';
import * as poService from './service.js';

const router: RouterType = Router();

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
