# Phase 16 — Audit Trail & Security Hardening: Development Plan

> Branch: `phase-16/audit-security`
> Status: planning · awaiting approval
> Last updated: 2026-05-20

---

## 1. Goals

End-state Phase 16 selesai berarti:

1. Setiap endpoint POST/PUT/DELETE menulis `audit_logs` (verified by automated coverage test). Existing inline pattern dipertahankan; gap apa pun ditutup.
2. SUPER_ADMIN + ADMIN bisa lihat `/admin/audit` — paginated table dengan filter (user, action, resource_type, date range), detail drawer dengan old/new diff readable, export CSV current filter.
3. Rate limiting Redis-backed: 100 req/min general + 10 req/min khusus `/api/auth/login` + `/api/auth/refresh`. Multi-instance safe.
4. Helmet ditune: CSP dengan whitelist explicit (allow `/uploads/*` images, `font.googleapis.com`, dll), HSTS production-only, Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options deny.
5. File upload (`/api/assets/import`) verify magic bytes — bukan cuma trust `Content-Type` header. Filename sanitisation (path traversal). SVG `<script>` blocked.
6. Transaction coverage cross-codebase: scan semua multi-table writes, verify `prisma.$transaction()` digunakan. Issues di-fix di tier ini.
7. Tests: backend audit endpoint, rate-limit behavior, upload hardening, audit coverage test — semua hijau di CI.

## 2. Architecture decisions (locked dari user)

| Keputusan | Pilihan | Reason |
|---|---|---|
| Audit pattern | **Inline + coverage test** | 18 callsites sudah inline; pakai middleware kehilangan transaction context & diff specificity |
| Audit viewer UI | **List + filter + detail drawer + CSV export** | Cukup untuk compliance audit; tidak overkill |
| Rate limit backend | **Redis-backed** (rate-limit-redis) | Production-ready multi-instance; Redis sudah jalan untuk BullMQ |
| Soft-delete middleware | **Defer ke Phase 17** | Risiko regresi di banyak query; spec setuju ini di Phase 17 QA |
| Audit retention | **No-op untuk sekarang** | DB-level constraint sudah revoke UPDATE/DELETE; retention policy = ops concern, defer |
| Permission untuk `/admin/audit` | `audit:read` | Sudah di-seed (SUPER_ADMIN + ADMIN) |

## 3. Tier structure

### Tier 1 — Audit coverage verification + gap closure

**Goal:** Setiap mutating endpoint terbukti menulis audit log. Bukti = test otomatis yang akan re-run di CI.

**Approach:**
1. Inventarisir semua route POST/PUT/DELETE dari `apps/api/src/modules/*/router.ts`.
2. Cross-reference dengan callsites `auditLog.create` di tiap module's `service.ts`.
3. Flag missing audit untuk fix.
4. Tulis Vitest coverage test yang:
   - Mock prisma
   - Call setiap mutating endpoint sequentially
   - Assert `prisma.auditLog.create` (or transaction equivalent) terpanggil ≥1x

**Files baru:**
- `apps/api/src/modules/__tests__/audit-coverage.test.ts` — single source of truth for "every mutating route audits"
- `docs/conventions/audit-pattern.md` — short doc menjelaskan inline pattern + invariants

**Files modified (kalau ada gap):**
- Service files yang kedapatan gap audit-nya

**Verification:**
- `pnpm --filter api test` — coverage test pass
- Manual review: total `auditLog.create` calls match expected mutating endpoint count

**Est:** 0.5 day

### Tier 2 — Audit log API + viewer UI

**Goal:** Admin bisa search, filter, drilldown audit history.

**Backend (`apps/api/src/modules/audit/`)**:
- `router.ts`:
  - `GET /api/audit-logs` — paginated, query params: `userId`, `action` (CREATE/UPDATE/DELETE/LOGIN/LOGOUT/EXPORT/IMPORT/PRINT/APPROVE/REJECT), `resourceType`, `resourceId`, `dateFrom`, `dateTo`, `search`. Permission gate `audit:read`.
  - `GET /api/audit-logs/:id` — single entry with full old/new JSON.
  - `GET /api/audit-logs/export` — streams CSV of current filter (no pagination, capped at 50k rows to prevent OOM).
- `service.ts`:
  - `listAuditLogs(filters, pagination)` — Prisma query with composite index hint usage
  - `getAuditLogById(id)`
  - `streamAuditLogsCsv(filters, response)` — uses Node stream + papaparse-style row writer
- `repository.ts` — Prisma queries
- `schema.ts` — Zod validation for query params
- `types.ts` — `AuditLogDto`

**Backend (mount):**
- `apps/api/src/app.ts` — `app.use('/api/audit-logs', authenticate, auditRouter)`

