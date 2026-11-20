import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { getSmsAccess, requireSmsPermission } from '../lib/access.js';
import { requireIdempotencyKey } from '../lib/idempotency.js';
import { uuidParam } from '../lib/params.js';
import {
  lookupQuerySchema,
  createReturnRequestSchema,
  custodyReceivedSchema,
  decideSchema,
  officialReceiptSchema,
  custodyHandbackSchema,
  listReturnRequestsQuerySchema,
} from './schema.js';
import * as returnRequestService from './service.js';

const REQUEST_NOT_FOUND = {
  code: 'SMS_RETURN_REQUEST_NOT_FOUND',
  message: 'Return request not found',
} as const;

const router: RouterType = Router();

// GET /api/sms/return-requests/lookup?q=
// Limited cross-branch lookup: exact VIN, suffix (>=5), or exact RTO contract number.
// Gate: sms-returns:request anywhere.
router.get(
  '/lookup',
  requireSmsPermission(SMS_PERMISSIONS.RETURNS_REQUEST),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const { q } = lookupQuerySchema.parse(req.query);
    const hits = await returnRequestService.lookupUnitsForReturn(q, access);
    sendSuccess(res, hits);
  }),
);

// GET /api/sms/return-requests[?showroomId=&direction=&status=&page=&limit=]
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const query = listReturnRequestsQuerySchema.parse(req.query);
    const { data, meta } = await returnRequestService.listReturnRequests(query, access);
    sendSuccess(res, data, 200, meta);
  }),
);

// GET /api/sms/return-requests/:id
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const id = uuidParam(req, 'id', REQUEST_NOT_FOUND);
    const row = await returnRequestService.getReturnRequest(id, access);
    sendSuccess(res, row);
  }),
);

// POST /api/sms/return-requests  (mutating — Idempotency-Key required)
// Create a cross-branch return request. Gate: sms-returns:request at toShowroom.
router.post(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.RETURNS_REQUEST),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const input = createReturnRequestSchema.parse(req.body);
    const result = await returnRequestService.createReturnRequest(input, access, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/return-requests/:id/custody-received  (mutating — Idempotency-Key required)
// Record that the motorcycle has physically arrived at toShowroom before official receipt.
// Gate: sms-receiving:manage at toShowroom.
router.put(
  '/:id/custody-received',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const id = uuidParam(req, 'id', REQUEST_NOT_FOUND);
    const input = custodyReceivedSchema.parse(req.body);
    const result = await returnRequestService.custodyReceived(id, input, access, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/return-requests/:id/decide  (mutating — Idempotency-Key required)
// Approve or reject the return request. Gate: sms-returns:decide at fromShowroom.
router.put(
  '/:id/decide',
  requireSmsPermission(SMS_PERMISSIONS.RETURNS_DECIDE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const id = uuidParam(req, 'id', REQUEST_NOT_FOUND);
    const input = decideSchema.parse(req.body);
    const result = await returnRequestService.decideReturnRequest(id, input, access, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/return-requests/:id/official-receipt  (mutating — Idempotency-Key required)
// Official receipt: motor enters toShowroom officially, responsibility transfers.
// Gate: sms-receiving:manage at toShowroom.
router.put(
  '/:id/official-receipt',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const id = uuidParam(req, 'id', REQUEST_NOT_FOUND);
    const input = officialReceiptSchema.parse(req.body);
    const result = await returnRequestService.officialReceipt(id, input, access, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/return-requests/:id/custody-handback  (mutating — Idempotency-Key required)
// Hand the motorcycle back to the rider after a rejected request.
// Gate: sms-receiving:manage at toShowroom.
router.put(
  '/:id/custody-handback',
  requireSmsPermission(SMS_PERMISSIONS.RECEIVING_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const id = uuidParam(req, 'id', REQUEST_NOT_FOUND);
    const input = custodyHandbackSchema.parse(req.body);
    const result = await returnRequestService.custodyHandback(id, input, access, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

export { router as smsReturnRequestsRouter };
