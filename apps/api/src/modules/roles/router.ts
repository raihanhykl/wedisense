import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import {
  cloneRoleSchema,
  createRoleSchema,
  updateRoleSchema,
  setPermissionsSchema,
} from './schema.js';
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
    // Self-demote confirmation header. Validated server-side because a
    // client-only check is bypassable (any direct API caller would skip
    // the typed-CONFIRM dialog). Set only when the user typed CONFIRM.
    const selfDemoteConfirm = req.headers['x-self-demote-confirm'];
    const selfDemoteValue =
      typeof selfDemoteConfirm === 'string' ? selfDemoteConfirm : undefined;
    const permissions = await roleService.setRolePermissions(
      id,
      input,
      req.user!.id,
      selfDemoteValue,
    );
    sendSuccess(res, permissions);
  }),
);

// GET /api/roles/:id/users — impact preview for the permission editor's
// diff modal. Surfaces the users currently assigned this role so admins
// can see WHO is affected before committing a permission change.
router.get(
  '/:id/users',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const users = await roleService.getRoleUsers(id);
    sendSuccess(res, users);
  }),
);

// POST /api/roles/:id/clone — create a new custom role inheriting the
// source role's permissions. Always produces a non-system role.
router.post(
  '/:id/clone',
  authorize('roles:manage'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = cloneRoleSchema.parse(req.body);
    const role = await roleService.cloneRole(id, input, req.user!.id);
    sendCreated(res, role);
  }),
);

// GET /api/roles/:id/history — paginated audit trail for one role.
// Covers both Role (CREATE/UPDATE/DELETE) and RolePermission (UPDATE)
// resource types — they're both "what happened to this role".
router.get(
  '/:id/history',
  authorize('audit:read'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const limit = req.query['limit'] ? Number(req.query['limit']) : undefined;
    const offset = req.query['offset'] ? Number(req.query['offset']) : undefined;
    const history = await roleService.getRoleAuditHistory(id, {
      limit,
      offset,
    });
    sendSuccess(res, history);
  }),
);

export { router as roleRouter };
