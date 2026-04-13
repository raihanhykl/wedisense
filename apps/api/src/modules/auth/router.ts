import { Router, type Router as RouterType } from 'express';
import rateLimit from 'express-rate-limit';
import { RATE_LIMIT } from '@wedisense/shared';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loginSchema, changePasswordSchema } from './schema.js';
import * as authService from './service.js';

const router: RouterType = Router();

const authRateLimit = rateLimit({
  windowMs: RATE_LIMIT.AUTH.windowMs,
  max: RATE_LIMIT.AUTH.max,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/login
router.post(
  '/login',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);

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
  asyncHandler(async (_req, res) => {
    res.clearCookie('refreshToken', { path: '/api/auth' });
    sendSuccess(res, { message: 'Logged out successfully' });
  }),
);

// POST /api/auth/refresh
router.post(
  '/refresh',
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
  asyncHandler(async (req, res) => {
    sendSuccess(res, { user: req.user });
  }),
);

// PUT /api/auth/change-password
router.put(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.user!.id, input);
    sendSuccess(res, { message: 'Password changed successfully' });
  }),
);

export { router as authRouter };
