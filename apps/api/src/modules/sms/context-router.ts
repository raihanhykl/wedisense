import { Router, type Router as RouterType } from 'express';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { getSmsAccess, listAccessibleStockLocations, requireSmsPermission } from './lib/access.js';

const router: RouterType = Router();

// GET /api/sms/context — what the signed-in user may do, and where.
//
// The web app only knows a flat permission list from /api/auth/me, which is
// not enough to decide per-showroom affordances ("can I book here?"). This
// endpoint returns the showrooms the user can see together with the SMS
// permissions held at each one. It drives the showroom switcher and which
// actions the UI offers; the server still enforces every action itself.
router.get(
  '/',
  requireSmsPermission(SMS_PERMISSIONS.STOCK_VIEW),
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);
    const showrooms = await listAccessibleStockLocations(access, SMS_PERMISSIONS.STOCK_VIEW);
    sendSuccess(res, {
      showrooms,
      globalPermissions: [...access.global].sort(),
    });
  }),
);

export { router as smsContextRouter };
