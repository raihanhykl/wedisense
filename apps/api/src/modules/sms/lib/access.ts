/**
 * SMS authorization: "may this user do X at showroom L?"
 *
 * The shared `authorize()` middleware answers a coarser question. It checks a
 * flat union of permissions across all of a user's roles, so someone who is a
 * stock admin in Bekasi and a read-only viewer in Jakarta would pass a
 * "can book" check for a Jakarta unit. The SMS spec (§6, scenario A13)
 * requires the (action, location) PAIR to be enforced on the server.
 *
 * This module resolves, per request, which SMS permissions the user holds at
 * which locations. A role assigned with a location scope covers that location
 * and all of its descendants; a role assigned without a scope is global.
 *
 * Rule for callers: the location passed to `assertCan` must come from the
 * entity being acted on (the locked unit, the shipment, the order) — never
 * straight from the request body.
 *
 * Nothing here changes the shared auth module or AMS behaviour.
 */
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  SMS_PERMISSION_PREFIX,
  SMS_STOCK_LOCATION_TYPES,
  type SmsPermission,
} from '@wedisense/shared';
import { prisma } from '../../../lib/prisma.js';
import { AppError } from '../../../middleware/error-handler.js';

export interface SmsAccess {
  userId: string;
  /** Permissions held through a role assigned without a location scope. */
  global: ReadonlySet<string>;
  /** Permissions per location id (scope root and every descendant). */
  byLocation: ReadonlyMap<string, ReadonlySet<string>>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      smsAccess?: SmsAccess;
    }
  }
}

/** Build the access map for one user. Two queries, no caching. */
export async function resolveSmsAccess(userId: string): Promise<SmsAccess> {
  const userRoles = await prisma.userRole.findMany({
    where: {
      userId,
      role: {
        rolePermissions: {
          some: { permission: { resource: { startsWith: SMS_PERMISSION_PREFIX } } },
        },
      },
    },
    select: {
      locationId: true,
      role: {
        select: {
          rolePermissions: {
            where: { permission: { resource: { startsWith: SMS_PERMISSION_PREFIX } } },
            select: { permission: { select: { resource: true, action: true } } },
          },
        },
      },
    },
  });

  const global = new Set<string>();
  const byScopeRoot = new Map<string, Set<string>>();

  for (const userRole of userRoles) {
    const keys = userRole.role.rolePermissions.map(
      ({ permission }) => `${permission.resource}:${permission.action}`,
    );
    if (userRole.locationId === null) {
      keys.forEach((key) => global.add(key));
      continue;
    }
    const scoped = byScopeRoot.get(userRole.locationId) ?? new Set<string>();
    keys.forEach((key) => scoped.add(key));
    byScopeRoot.set(userRole.locationId, scoped);
  }

  const byLocation = new Map<string, Set<string>>();
  const scopeRootIds = [...byScopeRoot.keys()];
  if (scopeRootIds.length > 0) {
    // One recursive walk for all scope roots: each row says "location `id`
    // lies inside the subtree of scope root `root_id`".
    const rows = await prisma.$queryRaw<Array<{ root_id: string; id: string }>>`
      WITH RECURSIVE subtree AS (
        SELECT id AS root_id, id
        FROM locations
        WHERE id IN (${Prisma.join(scopeRootIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND deleted_at IS NULL
        UNION ALL
        SELECT s.root_id, l.id
        FROM locations l
        INNER JOIN subtree s ON l.parent_id = s.id
        WHERE l.deleted_at IS NULL
      )
      SELECT root_id::text AS root_id, id::text AS id FROM subtree
    `;
    for (const row of rows) {
      const granted = byScopeRoot.get(row.root_id);
      if (!granted) continue;
      const atLocation = byLocation.get(row.id) ?? new Set<string>();
      granted.forEach((key) => atLocation.add(key));
      byLocation.set(row.id, atLocation);
    }
  }

  return { userId, global, byLocation };
}

