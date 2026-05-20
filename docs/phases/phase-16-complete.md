# Phase 16 — Audit Trail & Security Hardening: Completion Summary

> Branch: `phase-16/audit-security`
> Plan: [`phase-16-plan.md`](./phase-16-plan.md)
> Completed: 2026-05-20

---

## What shipped

Eight tiers (1–7 + final review), 8 commits, ~5,400 lines net added.

| Tier | Commit | Scope |
|---|---|---|
| 1 | `74da14d` | Audit-coverage contract test + auth LOGIN/LOGOUT/UPDATE audit gap closure |
| 2 | `714c503` | `/api/audit-logs` module (list / detail / CSV export) + `/admin/audit` admin UI (filter bar + detail drawer + colour-coded action badges) |
| 3 | `424fcd7` | Redis-backed rate-limiter factory + auth-tier 10/min limiter on login + refresh |
| 4 | `549d94e` | Hardened Helmet — CSP `frame-ancestors 'none'`, X-Frame-Options DENY, Referrer-Policy `strict-origin-when-cross-origin`, HSTS production-only, CORP cross-origin override on `/uploads/*` |
| 5 | `6e6b848` | Upload validator (magic-byte verification for XLSX/XLS/CSV) + filename sanitiser (path-traversal protection) |
| 6 | `1d4b718` | Cross-codebase `$transaction()` coverage scan — fixed 1 Blocker (movements `$executeRaw` escaping its tx) + 5 service modules wrapping repo write + audit insert atomically |
| 7 | `9dcb47a` | Auth service tests (zero coverage before) + Helmet security-header regression guard |
| 8 | `2ffba00` | Final review fixes — 2 more transaction gaps (`setRolePermissions`, `assignRoles`) + CSP localhost fallback condition |

## Quality gates

- **API tests**: 356/356 pass (256 baseline → 356, +100 new across Phase 16)
- **typecheck**: clean on both `apps/api` and `apps/web`
- **lint**: clean on new code (pre-existing lint debt in lib/excel.ts etc. not touched)
- **Manual smoke**: `/admin/audit` end-to-end verified — list renders, drawer opens with JSON diff, CSV export downloads with audit-of-audit row, action filter narrows, rate limit triggers at 10/min for `/api/auth/login`, hardened CSP headers visible via `curl -I`

## Decisions locked from the original plan

| Decision | Choice | Outcome |
|---|---|---|
| Audit pattern | Inline + coverage test | 38 mutating endpoints audited; 17 documented exemptions in `audit-inventory.ts`; static contract catches future regressions |
| Viewer scope | List + filter + detail drawer + CSV | 480px right-slide drawer with side-by-side BEFORE/AFTER JSON; cursor-paginated CSV streamed up to 50k rows |
| Rate limit | Redis-backed | `rate-limit-redis@4.x` (5.x peers `express-rate-limit ≥8.5`; we're on 7.5); fail-closed if Redis is down |
| Soft-delete middleware | Deferred to Phase 17 | (untouched this phase) |

## Findings during the final review (Tier 8)

| Finding | Severity | Disposition |
|---|---|---|
| `setRolePermissions` + `assignRoles` write audit outside transaction | Major | **Fixed** — both repo helpers gained optional `tx?` param; services wrap repo write + audit in `$transaction` |
| CSP `connect-src` hardcodes `http://localhost:3000` in production when `CORS_ORIGIN` unset | Minor | **Fixed** — fallback is now env-conditional, production with no `CORS_ORIGIN` falls back to `'self'` only |
| `CONTROL_AND_NUL` regex looks like `[ -]` (space-to-hyphen) in source-reader output | False positive | Source bytes are actually `[\x00-\x1f]` (correct control-char range); tests confirm \x00/\x01/\x02 stripping works. Added clarifying comment + extended to include DEL (0x7F) since we were touching it |
| Hardcoded English strings in `/admin/audit/page.tsx` | Major (per project i18n rule) | **Deferred to Phase 14** — consistent with the precedent set in Phase 15 for admin-chrome UI (audit viewer, tours editor, asset-categories admin page all stay English until Phase 14 wires react-i18next across the app) |

## i18n parity

- Phase 16 added **zero** new tour locale keys. The audit module is admin chrome and follows the Phase 15 precedent of English-only until Phase 14.
- Existing `tours.json` files (en + id) — parity unchanged from Phase 15 (62 keys per side, verified previously).
- The `i18n-checker` agent was therefore not dispatched — no new keys to compare.

## Files of note

### New modules

- `apps/api/src/modules/audit/` — full module (router, service, repository, schema, types, tests)
- `apps/web/src/app/admin/audit/page.tsx` — admin viewer
- `apps/web/src/components/shared/audit-{filter-bar,detail-drawer}.tsx` — viewer components

### New libraries

- `apps/api/src/lib/rate-limiter.ts` — Redis-backed factory
- `apps/api/src/lib/upload-validator.ts` — magic-byte detection
- `apps/api/src/lib/filename-sanitizer.ts` — path-traversal protection

### New convention docs

- `docs/conventions/audit-pattern.md` — inline audit pattern, when to skip, what the coverage test catches

### New regression-test artefacts

- `apps/api/src/modules/__tests__/audit-inventory.ts` — source of truth for mutating endpoints + their audit status
- `apps/api/src/modules/__tests__/audit-coverage.test.ts` — 27 tests pinning the contract
- `apps/api/src/modules/auth/service.test.ts` — previously zero coverage
- `apps/api/src/app.test.ts` — Helmet header regression guard

## Test-count breakdown

| Tier | New tests |
|---|---:|
| 1 — Audit coverage contract | 27 |
| 2 — Audit module (service + router) | 23 |
| 3 — Rate-limiter factory | 4 |
| 4 — (no new tests; verified via curl) | 0 |
| 5 — Upload validator + filename sanitiser | 27 |
| 6 — (refactor only; existing tests still pass) | 0 |
| 7 — Auth service + Helmet headers | 19 |
| **Total new** | **100** |

Baseline was 256 (Phase 15 close). 256 + 100 = 356.

## Known follow-ups for future phases

| Item | Where to address |
|---|---|
| Soft-delete Prisma middleware | Phase 17 (QA) per original Phase 16 plan §10 |
| Audit-page i18n (replace ~15 hardcoded strings) | Phase 14 (i18n wire-up) |
| `listAuditLogsPaginated` uses `skip`/`take` offset pagination — slow at multi-million rows | Phase 17 (QA) — performance pass |
| Audit retention policy (auto-archive old rows) | Operations concern, not currently scheduled |
| 2FA / MFA | Out of scope for this project at present |
| Session management UI (active sessions / revoke) | Future phase |
| Penetration test | External engagement, not in plan |
| `rate-limit-redis@5.x` upgrade (needs `express-rate-limit@≥8.5`) | Bundled with dep refresh |

## Acknowledgements

- Phase 15's tour-sync infrastructure provided the inline-audit pattern that Phase 16 then formalised as a contract.
- Phase 11 / 15 review feedback (transactional audit pattern, sensitive-field redaction) carried directly into the Tier 6 transaction-coverage scan.
- The audit-coverage test design comes from the "freeze + verify" approach used in other repos: inventory + completeness check + grep-based audit presence. Static analysis isn't watertight but it's the right rigour level for a regression detector that runs in CI.
