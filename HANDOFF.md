# Wedisense AMS — Session Handoff

> **For the next agent**: Read this top-to-bottom before doing anything. The user wants to continue Phase 11 in a fresh context window. Project root: `/Users/raihanhaykal/wedison/IT/wedisense`.

---

## Goal

Build **Wedisense** — a comprehensive web-based Asset Management System for **Wedison** (Indonesia). The work is structured around **17 phases** defined in [`wedisense-ams-claude-code-prompt.md`](wedisense-ams-claude-code-prompt.md). Each phase: build → typecheck → manual smoke test → code-review agent → commit on a `phase-N/feature-name` branch.

User communicates in Bahasa Indonesia (mostly). Default UI language is `id`. Today's date: **2026-05-06**.

---

## Where We Are Right Now

- **Branch**: `phase-10/label-printing`
- **Last commit**: `49a1c14 Fix Code128 barcode scanning: add format hints + try-harder mode`
- **Phases 0–10**: ✅ COMPLETE (committed, user-verified)
- **Phase 11 (Notifications & Background Jobs)**: ⏭️ NEXT — has not been started
- **Untracked dirs** (safe to ignore, do NOT commit): `.playwright-mcp/`, `apps/api/uploads/`, `apps/web/dev-server.mjs`

User's most recent message: *"ok sudah bisa. lanjut ke phase 11, tapi sebelum itu, jalankan compact terlebih dahulu"* — they manually ran `/compact`, then asked for this handoff, then will start a fresh session.

---

## Project Context (do NOT re-derive)

### Stack
- **Monorepo**: pnpm workspaces — `apps/api` (Express + Prisma + PG), `apps/web` (Next.js 14 App Router + React 18 + shadcn/ui + Tailwind), `packages/shared`
- **Backend**: Express + TypeScript strict + Prisma + PostgreSQL 15 + BullMQ + Redis (ioredis ^5.4.2, bullmq ^5.34.8 already installed)
- **Frontend**: Next.js 14 + Zustand + TanStack Query + RHF + Zod + react-i18next
- **Auth**: JWT access 15m + refresh 7d (httpOnly cookie) + bcrypt(12)
- **i18n**: `id` (default) + `en`. Files at `packages/shared/locales/{en|id}/{namespace}.json`. Existing namespaces: assets, auth, common, errors, maintenance, movements, notifications, reports, tours
- **No Docker.** Native PG + Redis on user's machine.

### Architecture pattern (NON-NEGOTIABLE)
Router → Service → Repository. ALWAYS:
- `asyncHandler()` wrap all async route handlers — no raw try/catch in routers
- Zod validate at API boundary
- `prisma.$transaction()` for any multi-table write
- Audit middleware automatically captures writes (`apps/api/src/middleware/audit.ts`)
- `audit_logs` and `asset_movements` are **append-only** (REVOKE UPDATE/DELETE at PG level — already in migrations)
- For status updates on `asset_movements`, use `prisma.$executeRaw` (because no `updatedAt` field)
- TS strict: NO `any`, NO `// @ts-ignore` without inline reason

### API response envelope
```json
{ "success": true, "data": {...}, "meta": {...} }
{ "success": false, "error": { "code": "...", "message": "...", "details": [...] } }
```
Frontend `apps/web/src/lib/api.ts` already unwraps `.data.data`. Use `getApiErrorMessage()` from `apps/web/src/lib/error.ts` to surface API errors in dialogs (it parses Zod `details` array).

### Field naming gotcha
PDF/labels accept BOTH snake_case (`asset_number`, `serial_number`) AND camelCase (`assetNumber`, `serialNumber`) in `apps/api/src/lib/pdf.ts > resolveFieldValue`. Don't break this.

### Existing modules in `apps/api/src/modules/`
auth, users, roles, locations, products, assets, movements, maintenance, labels

### Existing web pages (`apps/web/src/app/`)
admin (users, roles, locations, products, assets, movements, maintenance, print, print/editor), auth, dashboard, scan

