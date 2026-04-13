import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { createRoleSchema, updateRoleSchema, setPermissionsSchema } from './schema.js';
import * as roleService from './service.js';

const router: RouterType = Router();

// GET /api/roles
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const roles = await roleService.listRoles();
    sendSuccess(res, roles);
  }),
);

// POST /api/roles
router.post(
  '/',
  authorize('roles:manage'),
  asyncHandler(async (req, res) => {
    const input = createRoleSchema.parse(req.body);
    const role = await roleService.createRole(input, req.user!.id);
    sendCreated(res, role);
  }),
);

// GET /api/roles/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const role = await roleService.getRole(id);
    sendSuccess(res, role);
  }),
);

// PUT /api/roles/:id
router.put(
  '/:id',
  authorize('roles:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateRoleSchema.parse(req.body);
    const role = await roleService.updateRole(id, input, req.user!.id);
    sendSuccess(res, role);
  }),
);

// DELETE /api/roles/:id
router.delete(
  '/:id',
  authorize('roles:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    await roleService.deleteRole(id, req.user!.id);
    sendNoContent(res);
  }),
);

// GET /api/roles/:id/permissions
router.get(
  '/:id/permissions',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const permissions = await roleService.getRolePermissions(id);
    sendSuccess(res, permissions);
  }),
);

// PUT /api/roles/:id/permissions
router.put(
  '/:id/permissions',
  authorize('roles:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = setPermissionsSchema.parse(req.body);
    const permissions = await roleService.setRolePermissions(id, input, req.user!.id);
    sendSuccess(res, permissions);
  }),
);

export { router as roleRouter };
