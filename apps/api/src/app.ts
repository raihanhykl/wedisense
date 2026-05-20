import express, { type Express } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { RATE_LIMIT } from '@wedisense/shared';
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
app.use(helmet());
app.use(cors({
  origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  credentials: true,
}));

// ── Rate Limiting ──────────────────────────────────────────
app.use(rateLimit({
  windowMs: RATE_LIMIT.GENERAL.windowMs,
  max: RATE_LIMIT.GENERAL.max,
  standardHeaders: true,
  legacyHeaders: false,
}));

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
app.use('/uploads', express.static(path.resolve(process.env['STORAGE_PATH'] ?? './uploads')));

// ── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export { app };
