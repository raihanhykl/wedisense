import { Router, type Router as RouterType } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { paginationSchema } from '@wedisense/shared';
import {
  createAssetSchema,
  updateAssetSchema,
  bulkCreateAssetSchema,
  assetListFilterSchema,
  bulkMoveLocationSchema,
  bulkAssignUserSchema,
  bulkChangeConditionSchema,
  bulkDeleteSchema,
} from './schema.js';
import * as assetService from './service.js';
import { count as countAssets } from './repository.js';
import { generateAssetListReport } from '../reports/generators/asset-list.generator.js';
import { reportGenerateQueue } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { assetImportRouter } from './import-router.js';

const router: RouterType = Router();

const ASYNC_ROW_THRESHOLD = 5000;

// ── Import sub-router (multer scoped inside) ──────────────────────────
// Must be registered before /:id to prevent shadowing
router.use('/import', assetImportRouter);

// ── GET /api/assets — paginated list with filters ─────────────────────
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

// ── POST /api/assets/bulk — bulk create assets ────────────────────────
router.post(
  '/bulk',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const { assets } = bulkCreateAssetSchema.parse(req.body);
    const result = await assetService.bulkCreateAssets(assets, req.user!.id);
    sendCreated(res, result);
  }),
);

// ── Bulk action endpoints ──────────────────────────────────────────
// Permission model:
//   - move-location, assign-user, change-condition → assets:update
//   - delete                                       → assets:delete
// Each returns a per-asset success/failure breakdown so the UI can show
// a "moved 95 of 100" toast plus a drilldown for the failures.

router.post(
  '/bulk-move-location',
  authorize('assets:update'),
  asyncHandler(async (req, res) => {
    const { assetIds, toLocationId } = bulkMoveLocationSchema.parse(req.body);
    const result = await assetService.bulkMoveAssets(
      assetIds,
      toLocationId,
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, result);
  }),
);

router.post(
  '/bulk-assign-user',
  authorize('assets:update'),
  asyncHandler(async (req, res) => {
    const { assetIds, toUserId } = bulkAssignUserSchema.parse(req.body);
    const result = await assetService.bulkAssignAssets(
      assetIds,
      toUserId,
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, result);
  }),
);

router.post(
  '/bulk-change-condition',
  authorize('assets:update'),
  asyncHandler(async (req, res) => {
    const { assetIds, condition } = bulkChangeConditionSchema.parse(req.body);
    const result = await assetService.bulkChangeAssetCondition(
      assetIds,
      condition,
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, result);
  }),
);

router.post(
  '/bulk-delete',
  authorize('assets:delete'),
  asyncHandler(async (req, res) => {
    const { assetIds } = bulkDeleteSchema.parse(req.body);
    const result = await assetService.bulkDeleteAssets(
      assetIds,
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, result);
  }),
);

// ── GET /api/assets/export — export to Excel (sync ≤5000, async ≥5000)
router.get(
  '/export',
  authorize('assets:export'),
  asyncHandler(async (req, res) => {
    const filters = assetListFilterSchema.parse(req.query);
    const accessibleLocationIds = req.user!.accessibleLocationIds;

    const where: Prisma.AssetWhereInput = {
      deletedAt: null,
      locationId: { in: accessibleLocationIds },
      ...(filters.status && { status: filters.status }),
      ...(filters.condition && { condition: filters.condition }),
      ...(filters.categoryId && { product: { categoryId: filters.categoryId } }),
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(filters.assignedToUserId && { assignedToUserId: filters.assignedToUserId }),
      ...((filters.purchaseDateFrom || filters.purchaseDateTo) && {
        purchaseDate: {
          ...(filters.purchaseDateFrom && { gte: filters.purchaseDateFrom }),
          ...(filters.purchaseDateTo && { lte: filters.purchaseDateTo }),
        },
      }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { assetNumber: { contains: filters.search, mode: 'insensitive' } },
          { serialNumber: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    };

    const total = await countAssets(where);

    // Filter set forwarded to the generator. Dates must be serialised to ISO
    // strings so the JSON-stored Report.parameters round-trips correctly for
    // the async path.
    const generatorParameters: Record<string, unknown> = {
      locationIds: accessibleLocationIds,
    };
    if (filters.status) generatorParameters['status'] = filters.status;
    if (filters.condition) generatorParameters['condition'] = filters.condition;
    if (filters.categoryId) generatorParameters['categoryId'] = filters.categoryId;
    if (filters.locationId) generatorParameters['locationId'] = filters.locationId;
    if (filters.assignedToUserId) generatorParameters['assignedToUserId'] = filters.assignedToUserId;
    if (filters.search) generatorParameters['search'] = filters.search;
    if (filters.purchaseDateFrom) {
      generatorParameters['purchaseDateFrom'] = filters.purchaseDateFrom.toISOString();
    }
    if (filters.purchaseDateTo) {
      generatorParameters['purchaseDateTo'] = filters.purchaseDateTo.toISOString();
    }

    if (total >= ASYNC_ROW_THRESHOLD) {
      // Async: create Report record + enqueue job
      const report = await prisma.report.create({
        data: {
          name: `Asset Export ${new Date().toISOString().split('T')[0] ?? ''}`,
          type: 'ASSET_LIST',
          parameters: generatorParameters as unknown as Prisma.InputJsonValue,
          status: 'GENERATING',
          createdBy: { connect: { id: req.user!.id } },
        },
      });

      await reportGenerateQueue.add(
        'generate',
        { reportId: report.id, format: 'excel' },
        {
          jobId: `report-${report.id}`,
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      );

      sendSuccess(res, {
        mode: 'async',
        reportId: report.id,
        message: `Export queued (${total} assets). You will be notified when ready.`,
      });
      return;
    }

    // Sync: generate Excel and stream directly.
    // CRITICAL: always pass `locationIds` (RBAC scope) so a location-scoped
    // user cannot pull assets outside their accessible locations.
    const buffer = await generateAssetListReport(generatorParameters, 'excel');

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'EXPORT',
        resourceType: 'Asset',
        resourceId: 'bulk',
        newValues: { filters, count: total } as unknown as Prisma.InputJsonValue,
      },
    });

    const date = new Date().toISOString().split('T')[0] ?? 'export';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="assets-export-${date}.xlsx"`,
    );
    res.send(buffer);
  }),
);

// ── GET /api/assets/barcode/:value ────────────────────────────────────
router.get(
  '/barcode/:value',
  asyncHandler(async (req, res) => {
    const value = req.params['value'] as string;
    const asset = await assetService.getAssetByBarcode(
      value,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, asset);
  }),
);

// ── POST /api/assets — create asset ──────────────────────────────────
router.post(
  '/',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const input = createAssetSchema.parse(req.body);
    const asset = await assetService.createAsset(input, req.user!.id);
    sendCreated(res, asset);
  }),
);

// ── GET /api/assets/:id ───────────────────────────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const asset = await assetService.getAsset(id, req.user!.accessibleLocationIds);
    sendSuccess(res, asset);
  }),
);

// ── PUT /api/assets/:id ───────────────────────────────────────────────
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

// ── DELETE /api/assets/:id ────────────────────────────────────────────
router.delete(
  '/:id',
  authorize('assets:delete'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await assetService.deleteAsset(id, req.user!.id);
    res.status(204).send();
  }),
);

// ── GET /api/assets/:id/movements ────────────────────────────────────
router.get(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const pagination = paginationSchema.parse(req.query);
    const { movements, meta } = await assetService.getMovements(id, pagination);
    sendSuccess(res, movements, 200, meta);
  }),
);

// ── GET /api/assets/:id/maintenance ──────────────────────────────────
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
