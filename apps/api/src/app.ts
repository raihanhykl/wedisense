import express, { type Express } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { RATE_LIMIT } from '@wedisense/shared';
import { createRateLimiter } from './lib/rate-limiter.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRouter } from './modules/auth/router.js';
import { locationRouter } from './modules/locations/router.js';
import { userRouter } from './modules/users/router.js';
import { roleRouter } from './modules/roles/router.js';
import { productRouter } from './modules/products/router.js';
import { assetRouter } from './modules/assets/router.js';
import { assetCategoryRouter } from './modules/asset-categories/router.js';
import { movementRouter } from './modules/movements/router.js';
import { maintenanceRouter } from './modules/maintenance/router.js';
import { labelRouter } from './modules/labels/router.js';
import { notificationsRouter } from './modules/notifications/index.js';
import { reportsRouter } from './modules/reports/index.js';
import { dashboardRouter } from './modules/dashboard/index.js';
import { savedViewsRouter } from './modules/saved-views/router.js';
import { toursRouter } from './modules/tours/router.js';
import { auditRouter } from './modules/audit/router.js';
import { authenticate } from './middleware/authenticate.js';

const app: Express = express();

// ── Security ───────────────────────────────────────────────
//
// Hardened Helmet config (Phase 16 tier 4):
//
//  - CSP overrides the default `frame-ancestors 'self'` to `'none'`. The API
//    serves JSON; nothing about it should be framed, including by the same
//    origin. Pairs with X-Frame-Options DENY for older browsers.
//  - `connect-src` whitelists the frontend's CORS_ORIGIN so any defensive
//    error pages we render can fetch back to themselves without violating CSP.
//  - HSTS is off in dev: setting it on localhost pollutes the browser's
//    HSTS cache and turns http://localhost:* into https://localhost:* with
//    a "connection refused" surprise the next time someone debugs a non-
//    HTTPS service. Production turns it on with a year-long max-age +
//    includeSubDomains + preload for HSTS preload-list eligibility.
//  - Referrer-Policy switches from the default `no-referrer` to
//    `strict-origin-when-cross-origin` so downstream services we ping
//    (Sentry, analytics) can see WHICH wedisense instance the request
//    came from without leaking full URLs cross-site.
//  - crossOriginEmbedderPolicy stays off. Turning it on would force every
//    embedded resource (Next.js images via /api/uploads, third-party fonts)
//    to also declare COEP — instant breakage for negligible benefit.
const isProduction = process.env['NODE_ENV'] === 'production';
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", process.env['CORS_ORIGIN'] ?? 'http://localhost:3000'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
    // Match `frame-ancestors 'none'` for older browsers that still honour
    // X-Frame-Options. Helmet's default SAMEORIGIN would otherwise contradict
    // the stricter CSP directive.
    frameguard: { action: 'deny' },
  }),
);
app.use(cors({
  origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  credentials: true,
}));

// ── Rate Limiting ──────────────────────────────────────────
// General per-IP limit covers every request. Auth endpoints layer a tighter
// limit on top inside auth/router.ts — both share Redis so the count is
// consistent across replicas.
app.use(
  createRateLimiter({
    windowMs: RATE_LIMIT.GENERAL.windowMs,
    max: RATE_LIMIT.GENERAL.max,
    prefix: 'rl:general',
  }),
);

// ── Body Parsing ───────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Health Check ───────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/locations', authenticate, locationRouter);
app.use('/api/users', authenticate, userRouter);
app.use('/api/roles', authenticate, roleRouter);
app.use('/api/products', authenticate, productRouter);
app.use('/api/asset-categories', authenticate, assetCategoryRouter);
app.use('/api/assets', authenticate, assetRouter);
app.use('/api/movements', authenticate, movementRouter);
app.use('/api/maintenance', authenticate, maintenanceRouter);
app.use('/api', authenticate, labelRouter);
app.use('/api/notifications', authenticate, notificationsRouter);
app.use('/api/reports', authenticate, reportsRouter);
app.use('/api/dashboard', authenticate, dashboardRouter);
app.use('/api/saved-views', authenticate, savedViewsRouter);
app.use('/api/tours', authenticate, toursRouter);
app.use('/api/audit-logs', authenticate, auditRouter);

// ── Static Files (barcode/QR images) ──────────────────────
// Helmet's default `Cross-Origin-Resource-Policy: same-origin` would block
// the Next.js frontend (different origin) from embedding these as
// `<img src="...">` in any browser that enforces CORP. We relax to
// `cross-origin` ONLY for /uploads so JSON API responses keep the stricter
// default — only the inert image artifacts are openly embeddable.
app.use(
  '/uploads',
  express.static(path.resolve(process.env['STORAGE_PATH'] ?? './uploads'), {
    setHeaders(res) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

// ── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export { app };
