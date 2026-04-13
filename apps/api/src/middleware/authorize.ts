import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler.js';

/**
 * Authorization middleware that checks if the authenticated user
 * has the required permission(s).
 *
 * Usage:
 *   router.get('/assets', authenticate, authorize('assets:read'), handler)
 *   router.post('/assets', authenticate, authorize('assets:create'), handler)
 *   router.delete('/assets/:id', authenticate, authorize('assets:delete', 'assets:read'), handler)
 */
export function authorize(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      throw new AppError(401, 'NOT_AUTHENTICATED', 'Authentication required');
    }

    const hasAllPermissions = requiredPermissions.every(
      (perm) => user.permissions.includes(perm),
    );

    if (!hasAllPermissions) {
      throw new AppError(
        403,
        'INSUFFICIENT_PERMISSION',
        `Required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    next();
  };
}
