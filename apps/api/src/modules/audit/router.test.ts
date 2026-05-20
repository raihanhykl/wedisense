/**
 * Integration tests for the Audit-Log HTTP layer.
 *
 * Same approach as tours/router.test.ts: stub-auth middleware injects
 * req.user, the real audit router runs (exercising authorize() + Zod),
 * and the service module is mocked so no DB is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    auditLog: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('./service.js', () => ({
  listAuditLogsPaginated: vi.fn(),
  getAuditLog: vi.fn(),
  streamAuditCsv: vi.fn(),
  EXPORT_MAX_ROWS: 50_000,
}));

import { auditRouter } from './router.js';
import * as service from './service.js';
import { errorHandler, AppError } from '../../middleware/error-handler.js';
import type { AuthenticatedUser } from '../auth/types.js';

type MockFn = ReturnType<typeof vi.fn>;

const mockList = service.listAuditLogsPaginated as MockFn;
const mockGet = service.getAuditLog as MockFn;
const mockStream = service.streamAuditCsv as MockFn;

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeUser(perms: string[] = ['audit:read']): AuthenticatedUser {
  return {
    id: USER_ID,
    name: 'Admin',
    email: 'admin@test.com',
    employeeId: 'EMP-1',
    preferredLanguage: 'en',
    status: 'ACTIVE',
    roles: [{ id: 'role-1', name: 'ADMIN', locationId: null }],
    permissions: perms,
    accessibleLocationIds: [],
    hasIncompleteTour: false,
  };
}

function buildApp(user: AuthenticatedUser): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    req.user = user;
    next();
  });
  app.use('/api/audit-logs', auditRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  // Use resetAllMocks for the same reason as service.test.ts — queued
  // mockResolvedValueOnce calls shouldn't bleed across tests.
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit-logs
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit-logs', () => {
  it('403 when caller lacks audit:read', async () => {
    const app = buildApp(makeUser(['assets:read']));
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('200 with paginated body shape on happy path', async () => {
    mockList.mockResolvedValue({
      items: [{ id: 'log-1', action: 'UPDATE' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const app = buildApp(makeUser());
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('forwards filter query params to the service', async () => {
    mockList.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const app = buildApp(makeUser());

    await request(app)
      .get('/api/audit-logs')
      .query({ action: 'DELETE', resourceType: 'Asset', page: '2', limit: '50' });

    const call = mockList.mock.calls[0] as [{
      action?: string;
      resourceType?: string;
      page?: number;
      limit?: number;
    }];
    expect(call[0].action).toBe('DELETE');
    expect(call[0].resourceType).toBe('Asset');
    expect(call[0].page).toBe(2);
    expect(call[0].limit).toBe(50);
  });

  it('422 when action is not a valid enum value', async () => {
    const app = buildApp(makeUser());
    const res = await request(app).get('/api/audit-logs').query({ action: 'NUKE' });
    expect(res.status).toBe(422);
  });

  it('422 when userId is not a UUID', async () => {
    const app = buildApp(makeUser());
    const res = await request(app).get('/api/audit-logs').query({ userId: 'not-uuid' });
    expect(res.status).toBe(422);
  });

  it('422 when limit exceeds 100', async () => {
    const app = buildApp(makeUser());
    const res = await request(app).get('/api/audit-logs').query({ limit: '500' });
    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit-logs/export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit-logs/export', () => {
  it('403 when caller lacks audit:read', async () => {
    const app = buildApp(makeUser(['assets:read']));
    const res = await request(app).get('/api/audit-logs/export');
    expect(res.status).toBe(403);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('invokes streamAuditCsv with parsed filter + actor id', async () => {
    mockStream.mockImplementation(async (_f, _u, res: Response) => {
      res.setHeader('Content-Type', 'text/csv');
      res.send('header\n');
    });
    const app = buildApp(makeUser());

    await request(app)
      .get('/api/audit-logs/export')
      .query({ action: 'LOGIN', dateFrom: '2026-01-01T00:00:00Z' });

    expect(mockStream).toHaveBeenCalledOnce();
    const call = mockStream.mock.calls[0] as [
      { action?: string; dateFrom?: Date },
      string,
      Response,
    ];
    expect(call[0].action).toBe('LOGIN');
    expect(call[0].dateFrom).toBeInstanceOf(Date);
    expect(call[1]).toBe(USER_ID);
  });

  it('does not match /:id route (path priority verified)', async () => {
    // Sanity check: /export must resolve to the export handler, NOT the
    // /:id handler. If the order in router.ts is ever reversed, the
    // streamAuditCsv mock won't be hit — getAuditLog will, and respond 404.
    mockStream.mockImplementation(async (_f, _u, res: Response) => {
      res.status(200).send('csv-body');
    });
    const app = buildApp(makeUser());
    const res = await request(app).get('/api/audit-logs/export');

    expect(res.status).toBe(200);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockStream).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit-logs/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit-logs/:id', () => {
  it('403 when caller lacks audit:read', async () => {
    const app = buildApp(makeUser(['assets:read']));
    const res = await request(app).get(`/api/audit-logs/${LOG_ID}`);
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('200 with the full DTO on happy path', async () => {
    mockGet.mockResolvedValue({
      id: LOG_ID,
      action: 'UPDATE',
      oldValues: { name: 'Old' },
      newValues: { name: 'New' },
    });
    const app = buildApp(makeUser());

    const res = await request(app).get(`/api/audit-logs/${LOG_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(LOG_ID);
    expect(res.body.data.oldValues).toEqual({ name: 'Old' });
    expect(mockGet).toHaveBeenCalledWith(LOG_ID);
  });

  it('404 when service throws AUDIT_LOG_NOT_FOUND', async () => {
    mockGet.mockRejectedValue(
      new AppError(404, 'AUDIT_LOG_NOT_FOUND', 'Audit log not found'),
    );
    const app = buildApp(makeUser());

    const res = await request(app).get(`/api/audit-logs/${LOG_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('AUDIT_LOG_NOT_FOUND');
  });
});