**Frontend (`apps/web/src/app/admin/audit/`)**:
- `page.tsx` — table dengan filter bar (search, action select, resourceType select, date range, user picker). Detail drawer slides in from right on row click.
- `audit-detail-drawer.tsx` (component) — renders old_values & new_values side-by-side as syntax-highlighted JSON. Diff lines marked.
- `audit-filter-bar.tsx` (component) — encapsulates filter state.
- `apps/web/src/components/shared/app-sidebar.tsx` — add "Audit" nav item gated `audit:read`.
- `apps/web/src/types/admin.ts` — `AuditLogDto` type

**CSV export:**
- Frontend triggers `window.open('/api/audit-logs/export?...filters')` → browser handles download.
- Backend streams chunks, sets `Content-Type: text/csv` + `Content-Disposition: attachment; filename="audit-{date}.csv"`.

**UI/UX:**
- Table columns: timestamp, user (name + email), action (badge color per action), resourceType, resourceId (clickable → opens detail), IP, user-agent (truncated)
- Detail drawer width 480px, slide animation 200ms ease-out
- JSON diff render: gray for unchanged keys, green for new, red for removed/changed
- Empty state: "No audit logs match these filters"
- Mobile: filter bar collapses to drawer, table → cards stacked

**Verification:**
- Manual: navigate /admin/audit as superadmin → filter by `action=UPDATE` → expect rows; click row → drawer opens with diff
- Export CSV → opens in spreadsheet → columns formatted
- Backend test: `GET /api/audit-logs` returns 403 without `audit:read`, 200 with

**Est:** 2 days

### Tier 3 — Rate limit Redis-backed + auth tier

**Goal:** Production-grade rate limiting.

**Files modified:**
- `apps/api/package.json` — install `rate-limit-redis`
- `apps/api/src/lib/rate-limiter.ts` (CREATE) — factory yang return `RateLimitRequestHandler`:
  ```ts
  export function createRateLimiter(options: { windowMs: number; max: number; prefix: string }): RateLimitRequestHandler
  ```
  Uses `RedisStore` from `rate-limit-redis` with the shared `redis` client.
- `apps/api/src/app.ts`:
  - Replace inline `rateLimit({...})` with `createRateLimiter({ windowMs: RATE_LIMIT.GENERAL.windowMs, max: RATE_LIMIT.GENERAL.max, prefix: 'rl:general' })`
- `apps/api/src/modules/auth/router.ts`:
  - Apply stricter `createRateLimiter({ windowMs: RATE_LIMIT.AUTH.windowMs, max: RATE_LIMIT.AUTH.max, prefix: 'rl:auth' })` to login + refresh

**Existing constants (already in shared):**
- `RATE_LIMIT.GENERAL = { windowMs: 60_000, max: 100 }`
- `RATE_LIMIT.AUTH = { windowMs: 60_000, max: 10 }`

**Verification:**
- Manual: curl /api/auth/login 11x within 60s → 11th returns 429
- Manual: curl /api/health 101x → 101st returns 429
- Test: `apps/api/src/lib/rate-limiter.test.ts` — verify factory creates limiter with correct prefix; can mock redis

**Est:** 0.5 day

### Tier 4 — Helmet CSP/HSTS hardening

**Goal:** Browser security headers tightened to spec.

**Files modified:**
- `apps/api/src/app.ts`:
  ```ts
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],  // data: for inline barcodes, blob: for printed previews
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", process.env['CORS_ORIGIN'] ?? 'http://localhost:3000'],
        frameAncestors: ["'none'"],
      },
    },
    hsts: process.env['NODE_ENV'] === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,  // breaks Next.js images otherwise
  }));
  ```

**Verification:**
- Smoke: load /dashboard → no CSP violations in browser console
- curl -I /api/health → verify `Strict-Transport-Security`, `Referrer-Policy`, `Content-Security-Policy` present
- Lighthouse Best Practices ≥ 90

**Est:** 0.5 day

### Tier 5 — File upload hardening

**Goal:** Magic-bytes verification, path traversal, SVG safety.

**Files modified:**
- `apps/api/package.json` — install `file-type` (modern ESM, magic-byte detection)
- `apps/api/src/lib/upload-validator.ts` (CREATE):
  ```ts
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'];
  export async function validateUploadedFile(buffer: Buffer, declaredMime: string): Promise<{ valid: boolean; reason?: string; resolvedMime?: string }>;
  ```
  Uses `fileTypeFromBuffer` to detect actual MIME. Rejects if declared ≠ detected (with allowance for `text/csv` which has no magic bytes — fall back to declared).
- `apps/api/src/modules/assets/import-router.ts`:
  - After multer middleware, run `validateUploadedFile(req.file.buffer, req.file.mimetype)` before parsing.
  - 415 if invalid.
