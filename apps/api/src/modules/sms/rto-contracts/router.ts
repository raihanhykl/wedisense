import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { requireSmsPermission, getSmsAccess } from '../lib/access.js';
import { requireIdempotencyKey } from '../lib/idempotency.js';
import { uuidParam } from '../lib/params.js';
import {
  createRtoContractSchema,
  rtoReturnSchema,
  closeRtoContractSchema,
  ownershipTransferSchema,
  listRtoContractsQuerySchema,
} from './schema.js';
import * as rtoService from './service.js';

const CONTRACT_NOT_FOUND = {
  code: 'SMS_RTO_CONTRACT_NOT_FOUND',
  message: 'RTO contract not found',
} as const;

const router: RouterType = Router();

// GET /api/sms/rto-contracts
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = listRtoContractsQuerySchema.parse(req.query);
    const access = getSmsAccess(req);
    const { data, meta } = await rtoService.listRtoContracts(query, access);
    sendSuccess(res, data, 200, meta);
  }),
);

// GET /api/sms/rto-contracts/:id
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const id = uuidParam(req, 'id', CONTRACT_NOT_FOUND);
    const access = getSmsAccess(req);
    const contract = await rtoService.getRtoContract(id, access);
    sendSuccess(res, contract);
  }),
);

// POST /api/sms/rto-contracts
router.post(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.RTO_MANAGE),
  asyncHandler(async (req, res) => {
    const key = requireIdempotencyKey(req);
    const input = createRtoContractSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await rtoService.createRtoContract(key, input, access, { userId: access.userId });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/rto-contracts/:id/return
router.put(
  '/:id/return',
  requireSmsPermission(SMS_PERMISSIONS.RTO_MANAGE),
  asyncHandler(async (req, res) => {
    const contractId = uuidParam(req, 'id', CONTRACT_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = rtoReturnSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await rtoService.returnRtoContract(contractId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/rto-contracts/:id/close
router.put(
  '/:id/close',
  requireSmsPermission(SMS_PERMISSIONS.RTO_MANAGE),
  asyncHandler(async (req, res) => {
    const contractId = uuidParam(req, 'id', CONTRACT_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = closeRtoContractSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await rtoService.closeRtoContract(contractId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/rto-contracts/:id/ownership-transfer
router.put(
  '/:id/ownership-transfer',
  requireSmsPermission(SMS_PERMISSIONS.RTO_MANAGE),
  asyncHandler(async (req, res) => {
    const contractId = uuidParam(req, 'id', CONTRACT_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = ownershipTransferSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await rtoService.transferOwnership(contractId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

export { router as smsRtoContractsRouter };
