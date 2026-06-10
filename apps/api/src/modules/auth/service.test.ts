/**
 * Auth service tests — focus on the audit-logging behaviour introduced in
 * Phase 16 Tier 1 plus the existing happy/sad paths that previously had
 * zero coverage. The audit assertions are the main reason this file
 * exists; the credential checks come along for free since they sit on the
 * same code paths.
 *
 * What we DON'T cover here:
 *  - resolveAuthenticatedUser / accessible-location-IDs CTE plumbing.
 *    Those branch heavily and deserve their own focused test if we ever
 *    catch a regression. For now they're exercised by router-level
 *    integration tests in other modules (assets/router.test.ts etc.).
 *  - JWT signing — that's a thin wrapper around jsonwebtoken which we
 *    mock here; no value testing our delegation to it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted before any import that uses them) ───────────────

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    location: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('bcrypt', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'mocked-token'), verify: vi.fn() },
}));

vi.mock('../tours/service.js', () => ({
  hasIncompleteTourForUser: vi.fn(),
}));

import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma.js';
import { hasIncompleteTourForUser } from '../tours/service.js';
import { login, recordLogout, changePassword } from './service.js';

type MockFn = ReturnType<typeof vi.fn>;

const mockUserFind = prisma.user.findUnique as MockFn;
const mockAuditCreate = prisma.auditLog.create as MockFn;
const mockLocationFind = prisma.location.findMany as MockFn;
const mockTransaction = prisma.$transaction as MockFn;
const mockBcryptCompare = bcrypt.compare as unknown as MockFn;
const mockBcryptHash = bcrypt.hash as unknown as MockFn;
const mockHasIncompleteTour = hasIncompleteTourForUser as MockFn;

// ── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PASSWORD_HASH = '$2b$12$mockedhashvalue';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    name: 'Alice',
    email: 'alice@example.com',
    employeeId: 'EMP-1',
    passwordHash: PASSWORD_HASH,
    preferredLanguage: 'en',
    status: 'ACTIVE',
    userRoles: [],
    ...overrides,
  };
}

const AUDIT_CTX = { ipAddress: '203.0.113.7', userAgent: 'vitest/1.0' };

beforeEach(() => {
  vi.resetAllMocks();
  // Sane defaults: resolveAuthenticatedUser pipeline returns no tour flag
  // and the user has no location-scoped roles so the CTE branch isn't hit.
  mockHasIncompleteTour.mockResolvedValue(false);
  mockLocationFind.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────
// login()
// ─────────────────────────────────────────────────────────────────────────

describe('login()', () => {
  it('happy path returns tokens + user and writes a LOGIN audit row with IP + UA', async () => {
    // findUnique is called twice: once at the start of login(), then again
    // inside resolveAuthenticatedUser to build the full DTO. Same row both
    // times; return it twice.
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(true);
    mockAuditCreate.mockResolvedValue({});

    const result = await login({ email: 'alice@example.com', password: 'pw' }, AUDIT_CTX);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe('alice@example.com');

    expect(mockAuditCreate).toHaveBeenCalledOnce();
    const auditPayload = mockAuditCreate.mock.calls[0]?.[0] as {
      data: { userId: string; action: string; resourceType: string; resourceId: string; ipAddress?: string; userAgent?: string };
    };
    expect(auditPayload.data.action).toBe('LOGIN');
    expect(auditPayload.data.resourceType).toBe('User');
    expect(auditPayload.data.resourceId).toBe(USER_ID);
    expect(auditPayload.data.userId).toBe(USER_ID);
    expect(auditPayload.data.ipAddress).toBe('203.0.113.7');
    expect(auditPayload.data.userAgent).toBe('vitest/1.0');
  });

  it('omits ipAddress / userAgent fields when ctx is empty (no nulls written)', async () => {
    // Defensive: the audit_logs columns are nullable but we want to keep
    // them tidy — the spread-guard in service.ts should drop undefined
    // entries entirely rather than write `null`.
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(true);
    mockAuditCreate.mockResolvedValue({});

    await login({ email: 'alice@example.com', password: 'pw' });

    const auditPayload = mockAuditCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(auditPayload.data).not.toHaveProperty('ipAddress');
    expect(auditPayload.data).not.toHaveProperty('userAgent');
  });

  it('audit-write failure is swallowed — login still returns success', async () => {
    // A transient DB hiccup writing the audit row must NOT 500 a login
    // that has already succeeded at the credential-check level. The
    // service.ts comment block calls this out explicitly.
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(true);
    mockAuditCreate.mockRejectedValue(new Error('DB down'));

    const result = await login({ email: 'alice@example.com', password: 'pw' }, AUDIT_CTX);

    expect(result.accessToken).toBeTruthy();
  });

  it('does NOT write an audit row when the email is unknown (401)', async () => {
    // Failed attempts on non-existent emails are auth-attempt noise; we
    // explicitly chose NOT to flood the audit_logs table with them. A
    // future intrusion-detection layer can record them in its own table.
    mockUserFind.mockResolvedValue(null);

    await expect(
      login({ email: 'ghost@example.com', password: 'pw' }, AUDIT_CTX),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('does NOT write an audit row when the password is wrong (401)', async () => {
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(false);

    await expect(
      login({ email: 'alice@example.com', password: 'wrong' }, AUDIT_CTX),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('rejects RESIGNED accounts with 403 USER_RESIGNED', async () => {
    mockUserFind.mockResolvedValue(makeUser({ status: 'RESIGNED' }));

    await expect(
      login({ email: 'alice@example.com', password: 'pw' }, AUDIT_CTX),
    ).rejects.toMatchObject({ code: 'USER_RESIGNED', statusCode: 403 });
  });

  it('rejects INACTIVE accounts with 403 USER_INACTIVE', async () => {
    mockUserFind.mockResolvedValue(makeUser({ status: 'INACTIVE' }));

    await expect(
      login({ email: 'alice@example.com', password: 'pw' }, AUDIT_CTX),
    ).rejects.toMatchObject({ code: 'USER_INACTIVE', statusCode: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// recordLogout()
// ─────────────────────────────────────────────────────────────────────────

describe('recordLogout()', () => {
  it('writes a LOGOUT audit row with IP + UA', async () => {
    mockAuditCreate.mockResolvedValue({});

    await recordLogout(USER_ID, AUDIT_CTX);

    expect(mockAuditCreate).toHaveBeenCalledOnce();
    const auditPayload = mockAuditCreate.mock.calls[0]?.[0] as {
      data: { action: string; resourceType: string; resourceId: string; ipAddress?: string };
    };
    expect(auditPayload.data.action).toBe('LOGOUT');
    expect(auditPayload.data.resourceType).toBe('User');
    expect(auditPayload.data.resourceId).toBe(USER_ID);
    expect(auditPayload.data.ipAddress).toBe('203.0.113.7');
  });

  it('does not throw when the audit insert fails (cookie-clear must still proceed)', async () => {
    mockAuditCreate.mockRejectedValue(new Error('DB down'));

    await expect(recordLogout(USER_ID, AUDIT_CTX)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// changePassword()
// ─────────────────────────────────────────────────────────────────────────

describe('changePassword()', () => {
  // Wire $transaction to actually run its callback against a stub tx
  // object that has the same `user.update` + `auditLog.create` surface.
  function mockTransactionRuns(txOverrides: Record<string, unknown> = {}) {
    const tx = {
      user: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      ...txOverrides,
    };
    mockTransaction.mockImplementation(
      (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    );
    return tx;
  }

  it('hashes the new password and writes UPDATE audit inside the same transaction', async () => {
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(true); // current password OK
    mockBcryptHash.mockResolvedValue('$2b$12$newhash');
    const tx = mockTransactionRuns();

    await changePassword(
      USER_ID,
      { currentPassword: 'old', newPassword: 'new' },
      AUDIT_CTX,
    );

    // The new hash got written through the tx client, NOT the global prisma.
    expect(mockTransaction).toHaveBeenCalledOnce();
    const txUserUpdate = tx.user.update;
    expect(txUserUpdate).toHaveBeenCalledOnce();
    const updateCall = txUserUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { passwordHash: string };
    };
    expect(updateCall.where.id).toBe(USER_ID);
    expect(updateCall.data.passwordHash).toBe('$2b$12$newhash');

    // Audit row written through the SAME tx — atomicity guarantee.
    const txAuditCreate = tx.auditLog.create;
    expect(txAuditCreate).toHaveBeenCalledOnce();
    expect(mockAuditCreate).not.toHaveBeenCalled(); // not the global one
  });

  it('audit redacts the password — newValues records ONLY `passwordChanged: true`', async () => {
    // CRITICAL: logging the new hash would make audit_logs a credential-
    // leak target. The hash never leaves the user-table row.
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue('$2b$12$newhash');
    const tx = mockTransactionRuns();

    await changePassword(
      USER_ID,
      { currentPassword: 'old', newPassword: 'new' },
      AUDIT_CTX,
    );

    const txAuditCreate = tx.auditLog.create;
    const auditCall = txAuditCreate.mock.calls[0]?.[0] as {
      data: { newValues: Record<string, unknown>; action: string };
    };
    expect(auditCall.data.action).toBe('UPDATE');
    expect(auditCall.data.newValues).toEqual({ passwordChanged: true });
    // Sanity check: the new hash is not anywhere in the audit row
    const serialised = JSON.stringify(auditCall.data);
    expect(serialised).not.toContain('newhash');
    expect(serialised).not.toContain(PASSWORD_HASH);
  });

  it('throws 404 USER_NOT_FOUND when the userId does not exist', async () => {
    mockUserFind.mockResolvedValue(null);

    await expect(
      changePassword(USER_ID, { currentPassword: 'old', newPassword: 'new' }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws 400 INVALID_PASSWORD when the current password is wrong', async () => {
    mockUserFind.mockResolvedValue(makeUser());
    mockBcryptCompare.mockResolvedValue(false);

    await expect(
      changePassword(USER_ID, { currentPassword: 'wrong', newPassword: 'new' }),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD', statusCode: 400 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
