/**
 * Audit-coverage contract test.
 *
 * Verifies that the static MUTATING_ENDPOINTS inventory matches the actual
 * mutating routes defined in `apps/api/src/modules/*` and that every entry
 * marked `audited: true` has audit-write code in the named service module.
 *
 * Why static analysis instead of HTTP-level integration tests:
 *
 *  - Express's `_router.stack` is an undocumented internal; walking it
 *    breaks across versions and the regex-based mount-path extraction is
 *    fragile. Reading the source files is stable and explainable.
 *  - Setting up auth + valid request bodies for 50+ endpoints to exercise
 *    them through Supertest would be ~2000 lines of brittle plumbing for
 *    little additional confidence — module-level router tests already
 *    cover the runtime behaviour for the modules that matter most
 *    (tours/router.test.ts is the template).
 *
 * The trade-off: a developer can add a `// auditLog.create(...)` comment
 * and the grep-based detector will count it. Acceptable — comments rarely
 * look like working calls, and the test is meant to catch REMOVAL of audit
 * logic, not bypass attempts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MUTATING_ENDPOINTS, normalisePath } from './audit-inventory.js';

// ── Path resolution ─────────────────────────────────────────────────────────
// Vitest runs with cwd = `apps/api` per the project's pnpm scripts (see
// `apps/api/package.json` test script). We resolve module paths off cwd so
// the test stays portable across IDE runners that may set cwd differently.
// (We deliberately don't use `import.meta.url` because the API tsconfig
// targets CommonJS for now and rejects the meta-property.)
const modulesDir = resolve(process.cwd(), 'src/modules');

/**
 * Mount paths declared in app.ts. When a new router is mounted, add it here.
 * The audit-coverage test will fail loudly until then — that's the point.
 */
const ROUTER_MOUNTS: Record<string, { mount: string; file: string }> = {
  auth: { mount: '/api/auth', file: 'auth/router.ts' },
  users: { mount: '/api/users', file: 'users/router.ts' },
  roles: { mount: '/api/roles', file: 'roles/router.ts' },
  locations: { mount: '/api/locations', file: 'locations/router.ts' },
  'locations-import': { mount: '/api/locations/import', file: 'locations/import-router.ts' },
  products: { mount: '/api/products', file: 'products/router.ts' },
  'asset-categories': { mount: '/api/asset-categories', file: 'asset-categories/router.ts' },
  assets: { mount: '/api/assets', file: 'assets/router.ts' },
  'assets-import': { mount: '/api/assets/import', file: 'assets/import-router.ts' },
  movements: { mount: '/api/movements', file: 'movements/router.ts' },
  maintenance: { mount: '/api/maintenance', file: 'maintenance/router.ts' },
  // labels router mounts at /api (not /api/labels) — its internal paths
  // are /label-templates/* and /print-jobs/* which join to /api/label-templates/*.
  labels: { mount: '/api', file: 'labels/router.ts' },
  notifications: { mount: '/api/notifications', file: 'notifications/router.ts' },
  reports: { mount: '/api/reports', file: 'reports/router.ts' },
  tours: { mount: '/api/tours', file: 'tours/router.ts' },
  'saved-views': { mount: '/api/saved-views', file: 'saved-views/router.ts' },
  // Audit module exposes GET-only endpoints (list/detail/export). It still
  // belongs in the scan: if a future change introduces a mutating endpoint
  // here, the completeness check forces an inventory entry.
  audit: { mount: '/api/audit-logs', file: 'audit/router.ts' },
};

interface DiscoveredRoute {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  source: string; // module key
}

/**
 * Extract every router.post/put/patch/delete declaration from a router source
 * file. We use a focused regex rather than a TypeScript AST because the
 * pattern is dead-simple in this codebase (no dynamic paths, no router
 * factories) and a regex is faster + has no compile-time dependency.
 */
function extractRoutes(source: string, mount: string, key: string): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];
  // Matches: router.post('/path' ... or router.put("/path" ... or with backticks.
  const re = /\brouter\.(post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const method = match[1]!.toUpperCase() as DiscoveredRoute['method'];
    const subPath = match[3]!;
    const joined = joinPath(mount, subPath);
    found.push({ method, path: joined, source: key });
  }
  return found;
}

/** Join a router mount with a sub-path, normalising slashes. `/` sub-path
 *  collapses to just the mount. */
function joinPath(mount: string, subPath: string): string {
  if (!subPath || subPath === '/') return mount || '/';
  const left = mount.endsWith('/') ? mount.slice(0, -1) : mount;
  const right = subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `${left}${right}`;
}

/** Read a router file relative to apps/api/src/modules. */
function loadRouter(key: string): string {
  const config = ROUTER_MOUNTS[key];
  if (!config) throw new Error(`Unknown router key: ${key}`);
  return readFileSync(resolve(modulesDir, config.file), 'utf8');
}