- `apps/api/src/lib/filename-sanitizer.ts` (CREATE):
  ```ts
  export function sanitizeFilename(input: string): string;  // strips path separators, control chars, normalize unicode
  ```
- Any code path that uses `file.originalname` to construct a path: route through sanitizer.

**SVG note:** We don't accept SVG uploads. If we ever add it, must strip `<script>` + `on*=""` attributes. Document explicit non-acceptance.

**Verification:**
- Test: upload .xlsx renamed to .png → backend detects magic bytes → 415
- Test: upload .pdf with declared MIME `image/jpeg` → 415
- Test: filename `../../../etc/passwd.xlsx` → sanitized to `etc_passwd.xlsx`

**Est:** 0.5 day

### Tier 6 — Transaction coverage scan

**Goal:** Cross-codebase scan for multi-table writes that should be in `prisma.$transaction()`.

**Approach:**
- Dispatch `code-reviewer` agent with focused prompt: scan all service files, find any function that writes to 2+ tables without `$transaction`, report findings.
- Fix any blockers/majors found.

**Files modified:** TBD based on findings. Suspect locations (from Phase 11 + 15 reviews):
- `apps/api/src/modules/tours/service.ts` — already fixed in Phase 15 Tier 9
- `apps/api/src/modules/movements/service.ts` — already wraps everything per existing code (verify)
- `apps/api/src/modules/assets/import-service.ts` — large operation, verify transaction boundaries

**Verification:**
- Reviewer agent reports zero blockers/majors
- Any fixes commit-able

**Est:** 0.5 day

### Tier 7 — Tests

Bundled per-tier above but consolidated here:

**Backend:**
- `apps/api/src/modules/audit/router.test.ts` — endpoint integration tests (auth 401, permission 403, filter parse 422, happy 200, CSV stream Content-Disposition)
- `apps/api/src/modules/audit/service.test.ts` — filter logic, pagination
- `apps/api/src/lib/rate-limiter.test.ts` — factory creates limiter with correct prefix
- `apps/api/src/lib/upload-validator.test.ts` — magic byte detection
- `apps/api/src/lib/filename-sanitizer.test.ts` — sanitization rules
- `apps/api/src/modules/__tests__/audit-coverage.test.ts` (Tier 1) — every mutating endpoint produces audit log

**Estimated test count:** ~30 new tests. Target total: 286/286 pass.

**Est:** 0.5 day (most tests are inline with tier work)

### Tier 8 — Review & merge

- Dispatch `code-reviewer` agent on full diff
- Dispatch `i18n-checker` (audit viewer UI strings)
- Address findings
- Merge PR ke `main`
- Write `docs/phases/phase-16-complete.md`

**Est:** 0.5 day

## 4. Files matrix (consolidated)

### Backend — CREATE
- `apps/api/src/lib/rate-limiter.ts`
- `apps/api/src/lib/rate-limiter.test.ts`
- `apps/api/src/lib/upload-validator.ts`
- `apps/api/src/lib/upload-validator.test.ts`
- `apps/api/src/lib/filename-sanitizer.ts`
- `apps/api/src/lib/filename-sanitizer.test.ts`
- `apps/api/src/modules/audit/router.ts`
- `apps/api/src/modules/audit/router.test.ts`
- `apps/api/src/modules/audit/service.ts`
- `apps/api/src/modules/audit/service.test.ts`
- `apps/api/src/modules/audit/repository.ts`
- `apps/api/src/modules/audit/schema.ts`
- `apps/api/src/modules/audit/types.ts`
- `apps/api/src/modules/__tests__/audit-coverage.test.ts`

### Backend — MODIFY
- `apps/api/src/app.ts` — mount audit router, replace rate limiter factory, harden helmet
- `apps/api/src/modules/auth/router.ts` — apply 10/min limiter to login + refresh
- `apps/api/src/modules/assets/import-router.ts` — magic byte validation + sanitised filename
- `apps/api/package.json` — install `rate-limit-redis`, `file-type`

### Frontend — CREATE
- `apps/web/src/app/admin/audit/page.tsx`
- `apps/web/src/components/shared/audit-detail-drawer.tsx`
- `apps/web/src/components/shared/audit-filter-bar.tsx`

### Frontend — MODIFY
- `apps/web/src/components/shared/app-sidebar.tsx` — Audit nav item
- `apps/web/src/types/admin.ts` — AuditLogDto

### Docs
- `docs/conventions/audit-pattern.md` — inline audit pattern documentation

## 5. API contract — `/api/audit-logs`

