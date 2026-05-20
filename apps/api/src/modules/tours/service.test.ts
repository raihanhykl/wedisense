import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted by Vitest) ────────────────────────────────────────

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    role: {
      findUnique: vi.fn(),
    },
    onboardingTour: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userTourProgress: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/queue.js', () => ({
  tourSyncQueue: {
    add: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('./repository.js', () => ({
  findToursForUser: vi.fn(),
  findProgressForUser: vi.fn(),
  findTourById: vi.fn(),
  listAllTours: vi.fn(),
  createTour: vi.fn(),
  updateTour: vi.fn(),
  deleteTour: vi.fn(),
  upsertProgress: vi.fn(),
  getRoleNameMap: vi.fn(),
  countToursForRole: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import * as repo from './repository.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  getMyTours,
  createTour,
  updateProgress,
  restartTour,
  hasIncompleteTourForUser,
} from './service.js';
import type { CreateTourInput } from './schema.js';

// ── Typed mock helpers ───────────────────────────────────────────────────────

const mockFindToursForUser = repo.findToursForUser as ReturnType<typeof vi.fn>;
const mockFindProgressForUser = repo.findProgressForUser as ReturnType<typeof vi.fn>;
const mockFindTourById = repo.findTourById as ReturnType<typeof vi.fn>;
const mockCountToursForRole = repo.countToursForRole as ReturnType<typeof vi.fn>;
const mockUpsertProgress = repo.upsertProgress as ReturnType<typeof vi.fn>;
const mockGetRoleNameMap = repo.getRoleNameMap as ReturnType<typeof vi.fn>;
const mockRoleFindUnique = prisma.role.findUnique as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockUserTourProgressFindUnique = prisma.userTourProgress.findUnique as ReturnType<typeof vi.fn>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ROLE_ID = 'role-admin-1';
const TOUR_ID = 'tour-1';
const USER_ID = 'user-1';

/** Minimal AuthenticatedUser for tests — no permissions required for most cases. */
function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    employeeId: 'EMP-001',
    preferredLanguage: 'en',
    status: 'ACTIVE',
    roles: [{ id: ROLE_ID, name: 'ADMIN', locationId: null }],
    permissions: ['assets:read', 'assets:create', 'reports:view'],
    accessibleLocationIds: [],
    hasIncompleteTour: false,
    ...overrides,
  };
}

/** A raw DB tour row returned by repo.findToursForUser / findTourById. */
function makeDbTour(overrides: Partial<{
  id: string;
  roleId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  steps: unknown[];
}> = {}) {
  return {
    id: TOUR_ID,
    roleId: ROLE_ID,
    name: 'Admin Onboarding',
    description: 'Admin tour',
    isActive: true,
    steps: [
      { step_index: 0, title: 'tours.admin.dashboard.title', description: 'tours.admin.dashboard.description', target_element: "[data-tour='dashboard-summary']", position: 'bottom', required_permission: null, route: '/dashboard', is_active: true },
      { step_index: 1, title: 'tours.admin.assets.title', description: 'tours.admin.assets.description', target_element: "[data-tour='asset-list']", position: 'bottom', required_permission: { resource: 'assets', action: 'read' }, route: '/admin/assets', is_active: true },
      { step_index: 2, title: 'tours.admin.roles.title', description: 'tours.admin.roles.description', target_element: "[data-tour='role-management']", position: 'right', required_permission: { resource: 'roles', action: 'manage' }, route: '/admin/roles', is_active: true },
      { step_index: 3, title: 'tours.admin.inactive.title', description: 'tours.admin.inactive.description', target_element: "[data-tour='inactive']", position: 'right', required_permission: null, route: '/admin/inactive', is_active: false },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDbProgress(overrides: Partial<{
  completedSteps: number[];
  isCompleted: boolean;
  isSkipped: boolean;
  lastSeenAt: Date | null;
}> = {}) {
  return {
    id: 'progress-1',
    userId: USER_ID,
    tourId: TOUR_ID,
    completedSteps: [] as number[],
    isCompleted: false,
    isSkipped: false,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Wire $transaction to run the callback ────────────────────────────────────

function mockTxThatRuns(txOverrides: Record<string, unknown> = {}) {
  const tx = {
    onboardingTour: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    ...txOverrides,
  };
  mockTransaction.mockImplementation(
    (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  );
  return tx;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyTours()', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('filters out steps where is_active=false', async () => {
    const user = makeUser();
    mockFindToursForUser.mockResolvedValue([makeDbTour()]);
    mockFindProgressForUser.mockResolvedValue(new Map());
    mockGetRoleNameMap.mockResolvedValue(new Map([[ROLE_ID, 'ADMIN']]));

    const [tour] = await getMyTours(user);

    expect(tour).toBeDefined();
    // step_index=3 has is_active=false → should be excluded
    expect(tour!.steps.every((s) => s.isActive)).toBe(true);
    expect(tour!.steps.find((s) => s.targetElement === "[data-tour='inactive']")).toBeUndefined();
  });

  it('filters out steps where requiredPermission is not in user.permissions', async () => {
    // User has assets:read but NOT roles:manage
    const user = makeUser({ permissions: ['assets:read'] });
    mockFindToursForUser.mockResolvedValue([makeDbTour()]);
    mockFindProgressForUser.mockResolvedValue(new Map());
    mockGetRoleNameMap.mockResolvedValue(new Map([[ROLE_ID, 'ADMIN']]));

    const [tour] = await getMyTours(user);
    expect(tour).toBeDefined();

    // roles:manage step should be removed
    const hasRolesStep = tour!.steps.some(
      (s) => s.requiredPermission?.resource === 'roles' && s.requiredPermission?.action === 'manage',
    );
    expect(hasRolesStep).toBe(false);

    // assets:read step should survive
    const hasAssetsStep = tour!.steps.some(
      (s) => s.requiredPermission?.resource === 'assets',
    );
    expect(hasAssetsStep).toBe(true);
  });

  it('returns empty array when user has no role with active tour', async () => {
    mockFindToursForUser.mockResolvedValue([]);
    const result = await getMyTours(makeUser());
    expect(result).toEqual([]);
    expect(mockFindProgressForUser).not.toHaveBeenCalled();
  });

  it('enriches tour with progress correctly when a progress row exists', async () => {
    const user = makeUser();
    mockFindToursForUser.mockResolvedValue([makeDbTour()]);
    const progressMap = new Map([[TOUR_ID, makeDbProgress({
      completedSteps: [0, 1],
      isCompleted: false,
      isSkipped: false,
      lastSeenAt: new Date('2026-01-15T10:00:00Z'),
    })]]);
    mockFindProgressForUser.mockResolvedValue(progressMap);
    mockGetRoleNameMap.mockResolvedValue(new Map([[ROLE_ID, 'ADMIN']]));

    const [tour] = await getMyTours(user);
    expect(tour!.progress).not.toBeNull();
    expect(tour!.progress!.completedSteps).toEqual([0, 1]);
    expect(tour!.progress!.lastStepIndex).toBe(1);
    expect(tour!.progress!.isCompleted).toBe(false);
    expect(tour!.progress!.lastSeenAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('returns null progress when no progress row exists for the tour', async () => {
    const user = makeUser();
    mockFindToursForUser.mockResolvedValue([makeDbTour()]);
    mockFindProgressForUser.mockResolvedValue(new Map()); // empty — no row
    mockGetRoleNameMap.mockResolvedValue(new Map([[ROLE_ID, 'ADMIN']]));

    const [tour] = await getMyTours(user);
    expect(tour!.progress).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('hasIncompleteTourForUser()', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns true when no progress row exists for an applicable tour', async () => {
    mockFindToursForUser.mockResolvedValue([makeDbTour()]);
    mockFindProgressForUser.mockResolvedValue(new Map());
    const result = await hasIncompleteTourForUser(makeUser());
    expect(result).toBe(true);
  });

  it('returns false when tour is completed', async () => {
    mockFindToursForUser.mockResolvedValue([makeDbTour()]);
    const progressMap = new Map([[TOUR_ID, makeDbProgress({ isCompleted: true })]]);
    mockFindProgressForUser.mockResolvedValue(progressMap);
    const result = await hasIncompleteTourForUser(makeUser());
    expect(result).toBe(false);
  });

  it('returns false when user has no roles with active tours', async () => {
    mockFindToursForUser.mockResolvedValue([]);
    const result = await hasIncompleteTourForUser(makeUser());
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateProgress()', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function setupFoundTour() {
    mockFindTourById.mockResolvedValue(makeDbTour());
    mockUserTourProgressFindUnique.mockResolvedValue(null); // no existing progress
  }

  it("action='next' adds stepIndex to completedSteps without duplication", async () => {
    setupFoundTour();
    // Existing progress already has step 0 completed
    mockUserTourProgressFindUnique.mockResolvedValue(
      makeDbProgress({ completedSteps: [0] }),
    );
    const savedProgress = makeDbProgress({ completedSteps: [0, 1], isCompleted: false });
    mockUpsertProgress.mockResolvedValue(savedProgress);

    const result = await updateProgress(makeUser(), TOUR_ID, { stepIndex: 1, action: 'next' });

    expect(mockUpsertProgress).toHaveBeenCalledOnce();
    const call = mockUpsertProgress.mock.calls[0] as [string, string, { completedSteps: number[]; isCompleted: boolean; isSkipped: boolean; lastSeenAt: Date }];
    const savedCompleted = call[2].completedSteps;
    // Should include both 0 and 1 with no duplicates
    expect(savedCompleted).toContain(0);
    expect(savedCompleted).toContain(1);
    expect(result.completedSteps).toEqual([0, 1]);
  });

  it("action='next' does not duplicate stepIndex already in completedSteps", async () => {
    setupFoundTour();
    mockUserTourProgressFindUnique.mockResolvedValue(
      makeDbProgress({ completedSteps: [0, 1] }),
    );
    mockUpsertProgress.mockResolvedValue(makeDbProgress({ completedSteps: [0, 1] }));

    await updateProgress(makeUser(), TOUR_ID, { stepIndex: 1, action: 'next' });

    const call = mockUpsertProgress.mock.calls[0] as [string, string, { completedSteps: number[] }];
    const completed = call[2].completedSteps;
    const count = completed.filter((s: number) => s === 1).length;
    expect(count).toBe(1);
  });

  it("action='skip' sets isSkipped=true", async () => {
    setupFoundTour();
    mockUpsertProgress.mockResolvedValue(makeDbProgress({ isSkipped: true }));

    const result = await updateProgress(makeUser(), TOUR_ID, { stepIndex: 0, action: 'skip' });

    const call = mockUpsertProgress.mock.calls[0] as [string, string, { isSkipped: boolean }];
    expect(call[2].isSkipped).toBe(true);
    expect(result.isSkipped).toBe(true);
  });

  it("action='complete' sets isCompleted=true", async () => {
    setupFoundTour();
    mockUpsertProgress.mockResolvedValue(makeDbProgress({ isCompleted: true, completedSteps: [0] }));

    const result = await updateProgress(makeUser(), TOUR_ID, { stepIndex: 0, action: 'complete' });

    const call = mockUpsertProgress.mock.calls[0] as [string, string, { isCompleted: boolean }];
    expect(call[2].isCompleted).toBe(true);
    expect(result.isCompleted).toBe(true);
  });

  it('throws 404 when the tour does not belong to any of the user roles', async () => {
    // Tour belongs to a different role than the user has
    mockFindTourById.mockResolvedValue(makeDbTour({ roleId: 'other-role-id' }));

    const user = makeUser({ roles: [{ id: ROLE_ID, name: 'ADMIN', locationId: null }] });
    await expect(
      updateProgress(user, TOUR_ID, { stepIndex: 0, action: 'next' }),
    ).rejects.toMatchObject({ code: 'TOUR_NOT_FOUND', statusCode: 404 });
  });

  it('throws 404 when the tour does not exist', async () => {
    mockFindTourById.mockResolvedValue(null);
    await expect(
      updateProgress(makeUser(), TOUR_ID, { stepIndex: 0, action: 'next' }),
    ).rejects.toMatchObject({ code: 'TOUR_NOT_FOUND', statusCode: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('restartTour()', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resets completedSteps, isCompleted, isSkipped + writes audit log inside a transaction', async () => {
    mockFindTourById.mockResolvedValue(makeDbTour());
    const resetProgress = makeDbProgress({
      completedSteps: [],
      isCompleted: false,
      isSkipped: false,
    });
    mockUpsertProgress.mockResolvedValue(resetProgress);
    const tx = mockTxThatRuns();

    const result = await restartTour(makeUser(), TOUR_ID);

    const call = mockUpsertProgress.mock.calls[0] as [string, string, {
      completedSteps: number[];
      isCompleted: boolean;
      isSkipped: boolean;
    }];
    expect(call[2].completedSteps).toEqual([]);
    expect(call[2].isCompleted).toBe(false);
    expect(call[2].isSkipped).toBe(false);
    expect(result.completedSteps).toEqual([]);
    expect(result.isCompleted).toBe(false);

    // Audit log is written inside the same transaction so a partial failure
    // can't leave a reset tour with no audit trail.
    expect(mockTransaction).toHaveBeenCalledOnce();
    const auditCreate = tx.auditLog.create as ReturnType<typeof vi.fn>;
    expect(auditCreate).toHaveBeenCalledOnce();
    const auditCall = auditCreate.mock.calls[0]?.[0] as { data: { resourceType: string; action: string } };
    expect(auditCall.data.resourceType).toBe('UserTourProgress');
    expect(auditCall.data.action).toBe('UPDATE');
  });

  it('throws 404 when tour does not belong to user role', async () => {
    mockFindTourById.mockResolvedValue(makeDbTour({ roleId: 'other-role' }));
    await expect(restartTour(makeUser(), TOUR_ID)).rejects.toMatchObject({
      code: 'TOUR_NOT_FOUND',
      statusCode: 404,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createTour()', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const validInput: CreateTourInput = {
    roleId: ROLE_ID,
    name: 'New Tour',
    description: 'A tour',
    isActive: true,
    steps: [
      {
        stepIndex: 0,
        title: 'tours.test.step0.title',
        description: 'tours.test.step0.description',
        targetElement: "[data-tour='dashboard-summary']",
        position: 'bottom',
        requiredPermission: null,
        route: '/dashboard',
        isActive: true,
      },
    ],
  };

  it('throws 409 when a tour already exists for the role', async () => {
    mockRoleFindUnique.mockResolvedValue({ id: ROLE_ID, name: 'ADMIN' });
    mockCountToursForRole.mockResolvedValue(1);

    await expect(createTour(validInput, USER_ID)).rejects.toMatchObject({
      code: 'TOUR_ALREADY_EXISTS_FOR_ROLE',
      statusCode: 409,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('creates the tour and writes audit log inside a transaction', async () => {
    mockRoleFindUnique.mockResolvedValue({ id: ROLE_ID, name: 'ADMIN' });
    mockCountToursForRole.mockResolvedValue(0);

    const createdTour = {
      id: TOUR_ID,
      roleId: ROLE_ID,
      name: 'New Tour',
      description: 'A tour',
      isActive: true,
      steps: validInput.steps.map((s) => ({
        step_index: s.stepIndex,
        title: s.title,
        description: s.description,
        target_element: s.targetElement,
        position: s.position,
        required_permission: s.requiredPermission,
        route: s.route,
        is_active: s.isActive,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const tx = mockTxThatRuns();
    tx.onboardingTour.create.mockResolvedValue(createdTour);

    // getTourById is called after create to build the DTO
    mockFindTourById.mockResolvedValue(createdTour);
    mockGetRoleNameMap.mockResolvedValue(new Map([[ROLE_ID, 'ADMIN']]));

    const result = await createTour(validInput, USER_ID);

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    const auditCall = tx.auditLog.create.mock.calls[0] as [{ data: { action: string; resourceType: string; userId: string } }];
    expect(auditCall[0].data.action).toBe('CREATE');
    expect(auditCall[0].data.resourceType).toBe('OnboardingTour');
    expect(auditCall[0].data.userId).toBe(USER_ID);
    expect(result.id).toBe(TOUR_ID);
  });

  it('throws 404 when the roleId does not exist', async () => {
    mockRoleFindUnique.mockResolvedValue(null);
    await expect(createTour(validInput, USER_ID)).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND',
      statusCode: 404,
    });
  });
});
