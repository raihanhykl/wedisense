import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import * as dashboardService from './service.js';

const router: RouterType = Router();

// All dashboard routes are read-only. Authentication is enforced at the mount
// point in app.ts — no per-permission gate here (every authenticated user has
// a dashboard). Location scope filtering is applied inside each service function.

// GET /api/dashboard/summary
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getSummary(
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, data);
  }),
);

// GET /api/dashboard/alerts
router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getAlerts(
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, data);
  }),
);

// GET /api/dashboard/movements/recent
router.get(
  '/movements/recent',
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getRecentMovements(
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, data);
  }),
);

// GET /api/dashboard/assets/by-location
router.get(
  '/assets/by-location',
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getAssetsByLocation(
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, data);
  }),
);

// GET /api/dashboard/assets/by-category
router.get(
  '/assets/by-category',
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getAssetsByCategory(
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, data);
  }),
);

// GET /api/dashboard/depreciation/summary
router.get(
  '/depreciation/summary',
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getDepreciationSummary(
      req.user!.id,
      req.user!.accessibleLocationIds,
    );
    sendSuccess(res, data);
  }),
);

export { router as dashboardRouter };
