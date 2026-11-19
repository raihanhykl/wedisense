import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { requireSmsPermission, getSmsAccess } from '../lib/access.js';
import { requireIdempotencyKey } from '../lib/idempotency.js';
import {
  listUnitsQuerySchema,
  searchUnitsQuerySchema,
  updateUnitDetailsSchema,
  resolveIdentitySchema,
  releaseUnitSchema,
} from './schema.js';
import * as unitsService from './service.js';

const router: RouterType = Router();

// GET /api/sms/units/search — must be before /:id to avoid param capture
router.get(
  '/search',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = searchUnitsQuerySchema.parse(req.query);
    const access = getSmsAccess(req);
    const results = await unitsService.searchUnits(query.q, access);
    sendSuccess(res, results);
  }),
);

// GET /api/sms/units
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = listUnitsQuerySchema.parse(req.query);
    const access = getSmsAccess(req);
    const { data, meta } = await unitsService.listUnits(query, access);
    sendSuccess(res, data, 200, meta);
  }),
);

// GET /api/sms/units/:id
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const access = getSmsAccess(req);
    const unit = await unitsService.getUnit(id, access);
    sendSuccess(res, unit);
  }),
);

// PUT /api/sms/units/:id/details
router.put(
  '/:id/details',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateUnitDetailsSchema.parse(req.body);
    const access = getSmsAccess(req);
    const updated = await unitsService.updateUnitDetails(id, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, updated);
  }),
);

// POST /api/sms/units/:id/resolve-identity
router.post(
  '/:id/resolve-identity',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const key = requireIdempotencyKey(req);
    const input = resolveIdentitySchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await unitsService.resolveIdentity(id, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result);
  }),
);

// POST /api/sms/units/:id/release
router.post(
  '/:id/release',
  requireSmsPermission(SMS_PERMISSIONS.INSPECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const key = requireIdempotencyKey(req);
    const input = releaseUnitSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await unitsService.releaseUnit(id, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result);
  }),
);

export { router as smsUnitsRouter };
