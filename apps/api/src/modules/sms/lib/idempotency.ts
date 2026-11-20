/**
 * Exactly-once recording for SMS mutations.
 *
 * The web client mints a UUID when a form opens and sends it as the
 * `Idempotency-Key` header with the mutation. The key row is written in the
 * SAME transaction as the mutation, which gives three guarantees:
 *
 *  - double click / retry after a dropped connection → the stored response is
 *    replayed and nothing is recorded twice;
 *  - two identical requests racing each other → the second one blocks on the
 *    key's unique index until the first commits, then replays its response;
 *  - a failed mutation rolls its key back, so the same key can be retried.
 *
 * Reusing a key for a different operation or payload is rejected: it almost
 * always means a client bug, and replaying an unrelated response would be
 * silently wrong.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { SMS_IDEMPOTENCY_HEADER } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import { smsTransaction } from './transaction.js';
import type { PrismaTransactionClient } from './types.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Read and validate the `Idempotency-Key` header of a mutating request. */
export function requireIdempotencyKey(req: Request): string {
  const key = req.header(SMS_IDEMPOTENCY_HEADER)?.trim();
  if (!key) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'This action requires an Idempotency-Key header.',
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'The Idempotency-Key header is malformed.');
  }
  return key;
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/** JSON with object keys sorted, so equal payloads always hash the same. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export interface IdempotentOptions {
  key: string;
  userId: string;
  /** Stable operation name, e.g. `shipments.receive-line`. */
  operation: string;
  /** Everything that defines the request (route params + body). */
  payload: unknown;
  /** HTTP status of a first-time success. Defaults to 200. */
  statusCode?: number;
  transaction?: { maxWait?: number; timeout?: number };
}

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  /** True when the response came from an earlier identical request. */
  replayed: boolean;
}

/**
 * Run `fn` inside an SMS transaction, at most once per key.
 *
 * `fn` must do all of its writes through the supplied `tx`. Its return value
 * becomes the response body and is stored as JSON, so the replayed response
 * is byte-for-byte what the first caller received.
 */
export async function runIdempotent<T>(
  options: IdempotentOptions,
  fn: (tx: PrismaTransactionClient) => Promise<T>,
): Promise<IdempotentResult<T>> {
  const statusCode = options.statusCode ?? 200;
  const requestHash = hashPayload(options.payload);

  return smsTransaction(async (tx) => {
    // Claim the key. A concurrent transaction holding the same key makes this
    // statement wait until that transaction ends.
    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO sms_idempotency_keys (id, key, user_id, operation, request_hash, status_code, response)
      VALUES (gen_random_uuid(), ${options.key}, ${options.userId}::uuid, ${options.operation},
              ${requestHash}, ${statusCode}, 'null'::jsonb)
      ON CONFLICT (key) DO NOTHING
      RETURNING id::text AS id
    `;

    if (claimed.length === 0) {
      const existing = await tx.smsIdempotencyKey.findUnique({ where: { key: options.key } });
      if (
        !existing ||
        existing.userId !== options.userId ||
        existing.operation !== options.operation ||
        existing.requestHash !== requestHash
      ) {
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request.',
        );
      }
      return { statusCode: existing.statusCode, body: existing.response as T, replayed: true };
    }

    const result = await fn(tx);
    // Store exactly what the client will receive (dates as ISO strings, …).
    const body = JSON.parse(JSON.stringify(result ?? null)) as T;
    await tx.smsIdempotencyKey.update({
      where: { key: options.key },
      data: { response: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
    return { statusCode, body, replayed: false };
  }, options.transaction);
}
