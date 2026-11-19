import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { getSmsAccess, requireSmsPermission } from '../lib/access.js';
import { requireIdempotencyKey } from '../lib/idempotency.js';
import { listInspectionsQuerySchema, startInspectionSchema, setInspectionResultSchema } from './schema.js';
import * as inspectionService from './service.js';

const router: RouterType = Router();

// GET /api/sms/inspections?showroomId=…[&result=…][&unitId=…][&page=…][&limit=…]
// Coarse gate: STOCK_VIEW anywhere. Authoritative check is assertCan(STOCK_VIEW, showroomId) in service.
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const query = listInspectionsQuerySchema.parse(req.query);
    const { data, meta } = await inspectionService.listInspections(access, query);
    sendSuccess(res, data, 200, meta);
  }),
);

// GET /api/sms/inspections/:id
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const id = req.params['id'] as string;
    const inspection = await inspectionService.getInspection(access, id);
    sendSuccess(res, inspection);
  }),
);

// POST /api/sms/inspections  (mutating — Idempotency-Key required)
// Coarse gate: INSPECTIONS_MANAGE anywhere. Authoritative check is assertCan at unit's physicalLocationId in service.
router.post(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.INSPECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const input = startInspectionSchema.parse(req.body);
    const result = await inspectionService.startInspection(access, input, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/inspections/:id/result  (mutating — Idempotency-Key required)
router.put(
  '/:id/result',
  requireSmsPermission(SMS_PERMISSIONS.INSPECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const id = req.params['id'] as string;
    const input = setInspectionResultSchema.parse(req.body);
    const result = await inspectionService.setInspectionResult(access, id, input, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

export { router as smsInspectionsRouter };