/** Does the user hold `permission` at `locationId`? */
export function can(
  access: SmsAccess,
  permission: SmsPermission,
  locationId: string | null | undefined,
): boolean {
  if (access.global.has(permission)) return true;
  if (!locationId) return false;
  return access.byLocation.get(locationId)?.has(permission) ?? false;
}

/** Does the user hold `permission` at one location at least? */
export function canAnywhere(access: SmsAccess, permission: SmsPermission): boolean {
  if (access.global.has(permission)) return true;
  for (const granted of access.byLocation.values()) {
    if (granted.has(permission)) return true;
  }
  return false;
}

/**
 * Throw 403 unless the user holds `permission` at `locationId`.
 * The message is intentionally generic: it must not reveal anything about a
 * unit the caller is not allowed to act on.
 */
export function assertCan(
  access: SmsAccess,
  permission: SmsPermission,
  locationId: string | null | undefined,
): void {
  if (can(access, permission, locationId)) return;
  throw new AppError(
    403,
    'SMS_FORBIDDEN_AT_LOCATION',
    'You do not have permission to do this at this location.',
    [{ permission }],
  );
}

/**
 * Where the user holds `permission`: `'ALL'` for a global grant, otherwise
 * the list of location ids. Use it to scope list and report queries.
 */
export function locationScope(access: SmsAccess, permission: SmsPermission): 'ALL' | string[] {
  if (access.global.has(permission)) return 'ALL';
  const ids: string[] = [];
  for (const [locationId, granted] of access.byLocation) {
    if (granted.has(permission)) ids.push(locationId);
  }
  return ids;
}

/** Prisma filter fragment for a location column, from a `locationScope` result. */
export function scopeFilter(scope: 'ALL' | string[]): { in: string[] } | undefined {
  return scope === 'ALL' ? undefined : { in: scope };
}

/** Every SMS permission the user holds at `locationId` (for UI affordances). */
export function permissionsAt(access: SmsAccess, locationId: string): string[] {
  const granted = new Set<string>(access.global);
  access.byLocation.get(locationId)?.forEach((key) => granted.add(key));
  return [...granted].sort();
}

/** The locations that can hold stock and that the user may see. */
export async function listAccessibleStockLocations(
  access: SmsAccess,
  permission: SmsPermission,
): Promise<Array<{ id: string; code: string; name: string; type: string; permissions: string[] }>> {
  const scope = locationScope(access, permission);
  if (scope !== 'ALL' && scope.length === 0) return [];
  const locations = await prisma.location.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      type: { in: [...SMS_STOCK_LOCATION_TYPES] },
      id: scopeFilter(scope),
    },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { name: 'asc' },
  });
  return locations.map((location) => ({
    ...location,
    permissions: permissionsAt(access, location.id),
  }));
}

// ── Express glue ───────────────────────────────────────────────────────────

/** Resolves and attaches `req.smsAccess`. Mounted once on the SMS router. */
export function loadSmsAccess(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }
  resolveSmsAccess(user.id)
    .then((access) => {
      req.smsAccess = access;
      next();
    })
    .catch(next);
}

/** Typed accessor — the SMS router guarantees the access map is loaded. */
export function getSmsAccess(req: Request): SmsAccess {
  if (!req.smsAccess) {
    throw new AppError(500, 'SMS_ACCESS_NOT_LOADED', 'SMS access was not resolved for this request');
  }
  return req.smsAccess;
}

/**
 * Coarse route gate: the user must hold `permission` somewhere. It keeps
 * users without any SMS role out early; the authoritative per-location check
 * still happens in the service with `assertCan`.
 */
export function requireSmsPermission(permission: SmsPermission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (canAnywhere(getSmsAccess(req), permission)) {
      next();
      return;
    }
    next(
      new AppError(403, 'INSUFFICIENT_PERMISSION', 'You do not have permission to perform this action', [
        { permission },
      ]),
    );
  };
}
