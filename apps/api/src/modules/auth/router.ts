import { Router, type Router as RouterType, type Request } from 'express';
import { RATE_LIMIT } from '@wedisense/shared';
import { createRateLimiter } from '../../lib/rate-limiter.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loginSchema, changePasswordSchema } from './schema.js';
import * as authService from './service.js';
import type { AuthContext } from './service.js';

/**
 * Capture audit context (IP + user-agent) from the incoming request.
 * Express's `req.ip` honours `trust proxy` config; in dev mode without a
 * proxy this returns ::ffff:127.0.0.1, which is fine — the value is
 * informational, not a security boundary.
 */
function auditContextFrom(req: Request): AuthContext {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] ?? undefined,
  };
}

const router: RouterType = Router();

// Tighter limiter for credential-touching endpoints (login + refresh). The
// general limiter in app.ts still applies; this one tightens the cap from
// 100/min to 10/min for the same IP. Both share Redis via the factory so
// the count is consistent across replicas in production.
const authRateLimit = createRateLimiter({
  windowMs: RATE_LIMIT.AUTH.windowMs,
  max: RATE_LIMIT.AUTH.max,
  prefix: 'rl:auth',
});

// POST /api/auth/login
router.post(
  '/login',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input, auditContextFrom(req));

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth',
    });

    sendSuccess(res, {
      accessToken: result.accessToken,
      user: result.user,
    });
  }),
);

// POST /api/auth/logout
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    // Record audit BEFORE clearing the cookie so we still have req.user.id
    // in case the audit write touches anything contextual. Failure here is
    // swallowed by the service — we always proceed to cookie clearing.
    await authService.recordLogout(req.user!.id, auditContextFrom(req));
    res.clearCookie('refreshToken', { path: '/api/auth' });
    sendSuccess(res, { message: 'Logged out successfully' });
  }),
);

// POST /api/auth/refresh
router.post(
  '/refresh',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.['refreshToken'] as string | undefined;

    if (!refreshToken) {
      res.status(401).json({
        success: false,
        error: { code: 'MISSING_REFRESH_TOKEN', message: 'Refresh token is required' },
      });
      return;
    }

    const result = await authService.refreshTokens(refreshToken);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    sendSuccess(res, { accessToken: result.accessToken });
  }),
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => Promise.resolve(sendSuccess(res, { user: req.user }))),
);

// PUT /api/auth/change-password
router.put(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.user!.id, input, auditContextFrom(req));
    sendSuccess(res, { message: 'Password changed successfully' });
  }),
);

export { router as authRouter };
