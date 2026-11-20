import type { Request } from 'express';
import { AppError } from '../../../middleware/error-handler.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a UUID route parameter.
 *
 * A malformed id cannot match any record, so it is answered exactly like a
 * missing one (404) — instead of reaching PostgreSQL, which rejects it as an
 * invalid uuid and would surface as a 500.
 */
export function uuidParam(
  req: Request,
  name: string,
  notFound: { code: string; message: string },
): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new AppError(404, notFound.code, notFound.message);
  }
  return value;
}

export const UNIT_NOT_FOUND = { code: 'SMS_UNIT_NOT_FOUND', message: 'Unit not found' } as const;
export const INSPECTION_NOT_FOUND = {
  code: 'SMS_INSPECTION_NOT_FOUND',
  message: 'Inspection not found',
} as const;
