import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { paginationSchema } from '@wedisense/shared';
import {
  createAssetSchema,
  updateAssetSchema,
  bulkCreateAssetSchema,
  assetListFilterSchema,
} from './schema.js';
import * as assetService from './service.js';

const router: RouterType = Router();

// GET /api/assets — paginated list with filters
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const filters = assetListFilterSchema.parse(req.query);
    const accessibleLocationIds = req.user!.accessibleLocationIds;

    const { assets, meta } = await assetService.listAssets(
      { ...pagination, ...filters },
      accessibleLocationIds,
    );
    sendSuccess(res, assets, 200, meta);
  }),
);

// POST /api/assets/bulk — bulk create assets
router.post(
  '/bulk',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const { assets } = bulkCreateAssetSchema.parse(req.body);
    const result = await assetService.bulkCreateAssets(assets, req.user!.id);
    sendCreated(res, result);
  }),
);

// POST /api/assets/import — placeholder Phase 12
router.post(
  '/import',
  authorize('assets:create'),
  asyncHandler(async (_req, res) => {
    res.status(501).json({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Import feature is planned for Phase 12' },
    });
  }),
);

// GET /api/assets/export — placeholder Phase 12
router.get(
  '/export',
  authorize('assets:create'),
  asyncHandler(async (_req, res) => {
    res.status(501).json({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Export feature is planned for Phase 12' },
    });
  }),
);

// GET /api/assets/barcode/:value — lookup asset by barcode_value
router.get(
  '/barcode/:value',
  asyncHandler(async (req, res) => {
    const value = req.params['value'] as string;
    const asset = await assetService.getAssetByBarcode(value);
    sendSuccess(res, asset);
  }),
);

// POST /api/assets — create asset
router.post(
  '/',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const input = createAssetSchema.parse(req.body);
    const asset = await assetService.createAsset(input, req.user!.id);
    sendCreated(res, asset);
  }),
);

// GET /api/assets/:id — get single asset
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const asset = await assetService.getAsset(id);
    sendSuccess(res, asset);
  }),
);

// PUT /api/assets/:id — update asset
router.put(
  '/:id',
  authorize('assets:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateAssetSchema.parse(req.body);
    const asset = await assetService.updateAsset(id, input, req.user!.id);
    sendSuccess(res, asset);
  }),
);

// DELETE /api/assets/:id — soft delete asset
router.delete(
  '/:id',
  authorize('assets:delete'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await assetService.deleteAsset(id, req.user!.id);
    res.status(204).send();
  }),
);

// GET /api/assets/:id/movements — paginated movement history
router.get(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const pagination = paginationSchema.parse(req.query);
    const { movements, meta } = await assetService.getMovements(id, pagination);
    sendSuccess(res, movements, 200, meta);
  }),
);

// GET /api/assets/:id/maintenance — paginated maintenance history
router.get(
  '/:id/maintenance',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const pagination = paginationSchema.parse(req.query);
    const { logs, meta } = await assetService.getMaintenanceLogs(id, pagination);
    sendSuccess(res, logs, 200, meta);
  }),
);

export { router as assetRouter };
