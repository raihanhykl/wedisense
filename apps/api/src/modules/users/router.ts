import { Router, type Router as RouterType } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
  assignRolesSchema,
  resetUserPasswordSchema,
} from './schema.js';
import * as userService from './service.js';

// Same shape as auth/router.ts. Inlined (not extracted) because the
// surface is two lines and centralizing it here would invert the
// dependency direction (users → auth utils).
function auditContextFrom(req: Request): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] ?? undefined,
  };
}

const router: RouterType = Router();

// GET /api/users
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = userListQuerySchema.parse(req.query);
    const { skip, take, page, limit } = parsePagination(query);

    const filters = {
      status: query.status,
      roleId: query.roleId,
      search: query.search,
    };

    const { data, total } = await userService.listUsers(filters, skip, take);
    const meta = buildPaginationMeta(page, limit, total);
    sendSuccess(res, data, 200, meta);
  }),
);

// POST /api/users
router.post(
  '/',
  authorize('users:manage'),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await userService.createUser(input, req.user!.id);
    sendCreated(res, user);
  }),
);

// GET /api/users/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const user = await userService.getUser(id);
    sendSuccess(res, user);
  }),
);

// PUT /api/users/:id
router.put(
  '/:id',
  authorize('users:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(id, input, req.user!.id);
    sendSuccess(res, user);
  }),
);

// DELETE /api/users/:id
router.delete(
  '/:id',
  authorize('users:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await userService.deleteUser(id, req.user!.id);
    sendNoContent(res);
  }),
);

// PUT /api/users/:id/roles
router.put(
  '/:id/roles',
  authorize('users:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = assignRolesSchema.parse(req.body);
    const roles = await userService.assignRoles(id, input, req.user!.id);
    sendSuccess(res, roles);
  }),
);

// POST /api/users/:id/reset-password — Phase 17 v2.
//
// Admin-driven password override. Distinct from /api/auth/change-password
// (self-service) — that endpoint verifies the user's OWN current password,
// while this one verifies the ACTOR's password and lets them set a new
// one on another account. Gated behind the dedicated
// `users:reset-password` permission so it can be granted to SUPER_ADMIN
// only without affecting the broader `users:manage` permission held by
// ADMIN.
router.post(
  '/:id/reset-password',
  authorize('users:reset-password'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = resetUserPasswordSchema.parse(req.body);
    await userService.resetUserPassword(
      id,
      input,
      req.user!.id,
      auditContextFrom(req),
    );
    sendNoContent(res);
  }),
);

export { router as userRouter };
