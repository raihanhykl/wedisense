import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../middleware/error-handler.js';
import { listQuerySchema, idParamSchema } from './schema.js';
import * as notificationsService from './service.js';
import {
  warrantyCheckQueue,
  loanOverdueQueue,
  maintenanceDueQueue,
  depreciationQueue,
  weeklySummaryQueue,
  tourSyncQueue,
} from '../../lib/queue.js';
import type { Queue } from 'bullmq';

const router: RouterType = Router();

// ── GET / — paginated list for current user ───────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const { items, meta } = await notificationsService.listForUser(req.user!.id, query);
    sendSuccess(res, items, 200, meta);
  }),
);

// ── GET /unread-count ─────────────────────────────────────────────────
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const data = await notificationsService.unreadCount(req.user!.id);
    sendSuccess(res, data);
  }),
);

// ── PUT /read-all — must be before /:id to avoid param conflict ───────
router.put(
  '/read-all',
  asyncHandler(async (req, res) => {
    const data = await notificationsService.markAllRead(req.user!.id);
    sendSuccess(res, data);
  }),
);

// ── PUT /:id/read ─────────────────────────────────────────────────────
router.put(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const data = await notificationsService.markRead(id, req.user!.id);
    sendSuccess(res, data);
  }),
);

// ── DEV-only: POST /_dev/trigger/:jobName ─────────────────────────────
router.post(
  '/_dev/trigger/:jobName',
  asyncHandler(async (req, res) => {
    if (process.env['NODE_ENV'] === 'production') {
      throw new AppError(404, 'NOT_FOUND', 'Not found');
    }

    const jobName = req.params['jobName'] as string;

    const queueMap: Record<string, Queue> = {
      'warranty-check': warrantyCheckQueue,
      'loan-overdue': loanOverdueQueue,
      'maintenance-due': maintenanceDueQueue,
      depreciation: depreciationQueue,
      'weekly-summary': weeklySummaryQueue,
      'tour-sync': tourSyncQueue,
    };

    const queue = queueMap[jobName];
    if (!queue) {
      throw new AppError(400, 'UNKNOWN_JOB', `Unknown job name: ${jobName}`);
    }

    await queue.add('dev-trigger', {} as never);
    sendSuccess(res, { triggered: jobName });
  }),
);

export { router as notificationsRouter };
