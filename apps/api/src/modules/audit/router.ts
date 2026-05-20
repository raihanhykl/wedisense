/**
 * Audit-log read API.
 *
 *  GET /api/audit-logs           — paginated, filtered list (audit:read)
 *  GET /api/audit-logs/export    — CSV stream of filtered rows (audit:read)
 *  GET /api/audit-logs/:id       — single entry with full diff payload (audit:read)
 *
 * NOTE: /export must be declared BEFORE /:id so Express doesn't interpret
 * "export" as an id and 404 on a missing audit_log with that literal id.
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/error-handler.js';
import { auditLogFilterSchema, auditLogListQuerySchema } from './schema.js';
import { getAuditLog, listAuditLogsPaginated, streamAuditCsv } from './service.js';

const router: RouterType = Router();

// ── GET /api/audit-logs ──────────────────────────────────────────────────────
router.get(
  '/',
  authorize('audit:read'),
  asyncHandler(async (req, res) => {
    const query = auditLogListQuerySchema.parse(req.query);
    const { items, meta } = await listAuditLogsPaginated(query);
    sendSuccess(res, items, 200, meta);
  }),
);

// ── GET /api/audit-logs/export ───────────────────────────────────────────────
// Must precede /:id so the literal path wins the route match.
router.get(
  '/export',
  authorize('audit:read'),
  asyncHandler(async (req, res) => {
    const filter = auditLogFilterSchema.parse(req.query);
    await streamAuditCsv(filter, req.user!.id, res);
  }),
);

// ── GET /api/audit-logs/:id ──────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('audit:read'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(400, 'BAD_REQUEST', 'Missing audit-log id');
    const entry = await getAuditLog(id);
    sendSuccess(res, entry);
  }),
);

export { router as auditRouter };
