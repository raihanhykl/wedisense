import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks must be declared before importing the module under test ──
// Vitest hoists vi.mock() calls, so the factories run before module initialisation.

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../lib/mailer.js', () => ({
  // Default to resolving undefined so .catch() on the returned promise works.
  // Individual tests can override with mockResolvedValueOnce / mockRejectedValueOnce.
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));

// Repository is a thin wrapper around prisma; mock it too so service-level
// tests don't exercise DB calls indirectly through the repository.
vi.mock('./repository.js', () => ({
  findManyForUser: vi.fn(),
  unreadCountForUser: vi.fn(),
  findByIdForUser: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  createMany: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import { sendNotificationEmail } from '../../lib/mailer.js';
import * as repo from './repository.js';
import {
  notify,
  notifyRole,
  markRead,
  markAllRead,
  listForUser,
  unreadCount,
} from './service.js';

// ── Typed mock helpers ───────────────────────────────────────────────────

const mockUserFindMany = prisma.user.findMany as ReturnType<typeof vi.fn>;
const mockSendEmail = sendNotificationEmail as ReturnType<typeof vi.fn>;
const mockCreateMany = repo.createMany as ReturnType<typeof vi.fn>;
const mockFindMany = repo.findManyForUser as ReturnType<typeof vi.fn>;
const mockUnreadCount = repo.unreadCountForUser as ReturnType<typeof vi.fn>;
const mockFindByIdForUser = repo.findByIdForUser as ReturnType<typeof vi.fn>;
const mockMarkRead = repo.markRead as ReturnType<typeof vi.fn>;
const mockMarkAllRead = repo.markAllRead as ReturnType<typeof vi.fn>;

// ── Shared test data ─────────────────────────────────────────────────────

const ACTIVE_USER_EN = {
  id: 'user-1',
  preferredLanguage: 'en',
  name: 'Alice',
  email: 'alice@example.com',
  status: 'ACTIVE',
  deletedAt: null,
};

const ACTIVE_USER_ID = {
  id: 'user-2',
  preferredLanguage: 'id',
  name: 'Budi',
  email: 'budi@example.com',
  status: 'ACTIVE',
  deletedAt: null,
};

const WARRANTY_INPUT = {
  type: 'WARRANTY_EXPIRING' as const,
  titleKey: 'warranty_expiring.title',
  messageKey: 'warranty_expiring.message',
  vars: { assetName: 'Laptop', daysUntil: 5 },
};

// ─────────────────────────────────────────────────────────────────────────
describe('notify()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── No-op paths ──────────────────────────────────────────────────────

  it('returns { count: 0 } and makes no DB call when neither userId nor userIds provided', async () => {
    const result = await notify({ ...WARRANTY_INPUT });
    expect(result).toEqual({ count: 0 });
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('returns { count: 0 } and makes no DB call when userIds is an empty array', async () => {
    const result = await notify({ ...WARRANTY_INPUT, userIds: [] });
    expect(result).toEqual({ count: 0 });
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('returns { count: 0 } when all resolved ids map to no active users', async () => {
    mockUserFindMany.mockResolvedValueOnce([]);
    const result = await notify({ ...WARRANTY_INPUT, userId: 'ghost-user' });
    expect(result).toEqual({ count: 0 });
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  // ── Single userId path ────────────────────────────────────────────────

  it('fetches user and calls createMany once with one row when single userId is given', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    const result = await notify({ ...WARRANTY_INPUT, userId: 'user-1' });

    expect(result).toEqual({ count: 1 });

    // findMany called with correct WHERE
    expect(mockUserFindMany).toHaveBeenCalledOnce();
    const [findManyArgs] = mockUserFindMany.mock.calls[0]!;
    expect(findManyArgs.where).toMatchObject({
      id: { in: ['user-1'] },
      status: 'ACTIVE',
      deletedAt: null,
    });

    // createMany called once with one row
    expect(mockCreateMany).toHaveBeenCalledOnce();
    const rows = mockCreateMany.mock.calls[0]![0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'user-1',
      type: 'WARRANTY_EXPIRING',
    });
  });

  // ── Multiple userIds ──────────────────────────────────────────────────

  it('fetches all users and calls createMany once with correct row count', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN, ACTIVE_USER_ID]);
    mockCreateMany.mockResolvedValueOnce({ count: 2 });

    const result = await notify({
      ...WARRANTY_INPUT,
      userIds: ['user-1', 'user-2'],
    });

    expect(result).toEqual({ count: 2 });
    expect(mockCreateMany).toHaveBeenCalledOnce();
    const rows = mockCreateMany.mock.calls[0]![0];
    expect(rows).toHaveLength(2);
  });

  // ── Deduplication ─────────────────────────────────────────────────────

  it('deduplicates userIds via Set before calling findMany', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({
      ...WARRANTY_INPUT,
      userIds: ['user-1', 'user-1', 'user-1'],
    });

    const [findManyArgs] = mockUserFindMany.mock.calls[0]!;
    // After dedup, only one id in the `in` array
    expect(findManyArgs.where.id.in).toEqual(['user-1']);
  });

  it('deduplicates userId + userIds overlap', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({
      ...WARRANTY_INPUT,
      userId: 'user-1',
      userIds: ['user-1'],
    });

    const [findManyArgs] = mockUserFindMany.mock.calls[0]!;
    expect(findManyArgs.where.id.in).toEqual(['user-1']);
  });

  // ── DB filter for inactive / soft-deleted users ───────────────────────

  it('passes status: ACTIVE and deletedAt: null to findMany (DB-level filter)', async () => {
    mockUserFindMany.mockResolvedValueOnce([]);
    await notify({ ...WARRANTY_INPUT, userIds: ['user-1', 'user-2'] });

    const [findManyArgs] = mockUserFindMany.mock.calls[0]!;
    expect(findManyArgs.where).toMatchObject({
      status: 'ACTIVE',
      deletedAt: null,
    });
  });

  // ── Locale resolution ─────────────────────────────────────────────────

  it('resolves localized title/message using user.preferredLanguage (en)', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({
      ...WARRANTY_INPUT,
      userId: 'user-1',
    });

    const rows = mockCreateMany.mock.calls[0]![0];
    expect(rows[0].title).toBe('Warranty Expiring Soon');
    expect(rows[0].message).toBe('Asset Laptop warranty expires in 5 days');
  });

  it('resolves localized title/message using user.preferredLanguage (id)', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_ID]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({
      ...WARRANTY_INPUT,
      userId: 'user-2',
    });

    const rows = mockCreateMany.mock.calls[0]![0];
    expect(rows[0].title).toBe('Garansi Akan Berakhir');
    expect(rows[0].message).toBe('Garansi aset Laptop akan berakhir dalam 5 hari');
  });

  it('falls back to id locale when user.preferredLanguage is null', async () => {
    const userWithNullLang = { ...ACTIVE_USER_EN, preferredLanguage: null };
    mockUserFindMany.mockResolvedValueOnce([userWithNullLang]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({ ...WARRANTY_INPUT, userId: 'user-1' });

    const rows = mockCreateMany.mock.calls[0]![0];
    // null lang → fallback to 'id' in service: `const lang = user.preferredLanguage ?? 'id'`
    expect(rows[0].title).toBe('Garansi Akan Berakhir');
  });

  // ── Email sending ─────────────────────────────────────────────────────

  it('triggers sendNotificationEmail for WARRANTY_EXPIRING (has email template)', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });
    mockSendEmail.mockResolvedValueOnce(undefined);

    await notify({ ...WARRANTY_INPUT, userId: 'user-1' });

    // Give the fire-and-forget promise a tick to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const emailArgs = mockSendEmail.mock.calls[0]![0];
    expect(emailArgs.to).toBe('alice@example.com');
    expect(emailArgs.templateName).toBe('warranty-expiring');
    expect(emailArgs.lang).toBe('en');
  });

  it('does NOT call sendNotificationEmail for TOUR_UPDATED (no email template)', async () => {
    const tourInput = {
      type: 'TOUR_UPDATED' as const,
      titleKey: 'tour_updated.title',
      messageKey: 'tour_updated.message',
      vars: { roleName: 'Manager' },
      userId: 'user-1',
    };
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify(tourInput);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does NOT call sendNotificationEmail for REPORT_READY (no email template)', async () => {
    const reportInput = {
      type: 'REPORT_READY' as const,
      titleKey: 'report_ready.title',
      messageKey: 'report_ready.message',
      vars: { reportName: 'Q1' },
      userId: 'user-1',
    };
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify(reportInput);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('calls sendNotificationEmail once per user when multiple users have email templates', async () => {
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN, ACTIVE_USER_ID]);
    mockCreateMany.mockResolvedValueOnce({ count: 2 });
    mockSendEmail.mockResolvedValue(undefined);

    await notify({ ...WARRANTY_INPUT, userIds: ['user-1', 'user-2'] });
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  // ── Per-window deduplication ──────────────────────────────────────────

  it('skips users who already received a notification with the same dedupeKey today', async () => {
    const mockNotifFindMany = prisma.notification.findMany as ReturnType<typeof vi.fn>;
    // user-1 already notified, user-2 not
    mockNotifFindMany.mockResolvedValueOnce([{ userId: 'user-1' }]);
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_ID]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    const result = await notify({
      ...WARRANTY_INPUT,
      userIds: ['user-1', 'user-2'],
      dedupeKey: 'warranty:asset-1',
      dedupeWindow: 'day',
    });

    expect(result.count).toBe(1);
    // user.findMany called with only the non-deduped id
    const userQuery = mockUserFindMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
    };
    expect(userQuery.where.id.in).toEqual(['user-2']);
  });

  it('returns count 0 without calling user.findMany when all users are deduped', async () => {
    const mockNotifFindMany = prisma.notification.findMany as ReturnType<typeof vi.fn>;
    mockNotifFindMany.mockResolvedValueOnce([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ]);

    const result = await notify({
      ...WARRANTY_INPUT,
      userIds: ['user-1', 'user-2'],
      dedupeKey: 'warranty:asset-1',
      dedupeWindow: 'day',
    });

    expect(result.count).toBe(0);
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('embeds dedupeKey into notification.data so the next dedupe lookup can find it', async () => {
    const mockNotifFindMany = prisma.notification.findMany as ReturnType<typeof vi.fn>;
    mockNotifFindMany.mockResolvedValueOnce([]); // no prior notifications today
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({
      ...WARRANTY_INPUT,
      userId: 'user-1',
      data: { assetId: 'asset-1', url: '/admin/assets/asset-1' },
      dedupeKey: 'warranty:asset-1',
      dedupeWindow: 'day',
    });

    const rows = mockCreateMany.mock.calls[0]![0] as Array<{ data: Record<string, unknown> }>;
    expect(rows[0]!.data).toMatchObject({
      assetId: 'asset-1',
      url: '/admin/assets/asset-1',
      dedupeKey: 'warranty:asset-1',
    });
  });

  it('does not query notifications when dedupeKey or dedupeWindow is missing', async () => {
    const mockNotifFindMany = prisma.notification.findMany as ReturnType<typeof vi.fn>;
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN]);
    mockCreateMany.mockResolvedValueOnce({ count: 1 });

    await notify({ ...WARRANTY_INPUT, userId: 'user-1' });

    expect(mockNotifFindMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('notifyRole()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries users filtered by role name, ACTIVE, and not deleted', async () => {
    mockUserFindMany.mockResolvedValueOnce([]); // role query returns nothing
    await notifyRole('ADMIN', WARRANTY_INPUT);

    expect(mockUserFindMany).toHaveBeenCalledOnce();
    const [findManyArgs] = mockUserFindMany.mock.calls[0]!;
    expect(findManyArgs.where).toMatchObject({
      status: 'ACTIVE',
      deletedAt: null,
      userRoles: { some: { role: { name: 'ADMIN' } } },
    });
  });

  it('returns { count: 0 } without throwing when no ADMIN users are found', async () => {
    mockUserFindMany.mockResolvedValueOnce([]);
    const result = await notifyRole('ADMIN', WARRANTY_INPUT);
    expect(result).toEqual({ count: 0 });
  });

  it('delegates to notify() with collected user ids when users exist', async () => {
    // First call: the role query that returns userIds
    mockUserFindMany.mockResolvedValueOnce([{ id: 'admin-1' }, { id: 'admin-2' }]);
    // Second call: the findMany inside notify() itself
    mockUserFindMany.mockResolvedValueOnce([ACTIVE_USER_EN, ACTIVE_USER_ID]);
    mockCreateMany.mockResolvedValueOnce({ count: 2 });

    const result = await notifyRole('ADMIN', WARRANTY_INPUT);
    expect(result).toEqual({ count: 2 });
    // notify was driven via the second findMany
    expect(mockUserFindMany).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('markRead()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { id } for a valid notification owned by the user', async () => {
    mockFindByIdForUser.mockResolvedValueOnce({
      id: 'notif-1',
      userId: 'user-1',
      isRead: false,
    });
    mockMarkRead.mockResolvedValueOnce({ count: 1 });

    const result = await markRead('notif-1', 'user-1');
    expect(result).toEqual({ id: 'notif-1' });
    expect(mockMarkRead).toHaveBeenCalledOnce();
  });

  it('throws AppError 404 when notification is not found for that user', async () => {
    mockFindByIdForUser.mockResolvedValueOnce(null);

    await expect(markRead('no-such-id', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOTIFICATION_NOT_FOUND',
    });
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('is idempotent — returns { id } without writing when notification is already read', async () => {
    mockFindByIdForUser.mockResolvedValueOnce({
      id: 'notif-1',
      userId: 'user-1',
      isRead: true,
    });

    const result = await markRead('notif-1', 'user-1');
    expect(result).toEqual({ id: 'notif-1' });
    // No update call because isRead is already true
    expect(mockMarkRead).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('markAllRead()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { count } from the repository updateMany result', async () => {
    mockMarkAllRead.mockResolvedValueOnce({ count: 7 });
    const result = await markAllRead('user-1');
    expect(result).toEqual({ count: 7 });
    expect(mockMarkAllRead).toHaveBeenCalledWith('user-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('listForUser()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds correct WHERE filter from query params (default — no filter)', async () => {
    mockFindMany.mockResolvedValueOnce({ items: [], total: 0 });

    await listForUser('user-1', { page: 1, limit: 20 });

    const [userId, filters, pagination] = mockFindMany.mock.calls[0]!;
    expect(userId).toBe('user-1');
    expect(filters).toEqual({ isRead: undefined, type: undefined });
    expect(pagination).toEqual({ skip: 0, take: 20 });
  });

  it('passes isRead: true filter when provided', async () => {
    mockFindMany.mockResolvedValueOnce({ items: [], total: 0 });

    await listForUser('user-1', { page: 1, limit: 20, isRead: true });

    const [, filters] = mockFindMany.mock.calls[0]!;
    expect(filters.isRead).toBe(true);
  });

  it('passes isRead: false filter when provided', async () => {
    mockFindMany.mockResolvedValueOnce({ items: [], total: 0 });

    await listForUser('user-1', { page: 2, limit: 10, isRead: false });

    const [, filters, pagination] = mockFindMany.mock.calls[0]!;
    expect(filters.isRead).toBe(false);
    expect(pagination).toEqual({ skip: 10, take: 10 });
  });

  it('passes type filter when provided', async () => {
    mockFindMany.mockResolvedValueOnce({ items: [], total: 0 });

    await listForUser('user-1', {
      page: 1,
      limit: 20,
      type: 'WARRANTY_EXPIRING',
    });

    const [, filters] = mockFindMany.mock.calls[0]!;
    expect(filters.type).toBe('WARRANTY_EXPIRING');
  });

  it('returns meta with correct page/limit/total/totalPages', async () => {
    mockFindMany.mockResolvedValueOnce({ items: [], total: 55 });

    const { meta } = await listForUser('user-1', { page: 3, limit: 10 });

    expect(meta).toEqual({ page: 3, limit: 10, total: 55, totalPages: 6 });
  });

  it('computes skip correctly from page and limit', async () => {
    mockFindMany.mockResolvedValueOnce({ items: [], total: 0 });

    await listForUser('user-1', { page: 4, limit: 25 });

    const [, , pagination] = mockFindMany.mock.calls[0]!;
    expect(pagination.skip).toBe(75); // (4-1) * 25
    expect(pagination.take).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('unreadCount()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { count } from the repository count result', async () => {
    mockUnreadCount.mockResolvedValueOnce(12);
    const result = await unreadCount('user-1');
    expect(result).toEqual({ count: 12 });
    expect(mockUnreadCount).toHaveBeenCalledWith('user-1');
  });

  it('returns { count: 0 } when there are no unread notifications', async () => {
    mockUnreadCount.mockResolvedValueOnce(0);
    const result = await unreadCount('user-1');
    expect(result).toEqual({ count: 0 });
  });
});
