/**
 * SMS notification helper.
 *
 * Sends in-app notifications to users who hold a given SMS permission at a
 * specific showroom location (via a global unscoped role OR a scoped role
 * whose scope root is an ancestor of the target location).
 *
 * Key design rule: notifications are sent AFTER the transaction commits.
 * A failure here must NEVER fail the HTTP request — always catch and log.
 *
 * We bypass notifications/service.notify() because that module requires
 * i18n locale keys. SMS notifications use English strings written directly.
 */
import { Prisma, type NotificationType } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { SMS_PERMISSION_PREFIX } from '@wedisense/shared';
import type { SmsPermission } from '@wedisense/shared';

export interface SmsNotificationPayload {
  kind: string;
  returnRequestId?: string;
  unitId?: string;
  vin?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * Resolve the user IDs of ACTIVE, non-deleted users who hold `permission` at
 * `locationId` (globally or via a scoped role whose scope root is `locationId`
 * or one of its ancestors).
 */
async function resolveRecipients(
  permission: SmsPermission,
  locationId: string,
): Promise<string[]> {
  const [resource, action] = permission.split(':') as [string, string];

  // Find all ancestor location IDs (including the location itself) in one CTE.
  // Then find all users whose role-permission for this action applies globally OR
  // whose scoped role root is one of those ancestors.
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    WITH RECURSIVE ancestors AS (
      SELECT id FROM locations WHERE id = ${locationId}::uuid
      UNION ALL
      SELECT l.parent_id
      FROM locations l
      INNER JOIN ancestors a ON l.id = a.id
      WHERE l.parent_id IS NOT NULL
    )
    SELECT DISTINCT ur.user_id::text AS user_id
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE p.resource = ${resource}
      AND p.action = ${action}
      AND (
        ur.location_id IS NULL
        OR ur.location_id IN (SELECT id FROM ancestors)
      )
      AND ur.user_id IN (
        SELECT id FROM users WHERE deleted_at IS NULL AND status = 'ACTIVE'
      )
  `;

  return rows.map((r) => r.user_id);
}

/**
 * Send an SMS notification to all users holding `permission` at `locationId`.
 *
 * Must be called OUTSIDE the write transaction. Failures are caught and
 * logged — a notification failure must never surface as an HTTP error.
 */
export async function notifySmsPermission(
  permission: SmsPermission,
  locationId: string,
  type: NotificationType,
  title: string,
  message: string,
  data: SmsNotificationPayload,
): Promise<void> {
  try {
    const userIds = await resolveRecipients(permission, locationId);
    if (userIds.length === 0) return;

    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        title,
        message,
        data: data as Prisma.InputJsonValue,
        isRead: false,
      })),
      skipDuplicates: false,
    });
  } catch (err) {
    console.error('[sms/notify] Failed to create notifications:', err instanceof Error ? err.message : err);
  }
}

/**
 * Send an SMS notification to a specific list of user IDs.
 *
 * Must be called OUTSIDE the write transaction. Failures are logged silently.
 */
export async function notifySmsUsers(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  data: SmsNotificationPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        title,
        message,
        data: data as Prisma.InputJsonValue,
        isRead: false,
      })),
      skipDuplicates: false,
    });
  } catch (err) {
    console.error('[sms/notify] Failed to create user notifications:', err instanceof Error ? err.message : err);
  }
}

/** Check whether the SMS permission prefix belongs to this module. */
export const _SMS_PERM_PREFIX = SMS_PERMISSION_PREFIX;
