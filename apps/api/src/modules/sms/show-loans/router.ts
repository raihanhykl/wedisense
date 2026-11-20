import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { getSmsAccess, requireSmsPermission } from '../lib/access.js';
import { requireIdempotencyKey } from '../lib/idempotency.js';
import { uuidParam } from '../lib/params.js';
import {
  listShowLoansQuerySchema,
  createShowLoanSchema,
  returnShowLoanSchema,
} from './schema.js';
import * as showLoanService from './service.js';

const SHOW_LOAN_NOT_FOUND = {
  code: 'SMS_SHOW_LOAN_NOT_FOUND',
  message: 'Show loan not found',
} as const;

const router: RouterType = Router();

// GET /api/sms/show-loans[?showroomId=&status=out|overdue|returned|all&page=&limit=]
// Coarse gate: STOCK_VIEW anywhere. Authoritative check is per-loan in service.
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const query = listShowLoansQuerySchema.parse(req.query);
    const { data, meta } = await showLoanService.listShowLoans(access, query);
    sendSuccess(res, data, 200, meta);
  }),
);

// GET /api/sms/show-loans/:id
router.get(
  '/:id',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const id = uuidParam(req, 'id', SHOW_LOAN_NOT_FOUND);
    const loan = await showLoanService.getShowLoan(access, id);
    sendSuccess(res, loan);
  }),
);

// POST /api/sms/show-loans  (mutating — Idempotency-Key required)
// Dispatch a unit to a show event.
// Coarse gate: SHOW_UNITS_MANAGE anywhere. Authoritative check is at unit's physicalLocationId.
router.post(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.SHOW_UNITS_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const input = createShowLoanSchema.parse(req.body);
    const result = await showLoanService.createShowLoan(access, input, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

// PUT /api/sms/show-loans/:id/return  (mutating — Idempotency-Key required)
// Receive a show unit back. No findings → AVAILABLE; findings → INSPECTION.
// Coarse gate: SHOW_UNITS_MANAGE anywhere. Authoritative check is at unit's responsibleShowroomId.
router.put(
  '/:id/return',
  requireSmsPermission(SMS_PERMISSIONS.SHOW_UNITS_MANAGE),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const id = uuidParam(req, 'id', SHOW_LOAN_NOT_FOUND);
    const input = returnShowLoanSchema.parse(req.body);
    const result = await showLoanService.returnShowLoan(access, id, input, idempotencyKey);
    sendSuccess(res, result.body, result.statusCode);
  }),
);

export { router as smsShowLoansRouter };
