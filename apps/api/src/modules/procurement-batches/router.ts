import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createProcurementBatchSchema,
  updateProcurementBatchSchema,
  listProcurementBatchQuerySchema,
  receiveProcurementBatchSchema,
  completeProcurementBatchSchema,
  cancelProcurementBatchSchema,
} from './schema.js';
import * as batchService from './service.js';

const router: RouterType = Router();

// GET /api/procurement-batches
router.get(
  '/',
  authorize('procurement:read'),
  asyncHandler(async (req, res) => {
    const query = listProcurementBatchQuerySchema.parse(req.query);
    const { skip, take, page, limit } = parsePagination(query);

    const filters = {
      status: query.status,
      purchaseOrderId: query.purchaseOrderId,
      vendor: query.vendor,
      bastNumber: query.bastNumber,
      invoiceNumber: query.invoiceNumber,
      search: query.search,
      purchaseDateFrom: query.purchaseDateFrom,
      purchaseDateTo: query.purchaseDateTo,
    };

    const { data, total } = await batchService.listProcurementBatches(
      filters,
      skip,
      take,
    );
    const meta = buildPaginationMeta(page, limit, total);
    sendSuccess(res, data, 200, meta);
  }),
);

// POST /api/procurement-batches
router.post(
  '/',
  authorize('procurement:create'),
  asyncHandler(async (req, res) => {
    const input = createProcurementBatchSchema.parse(req.body);
    const batch = await batchService.createProcurementBatch(input, req.user!.id);
    sendCreated(res, batch);
  }),
);

// GET /api/procurement-batches/:id
router.get(
  '/:id',
  authorize('procurement:read'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const batch = await batchService.getProcurementBatch(id);
    sendSuccess(res, batch);
  }),
);

// PUT /api/procurement-batches/:id — metadata patch. Status transitions
// go through /submit, /receive, /complete, /cancel below.
router.put(
  '/:id',
  authorize('procurement:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateProcurementBatchSchema.parse(req.body);
    const batch = await batchService.updateProcurementBatch(id, input, req.user!.id);
    sendSuccess(res, batch);
  }),
);

// DELETE /api/procurement-batches/:id — DRAFT + zero assets only
router.delete(
  '/:id',
  authorize('procurement:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await batchService.deleteProcurementBatch(id, req.user!.id);
    sendNoContent(res);
  }),
);

// PUT /api/procurement-batches/:id/submit — DRAFT → ITEMS_PENDING
router.put(
  '/:id/submit',
  authorize('procurement:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const batch = await batchService.submitProcurementBatch(id, req.user!.id);
    sendSuccess(res, batch);
  }),
);

// PUT /api/procurement-batches/:id/receive — ITEMS_PENDING → RECEIVED
router.put(
  '/:id/receive',
  authorize('procurement:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = receiveProcurementBatchSchema.parse(req.body);
    const batch = await batchService.receiveProcurementBatch(id, input, req.user!.id);
    sendSuccess(res, batch);
  }),
);

// PUT /api/procurement-batches/:id/complete — RECEIVED → COMPLETED
// Requires the stricter procurement:complete permission since this is
// the financial close of the batch.
router.put(
  '/:id/complete',
  authorize('procurement:complete'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = completeProcurementBatchSchema.parse(req.body);
    const batch = await batchService.completeProcurementBatch(id, input, req.user!.id);
    sendSuccess(res, batch);
  }),
);

// PUT /api/procurement-batches/:id/cancel — DRAFT|ITEMS_PENDING → CANCELLED
router.put(
  '/:id/cancel',
  authorize('procurement:cancel'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = cancelProcurementBatchSchema.parse(req.body);
    const batch = await batchService.cancelProcurementBatch(id, input, req.user!.id);
    sendSuccess(res, batch);
  }),
);

// GET /api/procurement-batches/:id/audit — aggregate audit trail
// (batch's own audit_log rows + audit_log rows for every asset currently
// linked to the batch). Capped at 500 rows per query in the repo.
router.get(
  '/:id/audit',
  authorize('procurement:read'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const rows = await batchService.getBatchAuditTrail(id);
    sendSuccess(res, rows);
  }),
);

export { router as procurementBatchRouter };