/** Build the full discovered-route list by walking every mounted router. */
function discoverAllRoutes(): DiscoveredRoute[] {
  const all: DiscoveredRoute[] = [];
  for (const [key, config] of Object.entries(ROUTER_MOUNTS)) {
    const source = loadRouter(key);
    all.push(...extractRoutes(source, config.mount, key));
  }
  return all;
}

/**
 * Verify that the named service module contains evidence of an audit-log
 * write. Accepts several established call patterns in the codebase:
 *
 *   prisma.auditLog.create({...})           — direct write
 *   tx.auditLog.create({...})               — inside $transaction
 *   repo.createAuditLogInTransaction(...)   — repository helper (movements, maintenance)
 *   createAuditLog(...)                     — module-local helper (movements)
 *
 * The check is `>= 1 occurrence`. We do NOT count exact matches per route
 * because some routes audit through shared helpers — counting individual
 * routes would require AST-level call-graph analysis, which is overkill for
 * a regression detector.
 */
function moduleHasAuditWrite(serviceModule: string): boolean {
  const candidatePaths = [
    `${serviceModule}/service.ts`,
    `${serviceModule}/repository.ts`,
    // movements + assets have multi-file services; audit pattern may live in either
    `${serviceModule}/import-service.ts`,
  ];
  for (const rel of candidatePaths) {
    const abs = resolve(modulesDir, rel);
    let source: string;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (
      /\bauditLog\.create\b/.test(source) ||
      /\btx\.auditLog\.create\b/.test(source) ||
      /\bcreateAuditLogInTransaction\b/.test(source) ||
      /\bcreateAuditLog\s*\(/.test(source)
    ) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Audit coverage contract', () => {
  const discovered = discoverAllRoutes();

  describe('Completeness: every discovered route is inventoried', () => {
    it('every router.post/put/patch/delete in source has a matching inventory entry', () => {
      const inventoryKeys = new Set(
        MUTATING_ENDPOINTS.map((e) => `${e.method} ${normalisePath(e.path)}`),
      );
      const missing: string[] = [];
      for (const route of discovered) {
        const key = `${route.method} ${normalisePath(route.path)}`;
        if (!inventoryKeys.has(key)) {
          missing.push(`${key}  (from ${route.source})`);
        }
      }
      expect(
        missing,
        `New mutating route(s) without inventory entry. Add them to audit-inventory.ts:\n  - ${missing.join('\n  - ')}`,
      ).toEqual([]);
    });

    it('every inventory entry maps to a real route in source', () => {
      const discoveredKeys = new Set(
        discovered.map((r) => `${r.method} ${normalisePath(r.path)}`),
      );
      const stale: string[] = [];
      for (const entry of MUTATING_ENDPOINTS) {
        const key = `${entry.method} ${normalisePath(entry.path)}`;
        if (!discoveredKeys.has(key)) {
          stale.push(key);
        }
      }
      expect(
        stale,
        `Stale inventory entry — route no longer exists in source. Remove from audit-inventory.ts:\n  - ${stale.join('\n  - ')}`,
      ).toEqual([]);
    });
  });

  describe('Audit-present: every audited:true entry has audit-write code', () => {
    // Group by service module so a single test failure tells you which
    // module needs investigation, not "N entries failed".
    const audited = MUTATING_ENDPOINTS.filter(
      (e): e is typeof e & { decision: { audited: true; serviceModule: string } } =>
        e.decision.audited,
    );
    const byModule = new Map<string, typeof audited>();
    for (const entry of audited) {
      const mod = entry.decision.serviceModule;
      const existing = byModule.get(mod) ?? [];
      existing.push(entry);
      byModule.set(mod, existing);
    }

    for (const [module, entries] of byModule) {
      it(`module '${module}' contains audit-log write patterns (${entries.length} route(s))`, () => {
        expect(
          moduleHasAuditWrite(module),
          `Module '${module}' has no auditLog.create / createAuditLog calls in its service or repository. The following routes expect audit:\n  - ${entries
            .map((e) => `${e.method} ${e.path}`)
            .join('\n  - ')}`,
        ).toBe(true);
      });
    }
  });

  describe('Skipped entries: every audited:false entry has a written reason', () => {
    // Narrow to the discriminant `audited: false` once so the loop body
    // can access `reason` without TypeScript losing the union arm.
    const skipped = MUTATING_ENDPOINTS.filter(
      (e): e is typeof e & { decision: { audited: false; reason: string } } =>
        !e.decision.audited,
    );
    for (const entry of skipped) {
      it(`${entry.method} ${entry.path} explains why audit is skipped`, () => {
        expect(
          entry.decision.reason.trim().length,
          `Skipped audit needs a reason of meaningful length`,
        ).toBeGreaterThan(20);
      });
    }
  });
});
