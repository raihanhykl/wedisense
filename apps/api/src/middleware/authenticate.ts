import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, resolveAuthenticatedUser } from '../modules/auth/service.js';
import { AppError } from './error-handler.js';
import type { AuthenticatedUser } from '../modules/auth/types.js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'MISSING_TOKEN', 'Authorization header with Bearer token is required');
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  resolveAuthenticatedUser(payload.userId)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}