### Existing shared components (`apps/web/src/components/`)
ui (shadcn — DON'T MODIFY), barcode, label-editor, shared (app-sidebar, asset-form, dialogs, movement-timeline, print-dialog, protected-route)

### Shared lib
- `apps/api/src/lib/`: barcode, pdf, prisma, redis (ioredis client already exported), storage
- `apps/web/src/lib/`: api, error, utils
- `apps/web/src/hooks/`: use-barcode-scan, use-permission
- `apps/web/src/stores/`: auth.store

---

## What Worked (keep doing this)

1. **Agent team pattern per phase**: dispatch `backend-dev` + `frontend-dev` in parallel for API+UI work, then `code-reviewer` after. For DB-only work use `db-architect`. For tests use `test-writer`. For i18n verification use `i18n-checker`.
2. **Always commit per phase** with `phase-N: <title>` message on a `phase-N/feature-name` branch.
3. **Test in browser before claiming done** — user pushes back hard on assumptions ("jangan asumsi"). Verify the golden path manually for any UI feature.
4. **Surface API errors in UI dialogs** via `getApiErrorMessage(err, fallback)`. Generic "Failed to X. Please try again." infuriates user.
5. **For optional number fields in Zod**: use `z.preprocess(v => v==="" ? undefined : Number(v), z.number().optional())` — `z.coerce.number().optional()` fails on empty string (NaN).
6. **Frontend prepends `process.env.NEXT_PUBLIC_API_URL`** to every `pdfUrl` / file URL because uploads are served by API not Next.js.
7. **Authenticated file downloads**: never `window.open(url)` — use `api.post(..., { responseType: 'blob' })` then `URL.createObjectURL(blob)`.
8. **Snake_case + camelCase dual support** in PDF field resolver (Phase 10 lesson).

## What Didn't Work (do NOT repeat)

1. ❌ Validating only one movement type for status conflicts — user wants validation for **all** movement types that could double-input. Pattern is `validateAssetStatusForMovement()` called via `requireAsset(tx, id, movementType)` in `apps/api/src/modules/movements/service.ts`.
2. ❌ Hardcoded barcode/QR width — must be constrained to field width or 80% paper width (see `pdf.ts`).
3. ❌ `window.open()` for protected resources — server returns `MISSING_TOKEN` JSON.
4. ❌ Treating `audit_logs` / `asset_movements` as updatable — they are append-only at the DB level.
5. ❌ `z.coerce.number().optional()` with empty-string input — silent NaN failure.
6. ❌ Putting business logic in routers — must live in services.
7. ❌ Editing `prisma/migrations/**` directly — always `pnpm --filter api prisma migrate dev --name <name>`. The pre-edit hook will block you anyway.
8. ❌ Editing `.env*` directly — pre-edit hook blocks. Update `.env.example` and ask user to apply manually.
9. ❌ Bumping dev camera to 1280×720 — Code128 needed 1920×1080 + format hints + TRY_HARDER.
10. ❌ Generic error toasts without API message — user sees them as bugs.

---

## Phase 10 Recap (just finished)

Visual drag-and-drop label editor at `/admin/print/editor`, complete with:
- 3-panel layout (palette | canvas | properties), full page
- Real SVG barcode + QR rendering on canvas (BarcodeSVG, QRCodeSVG components)
- Drag-and-drop with snap-to-0.5mm and constrain-to-paper
- Undo/Redo (max 50, Ctrl+Z / Ctrl+Shift+Z) — only push history on dragEnd
- Unsaved-changes confirmation (window.confirm + beforeunload)
- Asset field selector for barcode/QR/field types
- Bulk print from asset list (checkbox + "Print Labels (N)" button + PrintDialog)
- PDF generation via `pdfkit` at exact mm dimensions
- Field-key dual-naming support (snake_case + camelCase)
- Code128 scanner fix in `apps/web/src/hooks/use-barcode-scan.ts` (format hints + TRY_HARDER + 1920×1080) — user confirmed working

Files most recently touched (last 10 commits, full list via `git log --oneline -10`):
- `apps/web/src/hooks/use-barcode-scan.ts` — scanner format hints
- `apps/web/src/components/label-editor/{types,field-palette,editor-canvas,property-panel}.tsx`
- `apps/web/src/app/admin/print/editor/page.tsx`
- `apps/web/src/app/admin/assets/page.tsx` — bulk print
- `apps/web/src/components/shared/print-dialog.tsx`
- `apps/web/src/components/shared/label-template-dialog.tsx` — Zod preprocess fix
- `apps/web/src/lib/error.ts` — getApiErrorMessage
- `apps/api/src/lib/pdf.ts` — field resolver + barcode sizing
- `apps/api/src/modules/labels/*`
- `apps/api/src/modules/movements/service.ts` — validateAssetStatusForMovement

---

## Next Steps — Phase 11: Notifications & Background Jobs

Spec source: see `wedisense-ams-claude-code-prompt.md` "Phase 11" + "Notification & Alert Jobs (BullMQ)" section.

### 11.0 — Branch
```bash
git checkout -b phase-11/notifications-jobs
```

### 11.1 — Backend (dispatch `backend-dev` agent)

**Create `apps/api/src/jobs/` with these 9 BullMQ jobs:**

| Job file | Schedule | Trigger |
|---|---|---|
| `warranty-check.job.ts` | Daily 08:00 WIB (cron) | `warrantyEndDate` within 30 days → `NotificationType.WARRANTY_EXPIRING` |
| `loan-overdue.job.ts` | Daily 08:00 WIB | `expectedReturnDate < today` on LOAN_OUT movement → `LOAN_OVERDUE` |
| `maintenance-due.job.ts` | Daily 08:00 WIB | `nextDueDate` within 7 days → `MAINTENANCE_DUE` |
| `depreciation.job.ts` | Nightly 02:00 WIB | All non-disposed assets — update `currentBookValue` (straight-line + declining-balance per category) |
| `weekly-summary.job.ts` | Monday 08:00 WIB | Aggregate counts → email all ADMIN+ |
| `tour-sync.job.ts` | On-demand (queued from `PUT /api/roles/:id/permissions`) | Already STUB exists — see `.claude/skills/tour-sync-rules.md` for full spec |
| `report-generate.job.ts` | On-demand | Generate report PDF/Excel → notify with `REPORT_READY` |
| `print-generate.job.ts` | On-demand | Generate label PDF → notify with `PRINT_READY` |
| `import-process.job.ts` | On-demand | Process Excel import → notify with `IMPORT_COMPLETE` |

**Infrastructure:**
- Create `apps/api/src/lib/queue.ts` — BullMQ queue factory, register all queues + workers, share `redis` client from `apps/api/src/lib/redis.ts` (already exists)
- Create `apps/api/src/lib/mailer.ts` — nodemailer transporter (nodemailer ^6.9.16 already installed). Read SMTP config from env. Helper: `sendMail({ to, subject, htmlEn, htmlId, lang })`.
- Wire scheduled jobs on server startup (`apps/api/src/server.ts`) using BullMQ repeat options. Use timezone `'Asia/Jakarta'` (WIB).
- Update `.env.example` with: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `JOB_TIMEZONE=Asia/Jakarta`. Ask user to add to their `.env` (DON'T edit `.env`).

**Notifications module (new):**
Create `apps/api/src/modules/notifications/`:
- `repository.ts` — list (filter by user, isRead, type, pagination), markRead, markAllRead, create (used by jobs), unreadCount
- `service.ts` — wraps repository, enforces user can only access their own
- `schema.ts` — Zod for query/path params
- `router.ts` — wire endpoints below, all behind `authenticate`
- `index.ts` — export router + `notify(userId, type, title, message, data)` helper for jobs/services

**Endpoints:**
```
GET  /api/notifications                ← paginated, filters: isRead, type
GET  /api/notifications/unread-count   ← { count: number } for bell badge
PUT  /api/notifications/:id/read
PUT  /api/notifications/read-all
```

Mount in `apps/api/src/app.ts`. Add to Swagger.

**tour_sync — implement fully** (replace current console.log placeholder):
1. Load `OnboardingTour` records where `roleId == affected role`
2. For each step, check `required_permission` against updated permission set
3. Newly granted → add step (if not present) with `is_active: true`
4. Newly revoked → set step `is_active: false` (don't delete)
5. Insert `audit_logs` row: `resource_type: "OnboardingTour"`, `action: "UPDATE"`
6. Notify all ADMIN users via notifications module: title key `notifications.tour_updated.title`, message key `notifications.tour_updated.message`

### 11.2 — Frontend (dispatch `frontend-dev` agent in parallel with backend)

- **Notification bell** in `apps/web/src/components/shared/app-sidebar.tsx` topbar (or header). Bell icon + red badge with unread count.
- Poll `GET /api/notifications/unread-count` every 30s via TanStack Query (or SSE later — for now polling is fine).
- Click bell → dropdown panel showing latest 10 notifications, "Mark all as read", "View all" link.
- Each notification row: title (i18n key), short message, relative time (use `date-fns` formatDistanceToNow with `id` locale), unread dot.
- Clicking a notification calls `PUT /:id/read` and navigates to `data.url` if present.
- New page `/admin/notifications` — full list with filters (type, isRead) + pagination.
- All strings via `react-i18next` using `notifications` namespace. Add to BOTH `en` and `id` locale files.

### 11.3 — Email templates

- Create `apps/api/src/templates/emails/{warranty-expiring,loan-overdue,maintenance-due,weekly-summary,report-ready,print-ready,import-complete}.{en,id}.html`
- Use simple inline-CSS HTML (works in Gmail). Variables via `{{handlebars}}` or simple template literal.
- Mailer helper picks lang based on `user.preferredLanguage`.

### 11.4 — Verification before commit

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter web typecheck
pnpm --filter web lint
```

Smoke-test in browser:
1. Login as admin → bell shows count 0 initially
2. Trigger a manual movement that creates a notification (e.g., LOAN_OUT with past expected_return_date → run loan-overdue job manually via a temporary admin endpoint or seed)
3. Bell badge increments
4. Click bell → dropdown shows the notification with unread dot
5. Click notification → marks read, badge decrements
6. "Mark all as read" works
7. Visit `/admin/notifications` → filters work

### 11.5 — Code review + commit

Dispatch `code-reviewer` agent on the diff, fix findings, then:
```bash
git add -A
git commit -m "Phase 11: Notifications & Background Jobs

- 9 BullMQ jobs registered with WIB cron schedules
- Notifications module + bell badge + dropdown + full page
- HTML email templates in en + id
- tour_sync job fully implemented (replaces console.log stub)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Run `i18n-checker` agent to verify all new keys exist in both `en` and `id`.

---

## Important Conventions Reminder

- **NEVER** edit `apps/api/prisma/migrations/**` — pre-edit hook will block. Use `prisma migrate dev --name <name>`.
- **NEVER** edit `.env*` files — hook blocks. Update `.env.example` and tell user to apply.
- **NEVER** `prisma migrate reset` without explicit user approval.
- **NEVER** modify `apps/web/src/components/ui/` (shadcn).
- **ALWAYS** update both `en` and `id` locale files for any new string.
- **ALWAYS** use `pnpm` (not npm/yarn).
- Run typecheck + lint after every batch of edits. Fix all errors before stopping.
- Use `Asia/Jakarta` (WIB, UTC+7) for all scheduled jobs.

## User Preferences (from CLAUDE.local.md + observed behavior)

- Communicates in Bahasa Indonesia mostly — respond in BI when they do
- Hates assumptions — verify with actual file reads or Playwright when uncertain ("jangan asumsi")
- Wants real error messages, not "Failed. Try again."
- Prefers showing 2 options before deciding when unsure (architectural decisions)
- Always create a git branch before starting any phase
- Tests features in browser themselves before approving phase complete

## Useful Commands

```bash
# Run dev servers
pnpm dev                              # both api + web
pnpm --filter api dev                 # api only on :4000
pnpm --filter web dev                 # web only on :3000

# Quality gates
pnpm --filter api typecheck && pnpm --filter web typecheck
pnpm lint
pnpm --filter api test

# DB
pnpm --filter api prisma migrate dev --name <name>
pnpm --filter api prisma generate
pnpm --filter api prisma studio
pnpm --filter api prisma:seed         # seed script at apps/api/prisma/seed.ts
```

## Available Subagents (use them!)
`backend-dev`, `frontend-dev`, `db-architect`, `code-reviewer`, `test-writer`, `i18n-checker` — defined in `.claude/agents/`.

Pattern: parallel `backend-dev` + `frontend-dev` for cross-cutting features, then sequential `code-reviewer`, then `i18n-checker` if UI strings added.

---

## Resume Command for Fresh Session

Tell the next session simply:

> Read /Users/raihanhaykal/wedison/IT/wedisense/HANDOFF.md and continue Phase 11.
