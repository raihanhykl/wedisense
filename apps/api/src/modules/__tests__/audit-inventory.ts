/**
 * Mutating-endpoint inventory + audit-coverage contract.
 *
 * Single source of truth for "does this mutating endpoint produce an audit
 * log entry?". The companion test (`audit-coverage.test.ts`):
 *
 * 1. Extracts every POST/PUT/PATCH/DELETE route from the live Express app.
 * 2. Verifies each one appears in this inventory (no rogue endpoints).
 * 3. For every entry with `audited: true`, verifies the named service module
 *    contains at least one `auditLog.create` call (grep-based regression
 *    detector — catches accidental removal during refactors).
 *
 * When adding a new mutating route, append a matching entry here. The test
 * will fail until you do, which is the point: forcing the engineer to make
 * a conscious decision about whether the new endpoint needs audit.
 *
 * Why this shape over a full HTTP-level coverage test:
 *  - Setting up Supertest + auth context + valid bodies for ~60 endpoints
 *    is ~2000 lines of test plumbing for diminishing returns.
 *  - The static contract catches the regressions that matter (audit removed,
 *    new endpoint forgotten) without the brittleness of full request setup.
 *  - Individual modules already have HTTP-level tests for their own audit
 *    behaviour (e.g. tours/router.test.ts).
 */

export type AuditDecision =
  | { audited: true; serviceModule: string }
  | { audited: false; reason: string };

export interface MutatingEndpoint {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Free-form module label, just for grouping in test output. */
  module: string;
  decision: AuditDecision;
}

const audited = (serviceModule: string): AuditDecision => ({ audited: true, serviceModule });
const skipped = (reason: string): AuditDecision => ({ audited: false, reason });