### `GET /api/audit-logs`
Auth: `audit:read` permission required.
Query (all optional except pagination):
```
page=1, limit=20 (max 100)
userId=uuid
action=CREATE|UPDATE|DELETE|LOGIN|LOGOUT|EXPORT|IMPORT|PRINT|APPROVE|REJECT
resourceType=Asset|User|Role|...
resourceId=uuid (requires resourceType to be useful but not enforced)
dateFrom=ISO8601, dateTo=ISO8601
search (matches resourceId, userAgent, ipAddress)
```
Order: `createdAt DESC` (use existing index)
Response: `{ data: AuditLogDto[], meta: { page, limit, total, totalPages } }`

### `GET /api/audit-logs/:id`
Permission: `audit:read`. Response: full `AuditLogDto` with un-truncated `old_values`/`new_values`.

### `GET /api/audit-logs/export`
Permission: `audit:read`. Streams CSV with same filters as `GET /`. Hard cap 50,000 rows.
Headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="audit-YYYYMMDD-HHmm.csv"`.

## 6. UI/UX spec — `/admin/audit`

| Element | Spec |
|---|---|
| Page header | "Audit Log" + "Export CSV" button (right) |
| Filter bar | Sticky top: search input, action select, resourceType select, date range pickers, user picker. "Clear filters" button |
| Table | Server-paginated, columns: timestamp (relative + tooltip absolute), user, action (badge), resourceType, resourceId (truncated), IP. Clickable row → drawer |
| Action badge colors | CREATE=green, UPDATE=blue, DELETE=red, LOGIN=gray, LOGOUT=gray, EXPORT=violet, IMPORT=violet, PRINT=amber, APPROVE=teal, REJECT=red |
| Detail drawer | Slides from right, width 480px (full on mobile). Header: action + resource. Body: old/new JSON side-by-side. Footer: close + "View resource" link if resourceType maps to a route |
| Empty state | Centered illustration + "No audit logs match these filters" + "Clear filters" CTA |
| Loading state | shadcn Skeleton rows |
| Error state | Error toast + "Retry" button |
| Mobile | Filter bar → collapse drawer (hamburger). Table → vertical cards. Detail drawer → full-screen sheet |

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Audit endpoint accidentally returns user data of other tenants | Permission gate `audit:read` is admin-only; no per-row tenancy check needed (single-tenant deployment per spec) |
| Redis down → rate limiter fails open | `rate-limit-redis` has `skipFailedRequests` option; we set to false → fail-closed (return 503 instead). Acceptable: Redis is also BullMQ dependency, app already needs it |
| CSP breaks existing UI (Recharts SVG, barcode preview blob URLs) | Verify with smoke test on every admin page before merging; `imgSrc` includes `data:` + `blob:`; `styleSrc` includes `'unsafe-inline'` |
| Magic byte rejection of legitimate xlsx (Office quirks) | Test with multiple Excel versions; allow `application/octet-stream` fallback for .xlsx specifically since some browsers send wrong MIME |
| Audit CSV export OOM on large filter | Hard cap 50,000 rows; Node stream chunked write (not Buffer concat); add toast "Truncated to 50k rows" if cap hit |
| Coverage test brittle (false positives when endpoint is read-only) | Maintain explicit allowlist of "no-audit-needed" endpoints with reason comments; manual review before adding |

## 8. Definition of Done

- [ ] Tier 1–7 selesai
- [ ] `pnpm --filter api typecheck && lint && test` semua hijau (target 286 tests)
- [ ] `pnpm --filter web typecheck && lint` semua hijau
- [ ] Manual smoke: `/admin/audit` loads, filters work, drawer renders diff, CSV downloads
- [ ] curl test: 11 logins in 60s → 11th returns 429
- [ ] curl -I /api/health shows hardened headers
- [ ] code-reviewer: zero blockers/majors
- [ ] i18n-checker: en+id parity (no new keys expected since admin chrome stays English)
- [ ] PR merged to `main`

## 9. Estimated effort

| Tier | Est. effort |
|---|---|
| 1 — Audit coverage | 0.5 day |
| 2 — Audit API + viewer UI | 2 days |
| 3 — Rate limit Redis tier | 0.5 day |
| 4 — Helmet hardening | 0.5 day |
| 5 — Upload hardening | 0.5 day |
| 6 — Transaction scan | 0.5 day |
| 7 — Tests | 0.5 day (mostly bundled in tier work) |
| 8 — Review & merge | 0.5 day |
| **Total** | **~5.5 days** |

Parallel dispatch: ~3 sessions realistic.

## 10. Out-of-scope (defer ke Phase 17)

- Soft-delete Prisma middleware
- Per-user-id rate limit on authenticated paths
- Audit retention policy (e.g. archive logs older than 1 year)
- 2FA / MFA
- Session management UI (active sessions, revoke)
- Penetration test
