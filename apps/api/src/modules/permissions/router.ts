/**
 * Permissions sub-router — mounted at /api/permissions.
 *
 * Read-only endpoint: returns the full permission catalogue. The catalogue
 * is seeded at install time (prisma/seed.ts) and rarely changes — a new
 * resource being added to the app is a development-time event, not a
 * runtime one. The Admin role-permission editor uses this to render the
 * matrix; without it the UI loads an empty list and edits silently fail.
 *
 * No `authorize()` guard here on purpose. The route is intended to
 * populate dropdowns + permission editors visible to admins who already
 * gate at the page level (`roles:manage`). Limiting visibility further
 * would break population for ADMIN users who hold `users:manage` but not
 * `roles:manage`, since the user form lists user-role assignments which
 * sometimes surface permission detail. `authenticate` is applied at the
 * mount level in app.ts, so callers must at least be logged in.
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import * as permissionService from './service.js';

const router: RouterType = Router();

// GET /api/permissions — full catalogue, ordered by resource then action so
// the editor renders sections in a stable order.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const permissions = await permissionService.listPermissions();
    sendSuccess(res, permissions);
  }),
);

export { router as permissionRouter };
