/**
 * Integration tests for the Tours HTTP layer.
 *
 * Strategy: build a minimal Express app that:
 *   1. Mounts a stub-auth middleware injecting req.user (no JWT/DB needed)
 *   2. Mounts the real toursRouter (so Zod parsing and authorize() are exercised)
 *   3. Mocks the service layer so no DB / Redis is touched
 *
 * This exercises: authorize middleware, Zod validation, HTTP status codes,
 * response shape — without duplicating service-level logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Module mocks (must be hoisted before any imports that use them) ───────────

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    role: { findUnique: vi.fn() },
    onboardingTour: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    userTourProgress: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/queue.js', () => ({
  tourSyncQueue: { add: vi.fn().mockResolvedValue({}) },
}));

vi.mock('./service.js', () => ({
  getMyTours: vi.fn(),
  listAllTours: vi.fn(),
  getTourById: vi.fn(),
  createTour: vi.fn(),
  updateTour: vi.fn(),
  deleteTour: vi.fn(),
  updateProgress: vi.fn(),
  restartTour: vi.fn(),
  triggerSync: vi.fn(),
}));

import { toursRouter } from './router.js';
import * as service from './service.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { AppError } from '../../middleware/error-handler.js';
import type { AuthenticatedUser } from '../auth/types.js';

// ── Typed mock accessors ──────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;

const mockGetMyTours      = service.getMyTours      as MockFn;
const mockListAllTours    = service.listAllTours    as MockFn;
const mockGetTourById     = service.getTourById     as MockFn;
const mockCreateTour      = service.createTour      as MockFn;
const mockUpdateTour      = service.updateTour      as MockFn;
const mockDeleteTour      = service.deleteTour      as MockFn;
const mockUpdateProgress  = service.updateProgress  as MockFn;
const mockRestartTour     = service.restartTour     as MockFn;
const mockTriggerSync     = service.triggerSync     as MockFn;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOUR_ID   = '11111111-1111-1111-1111-111111111111';
const ROLE_ID   = '22222222-2222-2222-2222-222222222222';
const USER_ID   = '33333333-3333-3333-3333-333333333333';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    employeeId: 'EMP-001',
    preferredLanguage: 'en',
    status: 'ACTIVE',
    roles: [{ id: ROLE_ID, name: 'ADMIN', locationId: null }],
    permissions: ['tours:manage', 'assets:read'],
    accessibleLocationIds: [],
    hasIncompleteTour: false,
    ...overrides,
  };
}

/** Minimal tour DTO returned by service functions. */
function makeTourDto(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: TOUR_ID,
    name: 'Admin Onboarding',
    description: 'Admin tour',
    isActive: true,
    roleId: ROLE_ID,
    roleName: 'ADMIN',
    steps: [],
    progress: null,
    ...overrides,
  };
}

/** Minimal progress DTO returned by updateProgress / restartTour. */
function makeProgressDto(): Record<string, unknown> {
  return {
    completedSteps: [],
    lastStepIndex: 0,
    isCompleted: false,
    isSkipped: false,
    lastSeenAt: null,
  };
}

/** Valid step payload for create/update. */
function makeStep(index = 0): Record<string, unknown> {
  return {
    stepIndex: index,
    title: `tours.test.step${index}.title`,
    description: `tours.test.step${index}.description`,
    targetElement: `[data-tour='step-${index}']`,
    position: 'bottom',
    requiredPermission: null,
    route: '/dashboard',
    isActive: true,
  };
}

// ── App factory ───────────────────────────────────────────────────────────────
//
// Each test that needs a specific user identity calls buildApp(user).
// The stub-auth middleware skips JWT verification and just stamps req.user.

function buildApp(user: AuthenticatedUser): Express {
  const app = express();
  app.use(express.json());

  // Stub authenticate: inject the provided user without touching JWT/DB
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    req.user = user;
    next();
  });

  app.use('/api/tours', toursRouter);
  app.use(errorHandler);
  return app;
}

