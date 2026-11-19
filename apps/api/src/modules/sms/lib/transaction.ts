/**
 * Transaction wrapper for SMS writes.
 *
 * Every SMS mutation runs inside one interactive transaction: lock the
 * unit(s), re-read, authorize, apply the reducer, write domain rows, the
 * ledger event and the audit row. This wrapper adds two things on top of
 * `prisma.$transaction`:
 *
 *  - explicit timeouts, so a slow multi-unit operation fails loudly instead
 *    of hitting Prisma's 5s default with an opaque error;
 *  - translation of lock conflicts (deadlock, serialization failure, lock
 *    wait timeout) into a retryable 409 instead of a 500.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { AppError } from '../../../middleware/error-handler.js';
import type { PrismaTransactionClient } from './types.js';

const DEFAULT_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** Postgres SQLSTATEs that mean "another transaction got in the way". */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01', '55P03']);

function isLockConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true; // write conflict / deadlock
    if (error.code === 'P2010') {
      const sqlState = (error.meta as { code?: string } | undefined)?.code;
      return sqlState !== undefined && RETRYABLE_SQLSTATES.has(sqlState);
    }
  }
  return false;
}

export async function smsTransaction<T>(
  fn: (tx: PrismaTransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  try {
    return await prisma.$transaction(fn, { ...DEFAULT_OPTIONS, ...options });
  } catch (error) {
    if (isLockConflict(error)) {
      throw new AppError(
        409,
        'SMS_CONCURRENT_UPDATE',
        'Someone else updated the same unit at the same time. Please try again.',
      );
    }
    throw error;
  }
}
