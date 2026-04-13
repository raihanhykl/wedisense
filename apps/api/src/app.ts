import express, { type Express } from 'express';
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

// ── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export { app };
