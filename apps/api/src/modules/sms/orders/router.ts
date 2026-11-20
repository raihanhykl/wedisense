import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { requireSmsPermission, getSmsAccess } from '../lib/access.js';
import { requireIdempotencyKey } from '../lib/idempotency.js';
import { uuidParam } from '../lib/params.js';
import {
  createOrderSchema,
  addLinesToOrderSchema,
  cancelLineSchema,
  followUpSchema,
  recordSaleSchema,
  confirmPickupSchema,
  listOrdersQuerySchema,
  saleReturnSchema,
  decideSaleReturnSchema,
} from './schema.js';
import * as ordersService from './service.js';

const ORDER_NOT_FOUND = { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' } as const;
const ORDER_LINE_NOT_FOUND = {
  code: 'SMS_ORDER_LINE_NOT_FOUND',
  message: 'Order line not found',
} as const;

const router: RouterType = Router();

// GET /api/sms/orders
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const query = listOrdersQuerySchema.parse(req.query);
    const access = getSmsAccess(req);
    const { data, meta } = await ordersService.listOrders(query, access);
    sendSuccess(res, data, 200, meta);
  }),
);

// GET /api/sms/orders/:id
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const id = uuidParam(req, 'id', ORDER_NOT_FOUND);
    const access = getSmsAccess(req);
    const order = await ordersService.getOrder(id, access);
    sendSuccess(res, order);
  }),
);

// POST /api/sms/orders
router.post(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const key = requireIdempotencyKey(req);
    const input = createOrderSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.createOrder(key, input, access, { userId: access.userId });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// POST /api/sms/orders/:id/lines
router.post(
  '/:id/lines',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'id', ORDER_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = addLinesToOrderSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.addLinesToOrder(orderId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/orders/:oid/lines/:lid/cancel
router.put(
  '/:oid/lines/:lid/cancel',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'oid', ORDER_NOT_FOUND);
    const lineId = uuidParam(req, 'lid', ORDER_LINE_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = cancelLineSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.cancelLine(orderId, lineId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/orders/:oid/lines/:lid/follow-up
router.put(
  '/:oid/lines/:lid/follow-up',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'oid', ORDER_NOT_FOUND);
    const lineId = uuidParam(req, 'lid', ORDER_LINE_NOT_FOUND);
    const input = followUpSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.followUp(orderId, lineId, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result);
  }),
);

// PUT /api/sms/orders/:oid/record-sale
router.put(
  '/:oid/record-sale',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'oid', ORDER_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = recordSaleSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.recordSale(orderId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/orders/:oid/lines/:lid/confirm-pickup
router.put(
  '/:oid/lines/:lid/confirm-pickup',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'oid', ORDER_NOT_FOUND);
    const lineId = uuidParam(req, 'lid', ORDER_LINE_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = confirmPickupSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.confirmPickup(orderId, lineId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/orders/:oid/lines/:lid/sale-return
router.put(
  '/:oid/lines/:lid/sale-return',
  requireSmsPermission(SMS_PERMISSIONS.ORDERS_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'oid', ORDER_NOT_FOUND);
    const lineId = uuidParam(req, 'lid', ORDER_LINE_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = saleReturnSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.receiveSaleReturn(orderId, lineId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/orders/:oid/lines/:lid/sale-return/decide
router.put(
  '/:oid/lines/:lid/sale-return/decide',
  requireSmsPermission(SMS_PERMISSIONS.SALE_RETURNS_DECIDE),
  asyncHandler(async (req, res) => {
    const orderId = uuidParam(req, 'oid', ORDER_NOT_FOUND);
    const lineId = uuidParam(req, 'lid', ORDER_LINE_NOT_FOUND);
    const key = requireIdempotencyKey(req);
    const input = decideSaleReturnSchema.parse(req.body);
    const access = getSmsAccess(req);
    const result = await ordersService.decideSaleReturn(orderId, lineId, key, input, access, {
      userId: access.userId,
    });
    sendSuccess(res, result.body, result.statusCode);
  }),
);

export { router as smsOrdersRouter };
