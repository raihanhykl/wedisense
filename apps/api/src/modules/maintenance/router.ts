import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { paginationSchema } from '@wedisense/shared';
import {
  createScheduleSchema,
  updateScheduleSchema,
  scheduleListFilterSchema,
  createLogSchema,
  logListFilterSchema,
} from './schema.js';
import * as maintenanceService from './service.js';

const router: RouterType = Router();

// ── Schedules ───────────────────────────────────────────────────────

// GET /api/maintenance/schedules — paginated list with filters
router.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const filters = scheduleListFilterSchema.parse(req.query);

    const { schedules, meta } = await maintenanceService.listSchedules({
      ...pagination,
      ...filters,
    });
    sendSuccess(res, schedules, 200, meta);
  }),
);

// POST /api/maintenance/schedules — create schedule
router.post(
  '/schedules',
  authorize('maintenance:manage'),
  asyncHandler(async (req, res) => {
    const input = createScheduleSchema.parse(req.body);
    const result = await maintenanceService.createSchedule(input, req.user!.id);
    sendCreated(res, result);
  }),
);

// GET /api/maintenance/schedules/:id — single schedule with asset + logs
router.get(
  '/schedules/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const schedule = await maintenanceService.getSchedule(id);
    sendSuccess(res, schedule);
  }),
);

// PUT /api/maintenance/schedules/:id — update schedule
router.put(
  '/schedules/:id',
  authorize('maintenance:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateScheduleSchema.parse(req.body);
    const schedule = await maintenanceService.updateSchedule(id, input, req.user!.id);
    sendSuccess(res, schedule);
  }),
);

// DELETE /api/maintenance/schedules/:id — delete schedule
router.delete(
  '/schedules/:id',
  authorize('maintenance:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await maintenanceService.deleteSchedule(id, req.user!.id);
    sendNoContent(res);
  }),
);

// ── Logs ────────────────────────────────────────────────────────────

// GET /api/maintenance/logs — paginated list with filters
router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const filters = logListFilterSchema.parse(req.query);

    const { logs, meta } = await maintenanceService.listLogs({
      ...pagination,
      ...filters,
    });
    sendSuccess(res, logs, 200, meta);
  }),
);

// POST /api/maintenance/logs — create maintenance log
router.post(
  '/logs',
  authorize('maintenance:manage'),
  asyncHandler(async (req, res) => {
    const input = createLogSchema.parse(req.body);
    const result = await maintenanceService.createLog(input, req.user!.id);
    sendCreated(res, result);
  }),
);

// ── Due ─────────────────────────────────────────────────────────────

// GET /api/maintenance/due — schedules due within 7 days
router.get(
  '/due',
  asyncHandler(async (_req, res) => {
    const schedules = await maintenanceService.getDueSchedules();
    sendSuccess(res, schedules);
  }),
);

export { router as maintenanceRouter };
