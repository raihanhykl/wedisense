import { prisma } from '../../lib/prisma.js';
import type { Prisma, NotificationType } from '@prisma/client';

export async function findManyForUser(
  userId: string,
  filters: { isRead?: boolean; type?: NotificationType },
  pagination: { skip: number; take: number },
): Promise<{ items: Awaited<ReturnType<typeof prisma.notification.findMany>>; total: number }> {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(filters.isRead !== undefined && { isRead: filters.isRead }),
    ...(filters.type !== undefined && { type: filters.type }),
  };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.notification.count({ where }),
  ]);

  return { items, total };
}

export async function unreadCountForUser(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

export async function findByIdForUser(
  id: string,
  userId: string,
): Promise<Awaited<ReturnType<typeof prisma.notification.findFirst>>> {
  return prisma.notification.findFirst({
    where: { id, userId },
  });
}

export async function markRead(
  id: string,
  userId: string,
): Promise<{ count: number }> {
  return prisma.notification.updateMany({
    where: { id, userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllRead(userId: string): Promise<{ count: number }> {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function createMany(
  rows: Prisma.NotificationCreateManyInput[],
): Promise<{ count: number }> {
  return prisma.notification.createMany({ data: rows });
}
