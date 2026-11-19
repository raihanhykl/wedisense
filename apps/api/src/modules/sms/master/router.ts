import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../../utils/response.js';
import { requireSmsPermission, getSmsAccess } from '../lib/access.js';
import {
  createVehicleModelSchema,
  updateVehicleModelSchema,
  listVehicleModelsQuerySchema,
  createVehicleVariantSchema,
  updateVehicleVariantSchema,
  listVehicleVariantsQuerySchema,
} from './schema.js';
import * as masterService from './service.js';

const router: RouterType = Router();

// ── Vehicle models ───────────────────────────────────────────────────────────

// GET /api/sms/master/vehicle-models
router.get(
  '/vehicle-models',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = listVehicleModelsQuerySchema.parse(req.query);
    const models = await masterService.listVehicleModels(query);
    sendSuccess(res, models);
  }),
);

// POST /api/sms/master/vehicle-models
router.post(
  '/vehicle-models',
  requireSmsPermission(SMS_PERMISSIONS.MASTER_MANAGE),
  asyncHandler(async (req, res) => {
    const input = createVehicleModelSchema.parse(req.body);
    const access = getSmsAccess(req);
    const model = await masterService.createVehicleModel(input, { userId: access.userId });
    sendCreated(res, model);
  }),
);

// PUT /api/sms/master/vehicle-models/:id
router.put(
  '/vehicle-models/:id',
  requireSmsPermission(SMS_PERMISSIONS.MASTER_MANAGE),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateVehicleModelSchema.parse(req.body);
    const access = getSmsAccess(req);
    const model = await masterService.updateVehicleModel(id, input, { userId: access.userId });
    sendSuccess(res, model);
  }),
);

// ── Vehicle variants ─────────────────────────────────────────────────────────

// GET /api/sms/master/vehicle-variants
router.get(
  '/vehicle-variants',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = listVehicleVariantsQuerySchema.parse(req.query);
    const variants = await masterService.listVehicleVariants(query);
    sendSuccess(res, variants);
  }),
);

// POST /api/sms/master/vehicle-variants
router.post(
  '/vehicle-variants',
  requireSmsPermission(SMS_PERMISSIONS.MASTER_MANAGE),
  asyncHandler(async (req, res) => {
    const input = createVehicleVariantSchema.parse(req.body);
    const access = getSmsAccess(req);
    const variant = await masterService.createVehicleVariant(input, { userId: access.userId });
    sendCreated(res, variant);
  }),
);

// PUT /api/sms/master/vehicle-variants/:id
router.put(
  '/vehicle-variants/:id',
  requireSmsPermission(SMS_PERMISSIONS.MASTER_MANAGE),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateVehicleVariantSchema.parse(req.body);
    const access = getSmsAccess(req);
    const variant = await masterService.updateVehicleVariant(id, input, { userId: access.userId });
    sendSuccess(res, variant);
  }),
);

export { router as smsMasterRouter };
