/**
 * Unit tests for the rate-limiter factory.
 *
 * We can't realistically test "the 11th request gets 429" without
 * spinning up Redis + Express + Supertest, and that turns into an
 * integration test that the smoke checklist already covers. What this
 * file pins down is the shape of the wired middleware: factory returns
 * something callable as `(req, res, next)`, the Redis prefix is
 * threaded through correctly, and the call site has access to the
 * config it asked for.
 *
 * We mock both `express-rate-limit` and `rate-limit-redis` so the test
 * runs without a Redis connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRateLimit = vi.fn();
const mockRedisStore = vi.fn();

vi.mock('express-rate-limit', () => ({
  default: (opts: unknown) => {
    mockRateLimit(opts);
    // Return a stand-in middleware so the factory contract holds.
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

vi.mock('rate-limit-redis', () => ({
  RedisStore: vi.fn().mockImplementation((opts: unknown) => {
    mockRedisStore(opts);
    return { type: 'mock-redis-store' };
  }),
}));

vi.mock('./redis.js', () => ({
  redis: { call: vi.fn() },
}));

import { createRateLimiter } from './rate-limiter.js';

beforeEach(() => {
  mockRateLimit.mockClear();
  mockRedisStore.mockClear();
});

describe('createRateLimiter()', () => {
  it('returns a callable middleware', () => {
    const middleware = createRateLimiter({
      windowMs: 60_000,
      max: 100,
      prefix: 'rl:test',
    });
    expect(typeof middleware).toBe('function');
    // Standard Express middleware signature: (req, res, next)
    expect(middleware.length).toBeGreaterThanOrEqual(2);
  });

  it('forwards windowMs and max to express-rate-limit', () => {
    createRateLimiter({ windowMs: 5_000, max: 7, prefix: 'rl:test' });
    const config = mockRateLimit.mock.calls[0]?.[0] as {
      windowMs: number;
      max: number;
      standardHeaders: boolean;
      legacyHeaders: boolean;
    };
    expect(config.windowMs).toBe(5_000);
    expect(config.max).toBe(7);
    // Standard headers on, legacy off — verified once across the factory
    // so individual call sites don't have to re-assert.
    expect(config.standardHeaders).toBe(true);
    expect(config.legacyHeaders).toBe(false);
  });

  it('namespaces the Redis prefix with a trailing colon', () => {
    createRateLimiter({ windowMs: 60_000, max: 10, prefix: 'rl:auth' });
    const storeConfig = mockRedisStore.mock.calls[0]?.[0] as {
      prefix: string;
      sendCommand: (...args: string[]) => unknown;
    };
    // The trailing colon is rate-limit-redis convention — keys become
    // `rl:auth:<windowStart>:<ip>`. Without the trailing colon they'd
    // concatenate ugly.
    expect(storeConfig.prefix).toBe('rl:auth:');
    // sendCommand wraps redis.call — should be a function, not undefined
    expect(typeof storeConfig.sendCommand).toBe('function');
  });

  it('isolates different limiters via distinct prefixes', () => {
    createRateLimiter({ windowMs: 60_000, max: 100, prefix: 'rl:general' });
    createRateLimiter({ windowMs: 60_000, max: 10, prefix: 'rl:auth' });
    const prefixes = mockRedisStore.mock.calls.map(
      (call) => (call[0] as { prefix: string }).prefix,
    );
    expect(prefixes).toEqual(['rl:general:', 'rl:auth:']);
  });
});
