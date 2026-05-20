import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { AUTH } from '@wedisense/shared';
import type { JwtAccessPayload, JwtRefreshPayload, AuthenticatedUser } from './types.js';
import type { LoginInput, ChangePasswordInput } from './schema.js';
import { hasIncompleteTourForUser } from '../tours/service.js';

const ACCESS_SECRET = process.env['JWT_ACCESS_SECRET'] ?? 'dev-access-secret';
const REFRESH_SECRET = process.env['JWT_REFRESH_SECRET'] ?? 'dev-refresh-secret';

function signAccessToken(userId: string, email: string): string {
  const payload: JwtAccessPayload = { userId, email, type: 'access' };
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: AUTH.ACCESS_TOKEN_EXPIRY });
}

function signRefreshToken(userId: string): string {
  const payload: JwtRefreshPayload = { userId, type: 'refresh' };
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: AUTH.REFRESH_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as JwtAccessPayload;
    if (decoded.type !== 'access') {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid token type');
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as JwtRefreshPayload;
    if (decoded.type !== 'refresh') {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid token type');
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
  }
}

async function getAccessibleLocationIds(userRoles: Array<{ locationId: string | null }>): Promise<string[]> {
  const hasGlobalRole = userRoles.some((r) => r.locationId === null);

  if (hasGlobalRole) {
    const allLocations = await prisma.location.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return allLocations.map((l) => l.id);
  }

  const scopedLocationIds = userRoles
    .map((r) => r.locationId)
    .filter((id): id is string => id !== null);

  if (scopedLocationIds.length === 0) return [];

  // Get scoped locations + all their descendants via recursive CTE
  const descendants = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE location_tree AS (
      SELECT id FROM locations WHERE id = ANY(${scopedLocationIds}::uuid[]) AND deleted_at IS NULL
      UNION ALL
      SELECT l.id FROM locations l
      INNER JOIN location_tree lt ON l.parent_id = lt.id
      WHERE l.deleted_at IS NULL
    )
    SELECT id FROM location_tree
  `;

  return descendants.map((d) => d.id);
}

export async function resolveAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    },
  });

  if (!user || user.status === 'RESIGNED') {
    throw new AppError(401, 'USER_NOT_FOUND', 'User account not found or inactive');
  }

  if (user.status === 'INACTIVE') {
    throw new AppError(403, 'USER_INACTIVE', 'User account is inactive');
  }

  const roles = user.userRoles.map((ur) => ({
    id: ur.role.id,
    name: ur.role.name,
    locationId: ur.locationId,
  }));

  const permissionSet = new Set<string>();
  for (const ur of user.userRoles) {
    for (const rp of ur.role.rolePermissions) {
      permissionSet.add(`${rp.permission.resource}:${rp.permission.action}`);
    }
  }

  const accessibleLocationIds = await getAccessibleLocationIds(user.userRoles);

  const partial: Omit<AuthenticatedUser, 'hasIncompleteTour'> = {
    id: user.id,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
    preferredLanguage: user.preferredLanguage,
    status: user.status,
    roles,
    permissions: Array.from(permissionSet),
    accessibleLocationIds,
  };

  // Determine first-run flag. We build a partial AuthenticatedUser first so
  // hasIncompleteTourForUser() can filter on roles and permissions without
  // the field being set yet. The flag is informational-only (never gates access).
  const hasIncompleteTour = await hasIncompleteTourForUser({
    ...partial,
    hasIncompleteTour: false,
  });

  return { ...partial, hasIncompleteTour };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email, deletedAt: null },
  });

  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.status === 'RESIGNED') {
    throw new AppError(403, 'USER_RESIGNED', 'Account has been deactivated');
  }

  if (user.status === 'INACTIVE') {
    throw new AppError(403, 'USER_INACTIVE', 'Account is inactive');
  }

  const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);
  if (!isValidPassword) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const accessToken = signAccessToken(user.id, user.email);
  const refreshToken = signRefreshToken(user.id);
  const authenticatedUser = await resolveAuthenticatedUser(user.id);

  return { accessToken, refreshToken, user: authenticatedUser };
}

export async function refreshTokens(currentRefreshToken: string) {
  const payload = verifyRefreshToken(currentRefreshToken);

  const user = await prisma.user.findUnique({
    where: { id: payload.userId, deletedAt: null },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(401, 'USER_NOT_FOUND', 'User account not found or inactive');
  }

  const accessToken = signAccessToken(user.id, user.email);
  const refreshToken = signRefreshToken(user.id);

  return { accessToken, refreshToken };
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const isValidPassword = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!isValidPassword) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }

  const newHash = await bcrypt.hash(input.newPassword, AUTH.BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });
}
