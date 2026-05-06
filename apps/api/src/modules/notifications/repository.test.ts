import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Prisma ──────────────────────────────────────────────────────────
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma.js';
import {
  findManyForUser,
  unreadCountForUser,
  findByIdForUser,
  markRead,
  markAllRead,
  createMany,
} from './repository.js';
import type { Prisma } from '@prisma/client';

const mockFindMany = prisma.notification.findMany as ReturnType<typeof vi.fn>;
const mockCount = prisma.notification.count as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.notification.findFirst as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.notification.updateMany as ReturnType<typeof vi.fn>;
const mockCreateMany = prisma.notification.createMany as ReturnType<typeof vi.fn>;

// ─────────────────────────────────────────────────────────────────────────
describe('findManyForUser()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it('always passes userId into the WHERE clause', async () => {
    await findManyForUser('user-1', {}, { skip: 0, take: 20 });

    const whereArg = mockFindMany.mock.calls[0]![0].where;
    expect(whereArg).toMatchObject({ userId: 'user-1' });
  });

  it('does NOT add isRead to WHERE when filter is undefined', async () => {
    await findManyForUser('user-1', {}, { skip: 0, take: 20 });

    const whereArg = mockFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(whereArg).not.toHaveProperty('isRead');
  });

  it('adds isRead: true to WHERE when isRead filter is true', async () => {
    await findManyForUser('user-1', { isRead: true }, { skip: 0, take: 20 });

    const whereArg = mockFindMany.mock.calls[0]![0].where;
    expect(whereArg).toMatchObject({ isRead: true });
  });

  it('adds isRead: false to WHERE when isRead filter is false', async () => {
    await findManyForUser('user-1', { isRead: false }, { skip: 0, take: 20 });

    const whereArg = mockFindMany.mock.calls[0]![0].where;
    expect(whereArg).toMatchObject({ isRead: false });
  });

  it('adds type to WHERE when type filter is provided', async () => {
    await findManyForUser(
      'user-1',
      { type: 'WARRANTY_EXPIRING' },
      { skip: 0, take: 20 },
    );

    const whereArg = mockFindMany.mock.calls[0]![0].where;
    expect(whereArg).toMatchObject({ type: 'WARRANTY_EXPIRING' });
  });

  it('does NOT add type to WHERE when type filter is undefined', async () => {
    await findManyForUser('user-1', {}, { skip: 0, take: 20 });

    const whereArg = mockFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(whereArg).not.toHaveProperty('type');
  });

  it('combines all filters correctly', async () => {
    await findManyForUser(
      'user-99',
      { isRead: false, type: 'LOAN_OVERDUE' },
      { skip: 40, take: 10 },
    );

    const callArg = mockFindMany.mock.calls[0]![0];
    expect(callArg.where).toMatchObject({
      userId: 'user-99',
      isRead: false,
      type: 'LOAN_OVERDUE',
    });
    expect(callArg.skip).toBe(40);
    expect(callArg.take).toBe(10);
  });

  it('uses the same WHERE clause for both findMany and count calls', async () => {
    await findManyForUser(
      'user-1',
      { isRead: true, type: 'MAINTENANCE_DUE' },
      { skip: 0, take: 5 },
    );

    const findManyWhere = mockFindMany.mock.calls[0]![0].where;
    const countWhere = mockCount.mock.calls[0]![0].where;
    expect(findManyWhere).toEqual(countWhere);
  });

  it('orders results by createdAt desc', async () => {
    await findManyForUser('user-1', {}, { skip: 0, take: 20 });

    const orderBy = mockFindMany.mock.calls[0]![0].orderBy;
    expect(orderBy).toEqual({ createdAt: 'desc' });
  });

  it('returns { items, total } with values from prisma', async () => {
    const fakeItems = [{ id: 'n1' }, { id: 'n2' }];
    mockFindMany.mockResolvedValueOnce(fakeItems);
    mockCount.mockResolvedValueOnce(42);

    const result = await findManyForUser('user-1', {}, { skip: 0, take: 20 });

    expect(result.items).toEqual(fakeItems);
    expect(result.total).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('unreadCountForUser()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls count with userId and isRead: false', async () => {
    mockCount.mockResolvedValueOnce(3);
    await unreadCountForUser('user-1');

    expect(mockCount).toHaveBeenCalledWith({
      where: { userId: 'user-1', isRead: false },
    });
  });

  it('returns the count value from prisma', async () => {
    mockCount.mockResolvedValueOnce(7);
    const result = await unreadCountForUser('user-1');
    expect(result).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('findByIdForUser()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls findFirst with id and userId', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await findByIdForUser('notif-1', 'user-1');

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: 'user-1' },
    });
  });

  it('returns the notification when found', async () => {
    const fakeNotif = { id: 'notif-1', userId: 'user-1', isRead: false };
    mockFindFirst.mockResolvedValueOnce(fakeNotif);

    const result = await findByIdForUser('notif-1', 'user-1');
    expect(result).toEqual(fakeNotif);
  });

  it('returns null when notification is not found', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await findByIdForUser('ghost', 'user-1');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('markRead()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls updateMany with id, userId, and isRead: false as WHERE clause', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    await markRead('notif-1', 'user-1');

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: 'user-1', isRead: false },
      data: expect.objectContaining({ isRead: true }),
    });
  });

  it('sets isRead: true and readAt in the update data', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    await markRead('notif-1', 'user-1');

    const dataArg = mockUpdateMany.mock.calls[0]![0].data;
    expect(dataArg.isRead).toBe(true);
    expect(dataArg.readAt).toBeInstanceOf(Date);
  });

  it('returns { count } from prisma result', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    const result = await markRead('notif-1', 'user-1');
    expect(result).toEqual({ count: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('markAllRead()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls updateMany with only userId in WHERE (reads all unread)', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 5 });
    await markAllRead('user-1');

    const whereArg = mockUpdateMany.mock.calls[0]![0].where;
    expect(whereArg).toMatchObject({ userId: 'user-1', isRead: false });
  });

  it('returns { count } from prisma result', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 5 });
    const result = await markAllRead('user-1');
    expect(result).toEqual({ count: 5 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('createMany()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma.notification.createMany with the provided rows', async () => {
    mockCreateMany.mockResolvedValueOnce({ count: 2 });
    const rows: Prisma.NotificationCreateManyInput[] = [
      {
        userId: 'user-1',
        type: 'WARRANTY_EXPIRING',
        title: 'T1',
        message: 'M1',
      },
      {
        userId: 'user-2',
        type: 'LOAN_OVERDUE',
        title: 'T2',
        message: 'M2',
      },
    ];

    await createMany(rows);

    expect(mockCreateMany).toHaveBeenCalledWith({ data: rows });
  });

  it('returns { count } from prisma result', async () => {
    mockCreateMany.mockResolvedValueOnce({ count: 3 });
    const result = await createMany([]);
    expect(result).toEqual({ count: 3 });
  });
});
