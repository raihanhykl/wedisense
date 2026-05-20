/**
 * Redis-backed rate-limiter factory.
 *
 * Express-rate-limit ships with an in-memory store. That's fine on a
 * single-instance dev box but useless behind a load balancer: each Node
 * process counts independently, so a 100/min limit becomes 100*N/min in
 * production. We back the counters with Redis so the limit is correct
 * across every replica that talks to the same Redis we already run for
 * BullMQ.
 *
 * Failure mode: if Redis is unreachable, the store throws and the request
 * is **rejected** (default `passOnStoreError: false`). We prefer
 * fail-closed over fail-open here — letting unlimited traffic through
 * during a Redis outage would be worse than returning 429 for a brief
 * window. Redis is already a hard dependency for BullMQ; if it's down the
 * jobs queue is also broken, and the app is degraded anyway.
 *
 * Each limiter passes a `prefix` that becomes the Redis key namespace
 * (`rl:general:127.0.0.1:abc`). Keep prefixes distinct per limiter so
 * counters don't bleed across tiers — a heavy general user shouldn't
 * accidentally exhaust the auth tier's quota.
 */
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './redis.js';

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests per IP per window before we 429. */
  max: number;
  /**
   * Redis key namespace. Pick something descriptive and stable so the
   * counters survive a deploy (the key namespace is observable via
   * `redis-cli KEYS 'rl:*'` for debugging). Avoid colons inside the
   * prefix itself — ioredis tolerates them but it muddies key inspection.
   */
  prefix: string;
}

/**
 * Build an Express middleware that rate-limits requests by IP using a
 * Redis-backed counter. Call sites that need the same limit (e.g. login
 * + refresh in the auth router) should share a single returned middleware
 * so they share the counter; the prefix decides isolation between tiers.
 */
export function createRateLimiter(
  options: RateLimiterOptions,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    // The RedisStore signature passes commands through `sendCommand`. ioredis
    // exposes the same surface via `.call(...)`. The static types don't line
    // up cleanly — RedisStore declares `RedisReply = boolean|number|string|Data[]`
    // whereas ioredis returns `unknown` (and at runtime can return null for
    // missing keys). The runtime behaviour is correct: rate-limit-redis handles
    // null/undefined replies internally. We cast through `unknown` at the
    // boundary so the type bridge stays localised here rather than leaking
    // into the rest of the codebase.
    store: new RedisStore({
      sendCommand: ((...args: string[]) =>
        redis.call(...(args as [string, ...string[]]))) as unknown as (
        ...args: string[]
      ) => Promise<string | number | boolean | (string | number | boolean)[]>,
      prefix: `${options.prefix}:`,
    }),
  });
}
