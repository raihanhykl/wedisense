import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { requireSmsPermission, getSmsAccess } from '../lib/access.js';
import { dashboardShowroomQuerySchema } from './schema.js';
import * as dashboardService from './service.js';

const router: RouterType = Router();

// GET /api/sms/dashboard/summary?showroomId=
router.get(
  '/summary',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const { showroomId } = dashboardShowroomQuerySchema.parse(req.query);
    const access = getSmsAccess(req);
    const summary = await dashboardService.getDashboardSummary(showroomId, access);
    sendSuccess(res, summary);
  }),
);

// GET /api/sms/dashboard/tasks?showroomId=
router.get(
  '/tasks',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const { showroomId } = dashboardShowroomQuerySchema.parse(req.query);
    const access = getSmsAccess(req);
    const tasks = await dashboardService.getDashboardTasks(showroomId, access);
    sendSuccess(res, tasks);
  }),
);

export { router as smsDashboardRouter };
