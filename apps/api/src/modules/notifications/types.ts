import type { NotificationType } from '@prisma/client';

/**
 * Dedupe a notification within a recent window so that re-running a daily
 * job does not double-notify. The key is stored on `Notification.data.dedupeKey`
 * and matched per user inside the window.
 */
export type DedupeWindow = 'day';

export interface NotifyInput {
  userIds?: string[];
  userId?: string;
  type: NotificationType;
  titleKey: string;
  messageKey: string;
  vars?: Record<string, string | number>;
  data?: Record<string, unknown>;
  /** Logical event identifier (e.g. `warranty:${assetId}`) — required if `dedupeWindow` is set. */
  dedupeKey?: string;
  /** Suppress for users who received a notification with this dedupeKey within the window. */
  dedupeWindow?: DedupeWindow;
}

export interface NotifyRoleInput {
  type: NotificationType;
  titleKey: string;
  messageKey: string;
  vars?: Record<string, string | number>;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  dedupeWindow?: DedupeWindow;
}

export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}
