import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import {
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
  assignRolesSchema,
} from './schema.js';
import * as userService from './service.js';

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

export { router as userRouter };
