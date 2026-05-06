import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { buildPaginationMeta } from '../../utils/pagination.js';
import { t } from '../../lib/l10n.js';
import { sendNotificationEmail } from '../../lib/mailer.js';
import * as repo from './repository.js';
import type { NotifyInput, NotifyRoleInput, NotificationDto } from './types.js';
import type { ListQuery } from './schema.js';

// ── Email template resolution ─────────────────────────────────────────

function resolveEmailTemplateName(type: NotificationType): string | null {
  const map: Partial<Record<NotificationType, string>> = {
    WARRANTY_EXPIRING: 'warranty-expiring',
    LOAN_OVERDUE: 'loan-overdue',
    MAINTENANCE_DUE: 'maintenance-due',
    ASSET_LOST: 'asset-lost',
    ASSET_DISPOSED: 'asset-disposed',
  };
  return map[type] ?? null;
}

// ── List notifications ────────────────────────────────────────────────

export async function listForUser(
  userId: string,
  query: ListQuery,
): Promise<{ items: NotificationDto[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  const { page, limit, isRead, type } = query;
  const skip = (page - 1) * limit;

  const { items, total } = await repo.findManyForUser(
    userId,
    { isRead, type },
    { skip, take: limit },
  );

  return {
    items: items as NotificationDto[],
    meta: buildPaginationMeta(page, limit, total),
  };
}

// ── Unread count ──────────────────────────────────────────────────────

export async function unreadCount(userId: string): Promise<{ count: number }> {
  const count = await repo.unreadCountForUser(userId);
  return { count };
}

// ── Mark single notification read ─────────────────────────────────────

export async function markRead(id: string, userId: string): Promise<{ id: string }> {
  // Verify ownership (don't 404 to reveal existence)
  const notification = await repo.findByIdForUser(id, userId);
  if (!notification) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }

  // Idempotent: already read, return as-is
  if (!notification.isRead) {
    await repo.markRead(id, userId);
  }

  return { id };
}

// ── Mark all notifications read ───────────────────────────────────────

export async function markAllRead(userId: string): Promise<{ count: number }> {
  return repo.markAllRead(userId);
}

// ── Dedupe helpers ────────────────────────────────────────────────────

function dedupeWindowStart(window: NotifyInput['dedupeWindow']): Date | null {
  if (window !== 'day') return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Filter out user IDs that have already been notified with the same
 * dedupeKey inside the dedupe window. Single round-trip query.
 */
async function filterAlreadyNotified(
  userIds: string[],
  type: NotificationType,
  dedupeKey: string,
  windowStart: Date,
): Promise<string[]> {
  const existing = await prisma.notification.findMany({
    where: {
      userId: { in: userIds },
      type,
      createdAt: { gte: windowStart },
      data: {
        path: ['dedupeKey'],
        equals: dedupeKey,
      },
    },
    select: { userId: true },
  });
  if (existing.length === 0) return userIds;
  const skip = new Set(existing.map((e) => e.userId));
  return userIds.filter((id) => !skip.has(id));
}

// ── Core notify helper ────────────────────────────────────────────────

export async function notify(input: NotifyInput): Promise<{ count: number }> {
  const resolvedIds: string[] = [];

  if (input.userId) {
    resolvedIds.push(input.userId);
  }
  if (input.userIds && input.userIds.length > 0) {
    resolvedIds.push(...input.userIds);
  }

  let uniqueIds = [...new Set(resolvedIds)];
  if (uniqueIds.length === 0) {
    return { count: 0 };
  }

  // Per-window dedupe: skip users who already received this dedupeKey
  if (input.dedupeKey && input.dedupeWindow) {
    const windowStart = dedupeWindowStart(input.dedupeWindow);
    if (windowStart) {
      uniqueIds = await filterAlreadyNotified(
        uniqueIds,
        input.type,
        input.dedupeKey,
        windowStart,
      );
      if (uniqueIds.length === 0) {
        return { count: 0 };
      }
    }
  }

  // Fetch users with preferred language
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds }, status: 'ACTIVE', deletedAt: null },
    select: { id: true, preferredLanguage: true, name: true, email: true },
  });

  if (users.length === 0) {
    return { count: 0 };
  }

  // Compose payload data, embedding dedupeKey when supplied so the
  // next dedupe lookup can find it on `notification.data.dedupeKey`.
  const baseData: Record<string, unknown> = { ...(input.data ?? {}) };
  if (input.dedupeKey) {
    baseData['dedupeKey'] = input.dedupeKey;
  }
  const payloadData =
    Object.keys(baseData).length > 0
      ? (baseData as Prisma.InputJsonValue)
      : undefined;

  const rows: Prisma.NotificationCreateManyInput[] = users.map((user) => {
    const lang = user.preferredLanguage ?? 'id';
    const title = t(lang, input.titleKey, input.vars);
    const message = t(lang, input.messageKey, input.vars);

    return {
      userId: user.id,
      type: input.type,
      title,
      message,
      data: payloadData,
    };
  });

  const result = await repo.createMany(rows);

  // Best-effort email sending (fire-and-forget)
  const templateName = resolveEmailTemplateName(input.type);
  if (templateName) {
    for (const user of users) {
      const lang = user.preferredLanguage ?? 'id';
      const subjectKey = `email.${templateName.replaceAll('-', '_')}.subject`;
      const subject = t(lang, subjectKey, input.vars) || input.titleKey;
      const vars = {
        name: user.name,
        ...(input.vars ?? {}),
      };

      void sendNotificationEmail({
        to: user.email,
        templateName,
        lang,
        vars,
        subject,
      }).catch((err: unknown) => {
        console.error('[notify] Email send error:', err instanceof Error ? err.message : err);
      });
    }
  }

  return result;
}

// ── notifyRole helper ─────────────────────────────────────────────────

export async function notifyRole(
  roleName: string,
  input: NotifyRoleInput,
): Promise<{ count: number }> {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      userRoles: { some: { role: { name: roleName } } },
    },
    select: { id: true },
  });

  if (users.length === 0) {
    return { count: 0 };
  }

  return notify({
    ...input,
    userIds: users.map((u) => u.id),
  });
}
