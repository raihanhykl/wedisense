/**
 * App-level security-header regression test (Phase 16 Tier 4).
 *
 * Helmet's defaults are mostly good, but a few directives were tightened
 * for this project — frame-ancestors 'none', HSTS production-only,
 * Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options DENY,
 * and CORP cross-origin on /uploads. A future refactor could quietly
 * revert one of those (e.g., somebody bumps Helmet and accepts the new
 * default) and we'd ship the regression without noticing.
 *
 * This test pins the headers we care about. It doesn't try to enumerate
 * every header Helmet sends — only the ones we deliberately configured.
 *
 * We mock the modules that would otherwise try to phone home (Redis for
 * BullMQ queues + rate limiter) so the test can run in CI without a live
 * Redis instance.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('./lib/redis.js', () => ({
  redis: { call: vi.fn(), on: vi.fn() },
}));

// Queue module instantiates BullMQ Queue + Worker objects at import time.
// We replace it with no-op shells; the headers test never enqueues anything.
vi.mock('./lib/queue.js', () => ({
  warrantyCheckQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  loanOverdueQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  maintenanceDueQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  depreciationQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  weeklySummaryQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  tourSyncQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  reportGenerateQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  printGenerateQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  importProcessQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() },
  bootstrapSchedulers: vi.fn(),
}));

// Bypass the Redis-backed rate limiter — it loads a Lua script via
// SCRIPT LOAD at first hit, and faking the full ioredis reply contract
// is a rabbit hole. The factory's own tests in `lib/rate-limiter.test.ts`
// cover that surface; here we just need a passthrough middleware so
// the real Helmet config still runs.
vi.mock('./lib/rate-limiter.js', () => ({
  createRateLimiter: () =>
    (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from './app.js';

describe('Security headers (Phase 16 Tier 4)', () => {
  describe('on every API response', () => {
    it('sets CSP frame-ancestors to "none" (no framing, including same-origin)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('sets X-Frame-Options to DENY (older-browser counterpart to frame-ancestors)', async () => {
      const res = await request(app).get('/api/health');
      // Some Express + Supertest combos lowercase the response header name;
      // the value should still be DENY exactly (not SAMEORIGIN).
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('sets Referrer-Policy to strict-origin-when-cross-origin', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('does NOT set HSTS in development (NODE_ENV !== production)', async () => {
      // Localhost http:// gets force-upgraded to https:// once HSTS is in
      // the browser's cache, which is a pain for every dev who didn't see
      // it coming. Production-only is the right call.
      const res = await request(app).get('/api/health');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    it('declares CSP connect-src so error pages can fetch back to themselves', async () => {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toMatch(/connect-src[^;]*\bself\b/);
    });

    it('disables dangerous defaults — object-src is "none" and base-uri is locked to "self"', async () => {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
    });
  });

  // The /uploads/* CORP override (cross-origin) and the JSON-endpoint
  // CORP default (same-origin) are NOT covered here:
  //
  //   - express.static only runs its `setHeaders` callback on requests
  //     that actually return a file. We can't predict which barcode
  //     files exist in test environments, and writing to the uploads
  //     directory from a test makes the suite filesystem-fragile.
  //   - The behaviour is exercised by the Tier 4 development smoke
  //     (curl -I /uploads/barcodes/<png>) and by the production
  //     frontend successfully `<img>`-loading these resources.
  //
  // If a future regression turns CORP back to same-origin on /uploads,
  // every barcode image on the asset list will silently break in
  // browsers that enforce CORP — caught by the visual smoke, not by
  // this suite.
});