/** App with no user (simulate missing auth by not setting req.user). */
function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  // No user injected — req.user stays undefined
  app.use('/api/tours', toursRouter);
  app.use(errorHandler);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tours/my
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/tours/my', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('200 — returns tours array in success envelope', async () => {
    const user = makeUser();
    const tours = [makeTourDto(), makeTourDto({ id: '44444444-4444-4444-4444-444444444444' })];
    mockGetMyTours.mockResolvedValue(tours);

    const res = await request(buildApp(user)).get('/api/tours/my');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('calls service.getMyTours with the authenticated user object', async () => {
    const user = makeUser({ permissions: ['assets:read'] }); // no tours:manage
    mockGetMyTours.mockResolvedValue([]);

    await request(buildApp(user)).get('/api/tours/my');

    expect(mockGetMyTours).toHaveBeenCalledOnce();
    const calledWith = mockGetMyTours.mock.calls[0]![0] as AuthenticatedUser;
    expect(calledWith.id).toBe(USER_ID);
    expect(calledWith.permissions).toContain('assets:read');
  });

  it('200 — returns empty array when user has no applicable tours', async () => {
    mockGetMyTours.mockResolvedValue([]);

    const res = await request(buildApp(makeUser())).get('/api/tours/my');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('503 — propagates service error (unexpected throw) as 500', async () => {
    mockGetMyTours.mockRejectedValue(new Error('DB down'));

    const res = await request(buildApp(makeUser())).get('/api/tours/my');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tours  (admin list)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/tours', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('403 — user without tours:manage is rejected', async () => {
    const user = makeUser({ permissions: ['assets:read'] });

    const res = await request(buildApp(user)).get('/api/tours');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('200 — returns paginated tours for authorized user', async () => {
    const tours = [makeTourDto()];
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    mockListAllTours.mockResolvedValue({ dtos: tours, meta });

    const res = await request(buildApp(makeUser())).get('/api/tours');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
  });

  it('passes page and limit query params to service', async () => {
    mockListAllTours.mockResolvedValue({ dtos: [], meta: { page: 2, limit: 10, total: 0, totalPages: 0 } });

    await request(buildApp(makeUser())).get('/api/tours?page=2&limit=10');

    expect(mockListAllTours).toHaveBeenCalledOnce();
    const callArg = mockListAllTours.mock.calls[0]![0] as { page: number; limit: number };
    expect(callArg.page).toBe(2);
    expect(callArg.limit).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tours/:id  (admin detail)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/tours/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('403 — user without tours:manage is rejected', async () => {
    const user = makeUser({ permissions: [] });

    const res = await request(buildApp(user)).get(`/api/tours/${TOUR_ID}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('404 — when service throws AppError(404)', async () => {
    mockGetTourById.mockRejectedValue(new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found'));

    const res = await request(buildApp(makeUser())).get(`/api/tours/${TOUR_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOUR_NOT_FOUND');
  });

  it('200 — returns tour DTO on happy path', async () => {
    const dto = makeTourDto();
    mockGetTourById.mockResolvedValue(dto);

    const res = await request(buildApp(makeUser())).get(`/api/tours/${TOUR_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(TOUR_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tours  (create)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/tours', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const validBody = {
    roleId: ROLE_ID,
    name: 'New Tour',
    description: 'A test tour',
    isActive: true,
    steps: [makeStep(0)],
  };

  it('403 — user without tours:manage is rejected', async () => {
    const user = makeUser({ permissions: ['assets:read'] });

    const res = await request(buildApp(user)).post('/api/tours').send(validBody);

    expect(res.status).toBe(403);
  });

  it('422 — missing required field "name"', async () => {
    const body = { ...validBody, name: undefined };

    const res = await request(buildApp(makeUser())).post('/api/tours').send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('422 — non-UUID roleId', async () => {
    const body = { ...validBody, roleId: 'not-a-uuid' };

    const res = await request(buildApp(makeUser())).post('/api/tours').send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('422 — steps with non-contiguous stepIndex (gap)', async () => {
    const body = { ...validBody, steps: [makeStep(0), makeStep(2)] }; // gap: missing 1

    const res = await request(buildApp(makeUser())).post('/api/tours').send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('422 — steps with duplicate stepIndex', async () => {
    const body = { ...validBody, steps: [makeStep(0), makeStep(0)] };

    const res = await request(buildApp(makeUser())).post('/api/tours').send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('409 — service throws TOUR_ALREADY_EXISTS_FOR_ROLE', async () => {
    mockCreateTour.mockRejectedValue(
      new AppError(409, 'TOUR_ALREADY_EXISTS_FOR_ROLE', 'Tour already exists for this role'),
    );

    const res = await request(buildApp(makeUser())).post('/api/tours').send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOUR_ALREADY_EXISTS_FOR_ROLE');
  });

  it('201 — happy path: creates tour, returns 201, passes actor id', async () => {
    const dto = makeTourDto();
    mockCreateTour.mockResolvedValue(dto);

    const res = await request(buildApp(makeUser())).post('/api/tours').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(TOUR_ID);

    expect(mockCreateTour).toHaveBeenCalledOnce();
    const [parsedInput, actorId] = mockCreateTour.mock.calls[0] as [Record<string, unknown>, string];
    expect(actorId).toBe(USER_ID);
    expect(parsedInput['roleId']).toBe(ROLE_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tours/:id  (update)
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/tours/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('403 — user without tours:manage is rejected', async () => {
    const user = makeUser({ permissions: [] });

    const res = await request(buildApp(user)).put(`/api/tours/${TOUR_ID}`).send({ name: 'Updated' });

    expect(res.status).toBe(403);
  });

  it('422 — steps with duplicate stepIndex', async () => {
    const body = { steps: [makeStep(0), makeStep(0)] };

    const res = await request(buildApp(makeUser())).put(`/api/tours/${TOUR_ID}`).send(body);

    expect(res.status).toBe(422);
  });

  it('422 — invalid position enum value in steps', async () => {
    const step = { ...makeStep(0), position: 'diagonal' }; // invalid enum
    const body = { steps: [step] };

    const res = await request(buildApp(makeUser())).put(`/api/tours/${TOUR_ID}`).send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 — service throws TOUR_NOT_FOUND', async () => {
    mockUpdateTour.mockRejectedValue(new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found'));

    const res = await request(buildApp(makeUser())).put(`/api/tours/${TOUR_ID}`).send({ name: 'X' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOUR_NOT_FOUND');
  });

  it('200 — happy path: returns updated tour, passes actor id', async () => {
    const dto = makeTourDto({ name: 'Updated Tour' });
    mockUpdateTour.mockResolvedValue(dto);

    const res = await request(buildApp(makeUser())).put(`/api/tours/${TOUR_ID}`).send({ name: 'Updated Tour' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Tour');

    const [id, , actorId] = mockUpdateTour.mock.calls[0] as [string, unknown, string];
    expect(id).toBe(TOUR_ID);
    expect(actorId).toBe(USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tours/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/tours/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('403 — user without tours:manage is rejected', async () => {
    const user = makeUser({ permissions: ['assets:read'] });

    const res = await request(buildApp(user)).delete(`/api/tours/${TOUR_ID}`);

    expect(res.status).toBe(403);
  });

  it('404 — service throws TOUR_NOT_FOUND', async () => {
    mockDeleteTour.mockRejectedValue(new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found'));

    const res = await request(buildApp(makeUser())).delete(`/api/tours/${TOUR_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOUR_NOT_FOUND');
  });

  it('200 — happy path: returns deleted: true, calls service with id and actor', async () => {
    mockDeleteTour.mockResolvedValue(undefined);

    const res = await request(buildApp(makeUser())).delete(`/api/tours/${TOUR_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const [id, actorId] = mockDeleteTour.mock.calls[0] as [string, string];
    expect(id).toBe(TOUR_ID);
    expect(actorId).toBe(USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tours/:id/progress
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/tours/:id/progress', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('422 — invalid action value', async () => {
    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 0, action: 'badword' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('422 — negative stepIndex', async () => {
    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: -1, action: 'next' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('422 — missing action field', async () => {
    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 0 });

    expect(res.status).toBe(422);
  });

  it('404 — service throws TOUR_NOT_FOUND (role mismatch)', async () => {
    mockUpdateProgress.mockRejectedValue(new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found'));

    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 0, action: 'next' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOUR_NOT_FOUND');
  });

  it('200 — action=next returns progress DTO', async () => {
    const progress = { ...makeProgressDto(), completedSteps: [0], lastStepIndex: 0 };
    mockUpdateProgress.mockResolvedValue(progress);

    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 0, action: 'next' });

    expect(res.status).toBe(200);
    expect(res.body.data.completedSteps).toContain(0);
  });

  it('200 — action=prev returns progress DTO', async () => {
    mockUpdateProgress.mockResolvedValue(makeProgressDto());

    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 1, action: 'prev' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('200 — action=skip returns isSkipped:true', async () => {
    const progress = { ...makeProgressDto(), isSkipped: true };
    mockUpdateProgress.mockResolvedValue(progress);

    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 0, action: 'skip' });

    expect(res.status).toBe(200);
    expect(res.body.data.isSkipped).toBe(true);
  });

  it('200 — action=complete returns isCompleted:true', async () => {
    const progress = { ...makeProgressDto(), isCompleted: true, completedSteps: [0] };
    mockUpdateProgress.mockResolvedValue(progress);

    const res = await request(buildApp(makeUser()))
      .put(`/api/tours/${TOUR_ID}/progress`)
      .send({ stepIndex: 0, action: 'complete' });

    expect(res.status).toBe(200);
    expect(res.body.data.isCompleted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tours/:id/restart
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/tours/:id/restart', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('404 — service throws TOUR_NOT_FOUND', async () => {
    mockRestartTour.mockRejectedValue(new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found'));

    const res = await request(buildApp(makeUser())).put(`/api/tours/${TOUR_ID}/restart`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOUR_NOT_FOUND');
  });

  it('200 — happy path: returns reset progress', async () => {
    const progress = makeProgressDto();
    mockRestartTour.mockResolvedValue(progress);

    const res = await request(buildApp(makeUser())).put(`/api/tours/${TOUR_ID}/restart`);

    expect(res.status).toBe(200);
    expect(res.body.data.completedSteps).toEqual([]);
    expect(res.body.data.isCompleted).toBe(false);
    expect(res.body.data.isSkipped).toBe(false);

    const [calledUser, calledTourId] = mockRestartTour.mock.calls[0] as [AuthenticatedUser, string];
    expect(calledUser.id).toBe(USER_ID);
    expect(calledTourId).toBe(TOUR_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tours/:id/sync  (admin)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/tours/:id/sync', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('403 — user without tours:manage is rejected', async () => {
    const user = makeUser({ permissions: ['assets:read'] });

    const res = await request(buildApp(user)).post(`/api/tours/${TOUR_ID}/sync`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('404 — service throws TOUR_NOT_FOUND', async () => {
    mockTriggerSync.mockRejectedValue(new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found'));

    const res = await request(buildApp(makeUser())).post(`/api/tours/${TOUR_ID}/sync`);

    expect(res.status).toBe(404);
  });

  it('200 — happy path: returns queued:true, calls triggerSync with tourId and actor', async () => {
    mockTriggerSync.mockResolvedValue(undefined);

    const res = await request(buildApp(makeUser())).post(`/api/tours/${TOUR_ID}/sync`);

    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(true);

    expect(mockTriggerSync).toHaveBeenCalledOnce();
    const [calledTourId, calledActorId] = mockTriggerSync.mock.calls[0] as [string, string];
    expect(calledTourId).toBe(TOUR_ID);
    expect(calledActorId).toBe(USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge case: no req.user (authorize middleware behaviour)
// ─────────────────────────────────────────────────────────────────────────────

describe('authorize() with no req.user', () => {
  it('401 on admin-only route when req.user is undefined', async () => {
    const res = await request(buildUnauthApp()).get('/api/tours');

    // authorize() throws AppError(401, 'NOT_AUTHENTICATED') when user is absent
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NOT_AUTHENTICATED');
  });
});
