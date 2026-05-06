import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// ── Prevent real Redis / BullMQ Worker from starting ─────────────────────
vi.mock('../lib/redis.js', () => ({
  redis: { on: vi.fn(), quit: vi.fn() },
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

// ── Mock Prisma ───────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => {
  const onboardingTourUpdate = vi.fn();
  const auditLogCreate = vi.fn();

  return {
    prisma: {
      onboardingTour: {
        findFirst: vi.fn(),
        update: onboardingTourUpdate,
      },
      rolePermission: {
        findMany: vi.fn(),
      },
      auditLog: {
        create: auditLogCreate,
      },
      role: {
        findUnique: vi.fn(),
      },
      // $transaction runs each item in the array as a resolved call.
      // We store a reference so tests can inspect what was passed.
      $transaction: vi.fn(async (ops: unknown[]) => {
        // Execute them if they are promises/thenable, else just resolve.
        return Promise.all(
          (ops as Array<Promise<unknown>>).map((op) => Promise.resolve(op)),
        );
      }),
    },
  };
});

// ── Mock notifyRole ───────────────────────────────────────────────────────
vi.mock('../modules/notifications/index.js', () => ({
  notify: vi.fn(),
  notifyRole: vi.fn().mockResolvedValue({ count: 0 }),
}));

import { prisma } from '../lib/prisma.js';
import { notifyRole } from '../modules/notifications/index.js';
import { processTourSync } from './tour-sync.job.js';

// ── Typed mock helpers ────────────────────────────────────────────────────
const mockFindFirst = prisma.onboardingTour.findFirst as ReturnType<typeof vi.fn>;
const mockRolePermFindMany = prisma.rolePermission.findMany as ReturnType<typeof vi.fn>;
const mockRoleFindUnique = prisma.role.findUnique as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockNotifyRole = notifyRole as ReturnType<typeof vi.fn>;

// ── Fake job builder ──────────────────────────────────────────────────────
function makeJob(roleId: string): Job<{ roleId: string }> {
  return { data: { roleId } } as unknown as Job<{ roleId: string }>;
}

// ── Shared tour fixtures ──────────────────────────────────────────────────
const TOUR_ID = 'tour-abc';
const ROLE_ID = 'role-xyz';

function makeStep(
  step_index: number,
  required_permission: { resource: string; action: string } | null,
  is_active = true,
) {
  return {
    step_index,
    title: `Step ${step_index} title`,
    description: `Step ${step_index} desc`,
    target_element: `[data-tour="step-${step_index}"]`,
    position: 'bottom',
    required_permission,
    route: '/assets',
    is_active,
  };
}

// ─────────────────────────────────────────────────────────────────────────
describe('processTourSync()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default $transaction behaviour after clearAllMocks resets the impl
    mockTransaction.mockImplementation(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops.map((op) => Promise.resolve(op))),
    );
    mockNotifyRole.mockResolvedValue({ count: 0 });
  });

  // ── Tour not found ────────────────────────────────────────────────────

  it('returns { skipped: true } and makes no DB writes when no tour exists for the role', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await processTourSync(makeJob(ROLE_ID));

    expect(result).toEqual({ skipped: true });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockNotifyRole).not.toHaveBeenCalled();
  });

  it('does not call rolePermission.findMany when tour is not found', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await processTourSync(makeJob(ROLE_ID));
    expect(mockRolePermFindMany).not.toHaveBeenCalled();
  });

  // ── Steps with null required_permission stay active ───────────────────

  it('keeps steps with required_permission: null as is_active: true after sync', async () => {
    const steps = [makeStep(1, null), makeStep(2, null)];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]); // no permissions granted
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'MANAGER' });

    await processTourSync(makeJob(ROLE_ID));

    expect(mockTransaction).toHaveBeenCalledOnce();

    // Inspect what was written by checking the audit log data argument
    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    expect(auditLogData).toBeDefined();

    const newValues = auditLogData?.newValues as Array<{ is_active: boolean }>;
    expect(newValues).toBeDefined();
    for (const step of newValues) {
      expect(step.is_active).toBe(true);
    }
  });

  // ── Granted permissions → is_active: true ────────────────────────────

  it('marks steps is_active: true when their required_permission is in the granted set', async () => {
    const steps = [
      makeStep(1, { resource: 'assets', action: 'delete' }),
      makeStep(2, { resource: 'reports', action: 'generate' }),
    ];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([
      { permission: { resource: 'assets', action: 'delete' } },
      { permission: { resource: 'reports', action: 'generate' } },
    ]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'ADMIN' });

    await processTourSync(makeJob(ROLE_ID));

    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    const newValues = auditLogData?.newValues as Array<{ is_active: boolean }>;
    for (const step of newValues) {
      expect(step.is_active).toBe(true);
    }
  });

  // ── Revoked permissions → is_active: false ────────────────────────────

  it('sets is_active: false on steps whose required_permission is NOT in the granted set', async () => {
    const steps = [
      makeStep(1, { resource: 'assets', action: 'delete' }),
      makeStep(2, { resource: 'reports', action: 'generate' }),
    ];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    // Neither permission is granted
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'STAFF' });

    await processTourSync(makeJob(ROLE_ID));

    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    const newValues = auditLogData?.newValues as Array<{ is_active: boolean }>;
    for (const step of newValues) {
      expect(step.is_active).toBe(false);
    }
  });

  it('does NOT delete steps with revoked permissions — only sets is_active: false', async () => {
    const steps = [makeStep(1, { resource: 'assets', action: 'delete' })];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'STAFF' });

    await processTourSync(makeJob(ROLE_ID));

    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    const newValues = auditLogData?.newValues as Array<unknown>;
    // Step is still present in the array, not deleted
    expect(newValues).toHaveLength(1);
    expect((newValues[0] as { is_active: boolean }).is_active).toBe(false);
  });

  // ── Mixed granted + revoked ───────────────────────────────────────────

  it('correctly handles a mix: null perm stays active, granted perm stays active, revoked goes inactive', async () => {
    const steps = [
      makeStep(0, null),                                          // always active
      makeStep(1, { resource: 'assets', action: 'delete' }),    // granted
      makeStep(2, { resource: 'roles', action: 'manage' }),     // revoked
    ];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([
      { permission: { resource: 'assets', action: 'delete' } },
    ]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'MANAGER' });

    await processTourSync(makeJob(ROLE_ID));

    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    const newValues = auditLogData?.newValues as Array<{ step_index: number; is_active: boolean }>;

    const byIndex = Object.fromEntries(newValues.map((s) => [s.step_index, s.is_active]));
    expect(byIndex[0]).toBe(true);  // null permission
    expect(byIndex[1]).toBe(true);  // granted
    expect(byIndex[2]).toBe(false); // revoked
  });

  // ── Duplicate step_index deduplication ───────────────────────────────

  it('deduplicates steps with the same step_index, keeping the last occurrence', async () => {
    const firstOccurrence = makeStep(1, null);
    const lastOccurrence = {
      ...makeStep(1, { resource: 'assets', action: 'delete' }),
      title: 'Last Occurrence',
    };
    mockFindFirst.mockResolvedValueOnce({
      id: TOUR_ID,
      roleId: ROLE_ID,
      steps: [firstOccurrence, lastOccurrence],
    });
    // assets:delete IS granted
    mockRolePermFindMany.mockResolvedValueOnce([
      { permission: { resource: 'assets', action: 'delete' } },
    ]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'ADMIN' });

    await processTourSync(makeJob(ROLE_ID));

    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    const newValues = auditLogData?.newValues as Array<{ step_index: number; title: string; is_active: boolean }>;

    // After dedup, only ONE step with step_index 1
    const stepOnes = newValues.filter((s) => s.step_index === 1);
    expect(stepOnes).toHaveLength(1);
    // Kept last occurrence
    expect(stepOnes[0]!.title).toBe('Last Occurrence');
    // is_active determined by last occurrence's required_permission (granted)
    expect(stepOnes[0]!.is_active).toBe(true);
  });

  // ── Successful sync calls $transaction ────────────────────────────────

  it('calls prisma.$transaction with onboardingTour.update and auditLog.create', async () => {
    const steps = [makeStep(1, null)];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'VIEWER' });

    await processTourSync(makeJob(ROLE_ID));

    expect(mockTransaction).toHaveBeenCalledOnce();

    // Verify onboardingTour.update was called with the tour id
    const updateMock = prisma.onboardingTour.update as ReturnType<typeof vi.fn>;
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock.mock.calls[0]![0].where).toEqual({ id: TOUR_ID });

    // Verify auditLog.create was called
    const createMock = prisma.auditLog.create as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledOnce();
  });

  // ── Audit log payload ─────────────────────────────────────────────────

  it('audit log contains oldValues (raw steps) and newValues (updated steps)', async () => {
    const steps = [makeStep(1, { resource: 'assets', action: 'delete' })];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]); // revoked
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'STAFF' });

    await processTourSync(makeJob(ROLE_ID));

    const auditLogData = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;

    // oldValues should be the raw steps as provided
    expect(auditLogData.oldValues).toEqual(steps);

    // newValues should have is_active: false for the revoked step
    const newValues = auditLogData.newValues as Array<{ is_active: boolean }>;
    expect(newValues[0]?.is_active).toBe(false);

    // resourceType and action are correct
    expect(auditLogData.resourceType).toBe('OnboardingTour');
    expect(auditLogData.action).toBe('UPDATE');
    expect(auditLogData.resourceId).toBe(TOUR_ID);
  });

  // ── Notification after transaction ───────────────────────────────────

  it('calls notifyRole with TOUR_UPDATED type after the transaction succeeds', async () => {
    const steps = [makeStep(1, null)];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'MANAGER' });

    await processTourSync(makeJob(ROLE_ID));

    expect(mockNotifyRole).toHaveBeenCalledOnce();
    const [roleName, notifyInput] = mockNotifyRole.mock.calls[0]!;
    expect(roleName).toBe('ADMIN');
    expect(notifyInput.type).toBe('TOUR_UPDATED');
    expect(notifyInput.vars?.roleName).toBe('MANAGER');
  });

  it('does NOT call notifyRole when role.findUnique returns null', async () => {
    const steps = [makeStep(1, null)];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce(null); // role not found

    await processTourSync(makeJob(ROLE_ID));

    expect(mockNotifyRole).not.toHaveBeenCalled();
  });

  // ── Notification failure does NOT roll back tour update ───────────────

  it('does not throw when notifyRole throws — notification failure is non-fatal', async () => {
    const steps = [makeStep(1, null)];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'MANAGER' });
    mockNotifyRole.mockRejectedValueOnce(new Error('Notification service down'));

    // Should NOT throw even though notifyRole threw
    await expect(processTourSync(makeJob(ROLE_ID))).resolves.not.toThrow();

    // The transaction still happened — tour was updated
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('returns the expected result shape when sync succeeds', async () => {
    const steps = [makeStep(1, null), makeStep(2, null)];
    mockFindFirst.mockResolvedValueOnce({ id: TOUR_ID, roleId: ROLE_ID, steps });
    mockRolePermFindMany.mockResolvedValueOnce([]);
    mockRoleFindUnique.mockResolvedValueOnce({ id: ROLE_ID, name: 'MANAGER' });

    const result = await processTourSync(makeJob(ROLE_ID));

    expect(result).toEqual({
      tourId: TOUR_ID,
      roleId: ROLE_ID,
      stepsCount: 2,
    });
  });
});