export const MUTATING_ENDPOINTS: MutatingEndpoint[] = [
  // ── auth ────────────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/auth/login',
    module: 'auth',
    decision: audited('auth'),
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    module: 'auth',
    decision: audited('auth'),
  },
  {
    method: 'POST',
    path: '/api/auth/refresh',
    module: 'auth',
    decision: skipped(
      'High-frequency token refresh; would flood the audit table. Failed/invalid refresh attempts are visible via the 401 response in normal access logs.',
    ),
  },
  {
    method: 'PUT',
    path: '/api/auth/change-password',
    module: 'auth',
    decision: audited('auth'),
  },

  // ── users ───────────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/users', module: 'users', decision: audited('users') },
  { method: 'PUT', path: '/api/users/:id', module: 'users', decision: audited('users') },
  { method: 'DELETE', path: '/api/users/:id', module: 'users', decision: audited('users') },
  { method: 'PUT', path: '/api/users/:id/roles', module: 'users', decision: audited('users') },

  // ── roles ───────────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/roles', module: 'roles', decision: audited('roles') },
  { method: 'PUT', path: '/api/roles/:id', module: 'roles', decision: audited('roles') },
  { method: 'DELETE', path: '/api/roles/:id', module: 'roles', decision: audited('roles') },
  {
    method: 'PUT',
    path: '/api/roles/:id/permissions',
    module: 'roles',
    decision: audited('roles'),
  },

  // ── locations ───────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/locations', module: 'locations', decision: audited('locations') },
  {
    method: 'PUT',
    path: '/api/locations/:id',
    module: 'locations',
    decision: audited('locations'),
  },
  {
    method: 'DELETE',
    path: '/api/locations/:id',
    module: 'locations',
    decision: audited('locations'),
  },

  // ── products ────────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/products/lookup',
    module: 'products',
    decision: skipped(
      'EAN cache fill via external API. The new product row is a derivative of public data, not a user-driven mutation. Subsequent edits via PUT /api/products/:id are audited.',
    ),
  },
  { method: 'POST', path: '/api/products', module: 'products', decision: audited('products') },
  { method: 'PUT', path: '/api/products/:id', module: 'products', decision: audited('products') },

  // ── asset-categories ────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/asset-categories',
    module: 'asset-categories',
    decision: audited('asset-categories'),
  },
  {
    method: 'PUT',
    path: '/api/asset-categories/:id',
    module: 'asset-categories',
    decision: audited('asset-categories'),
  },
  {
    method: 'DELETE',
    path: '/api/asset-categories/:id',
    module: 'asset-categories',
    decision: audited('asset-categories'),
  },

  // ── assets (main) ───────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/assets', module: 'assets', decision: audited('assets') },
  { method: 'POST', path: '/api/assets/bulk', module: 'assets', decision: audited('assets') },
  {
    method: 'POST',
    path: '/api/assets/bulk-move-location',
    module: 'assets',
    decision: audited('assets'),
  },
  {
    method: 'POST',
    path: '/api/assets/bulk-assign-user',
    module: 'assets',
    decision: audited('assets'),
  },
  {
    method: 'POST',
    path: '/api/assets/bulk-change-condition',
    module: 'assets',
    decision: audited('assets'),
  },
  {
    method: 'POST',
    path: '/api/assets/bulk-delete',
    module: 'assets',
    decision: audited('assets'),
  },
  { method: 'PUT', path: '/api/assets/:id', module: 'assets', decision: audited('assets') },
  { method: 'DELETE', path: '/api/assets/:id', module: 'assets', decision: audited('assets') },

  // ── assets/import ───────────────────────────────────────────────────────────
  // Note: the upload endpoint itself only stages work — it either previews
  // (sync) or queues a job (async). The actual asset writes happen in
  // POST /confirm (sync path) or the import-process job (async path), and
  // both go through bulkImport() which audits each created asset.
  {
    method: 'POST',
    path: '/api/assets/import',
    module: 'assets',
    decision: skipped(
      'Upload stages an Excel file. Sync path returns preview only (no writes); async path queues a job. The bulkImport() that eventually runs audits each created asset.',
    ),
  },
  {
    method: 'POST',
    path: '/api/assets/import/revalidate-row',
    module: 'assets',
    decision: skipped('Pure validation; no DB writes.'),
  },
  {
    method: 'POST',
    path: '/api/assets/import/errors-report.xlsx',
    module: 'assets',
    decision: skipped('Artifact download; no DB writes.'),
  },
  {
    method: 'POST',
    path: '/api/assets/import/confirm',
    module: 'assets',
    decision: audited('assets'),
  },

  // ── movements ───────────────────────────────────────────────────────────────
  // createMovement dispatches to per-type handlers (handleAssignment, etc.)
  // which all call repo.createAuditLogInTransaction. The literal string
  // `auditLog.create` doesn't appear in service.ts because the helper hides
  // it — the grep regex below covers both `auditLog.create` and `createAuditLog`.
  { method: 'POST', path: '/api/movements', module: 'movements', decision: audited('movements') },
  {
    method: 'PUT',
    path: '/api/movements/:id/approve',
    module: 'movements',
    decision: audited('movements'),
  },
  {
    method: 'PUT',
    path: '/api/movements/:id/reject',
    module: 'movements',
    decision: audited('movements'),
  },
  {
    method: 'PUT',
    path: '/api/movements/:id/complete',
    module: 'movements',
    decision: audited('movements'),
  },

  // ── maintenance ─────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/maintenance/schedules',
    module: 'maintenance',
    decision: audited('maintenance'),
  },
  {
    method: 'PUT',
    path: '/api/maintenance/schedules/:id',
    module: 'maintenance',
    decision: audited('maintenance'),
  },
  {
    method: 'DELETE',
    path: '/api/maintenance/schedules/:id',
    module: 'maintenance',
    decision: audited('maintenance'),
  },
  {
    method: 'POST',
    path: '/api/maintenance/logs',
    module: 'maintenance',
    decision: audited('maintenance'),
  },

  // ── labels / print-jobs ─────────────────────────────────────────────────────
  // The label router mounts at /api (not /api/labels) so the print-job paths
  // sit under /api/print-jobs.
  {
    method: 'POST',
    path: '/api/label-templates',
    module: 'labels',
    decision: audited('labels'),
  },
  {
    method: 'PUT',
    path: '/api/label-templates/:id',
    module: 'labels',
    decision: audited('labels'),
  },
  {
    method: 'DELETE',
    path: '/api/label-templates/:id',
    module: 'labels',
    decision: audited('labels'),
  },
  {
    method: 'POST',
    path: '/api/label-templates/:id/preview',
    module: 'labels',
    decision: skipped('Artifact download (preview PDF); no DB writes.'),
  },
  {
    method: 'POST',
    path: '/api/print-jobs',
    module: 'labels',
    decision: audited('labels'),
  },

  // ── notifications ───────────────────────────────────────────────────────────
  {
    method: 'PUT',
    path: '/api/notifications/read-all',
    module: 'notifications',
    decision: skipped(
      'User flipping read flags on their own notifications. High-frequency, low compliance value — would flood the audit table.',
    ),
  },
  {
    method: 'PUT',
    path: '/api/notifications/:id/read',
    module: 'notifications',
    decision: skipped(
      'User flipping read flag on their own notification. Same rationale as /read-all.',
    ),
  },
  {
    method: 'POST',
    path: '/api/notifications/_dev/trigger/:jobName',
    module: 'notifications',
    decision: skipped('Dev-only — guarded against production at the handler.'),
  },

  // ── reports ─────────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/reports', module: 'reports', decision: audited('reports') },
  { method: 'PUT', path: '/api/reports/:id', module: 'reports', decision: audited('reports') },
  {
    method: 'DELETE',
    path: '/api/reports/:id',
    module: 'reports',
    decision: audited('reports'),
  },
  {
    method: 'POST',
    path: '/api/reports/:id/generate',
    module: 'reports',
    decision: audited('reports'),
  },

  // ── tours ───────────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/tours', module: 'tours', decision: audited('tours') },
  { method: 'PUT', path: '/api/tours/:id', module: 'tours', decision: audited('tours') },
  { method: 'DELETE', path: '/api/tours/:id', module: 'tours', decision: audited('tours') },
  {
    method: 'PUT',
    path: '/api/tours/:id/progress',
    module: 'tours',
    decision: skipped(
      'Per-step tutorial progress; fires on every Next/Prev click. High-frequency, low compliance value. The /restart endpoint IS audited as the meaningful user action.',
    ),
  },
  {
    method: 'PUT',
    path: '/api/tours/:id/restart',
    module: 'tours',
    decision: audited('tours'),
  },
  {
    method: 'POST',
    path: '/api/tours/:id/sync',
    module: 'tours',
    decision: audited('tours'),
  },

  // ── saved-views ─────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/saved-views',
    module: 'saved-views',
    decision: skipped(
      "Per-user list-page UI preferences. The view config is the user's own client-side state stored server-side for cross-device sync; it doesn't touch business data.",
    ),
  },
  {
    method: 'PUT',
    path: '/api/saved-views/:id',
    module: 'saved-views',
    decision: skipped("Per-user UI preference (same rationale as POST)."),
  },
  {
    method: 'DELETE',
    path: '/api/saved-views/:id',
    module: 'saved-views',
    decision: skipped("Per-user UI preference (same rationale as POST)."),
  },
];

/**
 * Express normalises param tokens (`:id`) into a position-independent shape
 * when registered. We compare on the *literal* path string in inventory; the
 * coverage test does the same normalisation for the live app's stack so
 * the two sides line up regardless of `:id` vs `:userId`.
 */
export function normalisePath(p: string): string {
  return p.replace(/:[A-Za-z0-9_]+/g, ':param');
}
