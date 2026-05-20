# Phase 15 — Onboarding Tours: Development Plan

> Branch: `phase-15/onboarding-tours`
> Status: planning · awaiting approval
> Last updated: 2026-05-19

---

## 1. Goals

End-state Phase 15 selesai berarti:

1. User login pertama kali → otomatis disambut tour sesuai role-nya. Step di-render dengan animasi halus, popover gaya shadcn Card, mobile-responsive, keyboard-accessible.
2. Tour bisa nyebrang halaman (step 3 di `/dashboard`, step 4 di `/admin/assets` dst) tanpa user perlu mikir — engine auto-navigate + nunggu target DOM muncul.
3. Step yang butuh permission user nggak punya → server-side skip (server-rendered filter), bukan client-side hide.
4. User bisa Next / Previous / Skip / Exit di tiap step. Progress disimpan per-step. Resume next session lanjut di step yang sama.
5. User bisa replay tour dari Profile → "Restart Tutorial".
6. SUPER_ADMIN bisa CRUD tour & step dari `/admin/tours` — form-based editor dengan drag-drop reorder, target picker dari registry `data-tour` values.
7. `tour-sync` job (sudah jadi di Phase 11) terverifikasi end-to-end: ubah permission role → tour-nya auto-sync → admin dinotif.
8. Seed tour 5 role updated, locale `tours.json` populated bilingual (en + id).
9. Test coverage: unit (service & filter logic), integration (HTTP endpoints), E2E (Playwright full flow), manual smoke + a11y checklist.

## 2. Architecture decisions (locked dari user)

| Keputusan | Pilihan | Reason |
|---|---|---|
| Library | **NextStep.js** | Native multi-page support, App Router-first, framer-motion popover, MIT, kecil |
| Multi-page strategy | **Auto-navigate + resume** | UX paling smooth; NextStep punya `unmountOnExit: false` + route adapter |
| Admin authoring | **Form-based editor** | Trade-off terbaik antara power & scope; drag-drop reorder, target dropdown dari registry |
| Permission filtering | **Server-side** | API filter step sebelum return; cocok dengan `tour-sync` design |
| Step storage | **`OnboardingTour.steps` JSONB** | Sudah ada di schema; admin edit langsung mutasi JSON |
| Progress storage | **`UserTourProgress` table** | Sudah ada di schema; unique (userId, tourId) constraint sudah ada |
| First-run trigger | Server-rendered hint in `/api/auth/me` | Bawa flag `hasIncompleteTour: boolean` jadi gak perlu polling |
| i18n approach | **i18n keys di steps** | `title: 'tours.dashboard.title'` — wired pakai `react-i18next` yang sudah installed |
| A11y | **Hand-augmented** | Inject focus trap, `role="dialog"`, `aria-modal`, live region (NextStep belum solid) |

## 3. Tier structure (incremental delivery)

Tiap tier = satu reviewable chunk. Setelah tier selesai → commit, typecheck+lint clean, manual smoke. Tier berikutnya nggak boleh mulai sebelum tier sebelumnya green.

### Tier 1 — Foundation (backend + library install)

**Goal:** API `/api/tours/*` jadi, NextStep.js terinstall, locale skeleton siap.

**Files baru:**
- `apps/api/src/modules/tours/router.ts` — 7 endpoints (lihat §5)
- `apps/api/src/modules/tours/service.ts` — list/get/create/update/delete + getMyTours (server-side permission filter) + updateProgress
- `apps/api/src/modules/tours/repository.ts` — Prisma queries
- `apps/api/src/modules/tours/schema.ts` — Zod validation untuk step shape
- `apps/api/src/modules/tours/types.ts` — `TourStep`, `TourDto`, `TourProgressDto`
- `apps/api/src/modules/tours/service.test.ts` — unit tests

**Files modified:**
- `apps/api/src/app.ts` — mount `app.use('/api/tours', authenticate, toursRouter)`
- `apps/api/prisma/seed.ts` — fix step `target_element` values supaya match `data-tour` actual (saat ini stale)
- `apps/api/src/modules/auth/service.ts` — `getMe()` tambah `hasIncompleteTour: boolean` (derived dari `UserTourProgress`)
- `packages/shared/locales/{en,id}/tours.json` — populate skeleton (keys aja dulu, full text di Tier 7)
- `apps/web/package.json` — install `nextstepjs` + `framer-motion`

**Decisions:**
- `tours:manage` permission (sudah ada di seed) gates admin CRUD endpoints.
- `GET /api/tours/my` returns array of tours dengan steps SUDAH di-filter — step `is_active=false` dibuang, step `required_permission` yang user gak punya juga dibuang.
- Step shape strictly typed:
  ```ts
  type TourStep = {
    stepIndex: number;
    title: string;            // i18n key, e.g. "tours.dashboard.title"
    description: string;      // i18n key
    targetElement: string;    // CSS selector or `data-tour` value
    position: 'top'|'bottom'|'left'|'right'|'auto';
    requiredPermission: { resource: string; action: string } | null;
    route: string;            // e.g. "/dashboard" — engine navigates here if not already
    isActive: boolean;
  };
  ```
- Validation: stepIndex contiguous & unique (Zod refine).

**Verification:**
- `pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test`
- `curl /api/tours/my` returns expected shape with auth.

### Tier 2 — Tour engine (frontend core)

**Goal:** Tour bisa di-start, render satu step, Next/Prev/Skip work, progress saved.

**Files baru:**
- `apps/web/src/components/tour/tour-provider.tsx` — wraps NextStep `<NextStep>` + state
- `apps/web/src/hooks/use-tour.ts` — start, stop, next, prev, skip + bind ke API
- `apps/web/src/stores/tour.store.ts` — Zustand: `currentTourId`, `currentStepIndex`, `isActive`, `isResuming`
- `apps/web/src/types/admin.ts` — append `TourDto`, `TourStepDto`, `TourProgressDto`

**Files modified:**
- `apps/web/src/app/layout.tsx` — mount `TourProvider` inside `QueryProvider` (CRITICAL: harus di root layout supaya driver instance survive route changes)
- `apps/web/src/types/admin.ts` — types tour

**Decisions:**
- Provider mounts `<NextStepProvider>` with empty steps initially; steps dimuat saat `useTour().start(tourId)` dipanggil.
- `onStepChange` callback PATCH ke `/api/tours/:id/progress` (debounced 500ms supaya double-click gak burst request).
- `onComplete` & `onSkip` PUT final state.
- "Resume" flow: on `useTour()` mount, kalau auth.me bilang `hasIncompleteTour=true` → fetch `/api/tours/my` → cari tour yang punya `userTourProgress.lastStepIndex > 0 && !isCompleted && !isSkipped` → autostart at that step. Suppress autostart kalau user navigate manually selama < 2s (debounce reroute conflicts).

**Verification:**
- Local smoke: login → tour kebuka → Next/Prev work → refresh → resume di step yg sama → Skip → refresh → gak kebuka lagi.

### Tier 3 — UI/UX polish (THE money tier)

**Goal:** Tour feels native to the app. Shadcn aesthetic, smooth animation, a11y solid.

**Files baru:**
- `apps/web/src/components/tour/tour-popover.tsx` — custom popover yang dipasang via NextStep's `Card` / `popoverComponent` prop (NextStep mengizinkan custom render component)
- `apps/web/src/components/tour/tour-overlay.tsx` — backdrop dengan blur (kalau NextStep default kurang)
- `apps/web/src/components/tour/tour-controls.tsx` — button group: Prev / Skip / Next (kanan), step counter "3 of 7" (kiri)
- `apps/web/src/components/tour/tour-spotlight.css` — pulsing beacon `::before` on `.nextstep-active-element`
- `apps/web/src/styles/tour.css` — global tour styles bridging shadcn vars

**UI specs (UTAMAKAN UI/UX per user request):**

| Element | Spec |
|---|---|
| Popover | `max-w-[320px]` desktop, `max-w-[calc(100vw-2rem)]` mobile, padding `p-4`, `rounded-lg`, `border`, `bg-card`, `shadow-xl`, `text-sm` |
| Popover header | `text-base font-semibold` (max 60 char), close button kanan-atas (`X` icon, 32px target) |
| Popover body | `text-sm text-muted-foreground leading-relaxed` (max 240 char) |
| Step counter | `text-xs text-muted-foreground` "Step 3 of 7" |
| Buttons | shadcn `Button` look: Next = `default`, Prev = `ghost`, Skip = `outline`. Tap target ≥ 40px |
| Backdrop | `backdrop-blur-[2px] bg-black/40` (NOT solid `bg-black/60` — terlalu opaque) |
| Spotlight | `stageRadius: 8` (soft rounded), gap 4px padding |
| Beacon | Pulsing ring `@keyframes` on target element: 0% scale(1), 50% scale(1.05) opacity 0.5, 100% scale(1.1) opacity 0 |
| Entry animation | Framer Motion: `initial={{opacity:0,scale:0.95,y:4}} animate={{opacity:1,scale:1,y:0}}` 200ms `easeOut` |
| Step transition | Position spring (Framer `layout` prop) — softer than instant jump |

**A11y (must-have):**
- `role="dialog"` + `aria-modal="true"` di popover wrapper
- `aria-labelledby` ke title id
- `aria-describedby` ke body id
- Focus trap: TAB cycle Prev → Skip → Next → close-btn → loop. `focus-trap` package atau manual `keydown` listener.
- Auto-focus first interactive on step show (close-btn or Next)
- `aria-live="polite"` region di document body announces "Step 3 of 7: ..." on each step change
- ESC closes (Skip), Enter advances (Next)
- Reduced motion: `@media (prefers-reduced-motion: reduce)` → disable animations, use crossfade only

**Mobile (≤640px):**
- Popover bottom-sheet style (full width, slide up from bottom)
- Skip / Next stacked vertical jika butt-saturated
- Spotlight padding lebih besar (kompensasi tap precision)

**Verification:**
- Manual: keyboard-only navigation full tour
- axe DevTools: zero serious/critical issues during tour
- Lighthouse A11y ≥ 95 pada page dengan tour aktif
- iPhone SE viewport (375×667) — popover muat, gak overflow

### Tier 4 — Multi-page auto-navigation

**Goal:** Step "klik tombol Add Asset" di `/admin/assets` → Next → "Lihat detail di /admin/assets/:id" otomatis route + tunggu DOM.

**Files modified:**
- `apps/web/src/hooks/use-tour.ts` — `onBeforeStepChange` handler:
  1. Check `nextStep.route` vs `usePathname()`
  2. Kalau beda → `router.push(nextStep.route)` + set `isNavigating=true`
  3. MutationObserver wait `document.querySelector(nextStep.targetElement)` (max 3s timeout)
  4. Resolve → engine advance; reject (timeout) → toast "Halaman tidak siap" + revert step

**Decisions:**
- NextStep punya `routerInstance` prop yang menerima Next.js router — pakai itu.
- Pakai `MutationObserver` bukan `setInterval` (efficient).
- Timeout 3s, fallback graceful: tampil toast "Step ini tidak tersedia di halaman saat ini" dan auto-skip ke next-next step.

**Verification:**
- E2E test: tour yang span dashboard → assets → asset-detail, semua step muncul tanpa flicker.

### Tier 5 — Admin authoring UI

**Goal:** SUPER_ADMIN bisa CRUD tour di `/admin/tours`. Per tour: list step, drag-drop reorder, edit form per step.

**Files baru:**
- `apps/web/src/app/admin/tours/page.tsx` — tour list per role (1 tour per role)
- `apps/web/src/app/admin/tours/[id]/page.tsx` — step editor
- `apps/web/src/components/shared/tour-step-list.tsx` — drag-drop list (pakai `@dnd-kit/sortable`)
- `apps/web/src/components/shared/tour-step-form-dialog.tsx` — form per step
- `apps/web/src/components/shared/tour-target-picker.tsx` — dropdown of registered `data-tour` values
- `apps/web/src/lib/tour-registry.ts` — static list of all `data-tour` values di app (auto-generated saat build via script atau manual maintained)

**Decisions:**
- `tour-registry.ts` — pilihan A: manually maintained file (simpler, harus update saat tambah `data-tour`). Pilihan B: build script grep all `data-tour=` in `apps/web/src/` saat build (auto-sync but more infra). **Default: A** dulu, B bisa nanti.
- Permission picker: dropdown 2-level (resource: assets/movements/.. → action: read/update/..). Plus "tidak butuh permission" option.
- Save button → PATCH whole `steps` array sebagai 1 transaction. Server validate (stepIndex unique & contiguous).
- Tour list page: 5 system tours (per role) selalu ada baris, tombol "Edit" / "Re-run tour-sync job".

**Verification:**
- Manual: ubah step di /admin/tours/:id → logout → login user role yg sama → step terlihat di tour.
- `tour-sync` button trigger queue job (button kalau dipencet enqueue job manual, useful kalau seed berubah).

### Tier 6 — First-run autostart + Profile restart

**Files modified:**
- `apps/web/src/app/layout.tsx` atau `apps/web/src/components/shared/protected-route.tsx` — on mount kalau `me.hasIncompleteTour` → setTimeout 800ms (biar layout settle) → useTour().start()
- `apps/web/src/app/profile/page.tsx` — section "Tutorial" + tombol "Restart Tutorial" (calls `PUT /api/tours/:id/restart`)

**Decisions:**
- Suppress autostart kalau:
  - User di-route via deep-link (e.g., clicked link from email) — check `document.referrer === ''` only autostart
  - User pernah skip tour ini (`isSkipped=true`) — respect choice; profile restart override-nya
- Profile page mungkin belum ada — create minimal page kalau perlu.

### Tier 7 — Locale population (en + id, BOTH)

**Files modified:**
- `packages/shared/locales/en/tours.json` — populate
- `packages/shared/locales/id/tours.json` — populate, mirror keys

**Keys** (semua step seed + UI chrome):
```
common.next                  / "Next" / "Selanjutnya"
common.previous              / "Previous" / "Sebelumnya"
common.skip                  / "Skip" / "Lewati"
common.finish                / "Finish" / "Selesai"
common.close                 / "Close" / "Tutup"
common.stepCounter           / "Step {{current}} of {{total}}" / "Langkah {{current}} dari {{total}}"
common.exitConfirm           / "Exit tutorial?" / "Keluar dari tutorial?"

# SUPER_ADMIN tour (5 steps)
super_admin.dashboard.title / .description
super_admin.users.title / .description
super_admin.roles.title / .description
super_admin.tours.title / .description
super_admin.audit.title / .description

# ADMIN tour (4 steps)
admin.dashboard.title / .description
admin.assets_create.title / .description
admin.movements.title / .description
admin.reports.title / .description

# MANAGER (5 steps) — assets list, filters, movement create, maintenance, reports view
# STAFF (3 steps) — dashboard, asset list read, scan
# VIEWER (3 steps) — dashboard, asset list read, reports view
```

### Tier 8 — Testing (DETAIL, sesuai permintaan user)

**Goal:** Bukti tour robust di semua flow.

#### 8a — Unit tests (Vitest, backend)
- `tours/service.test.ts`:
  - `getMyTours()` filters out inactive steps
  - `getMyTours()` filters out steps with `requiredPermission` user lacks
  - `getMyTours()` returns empty array when user has no role with active tour
  - `updateProgress()` upserts (creates if not exists, updates if exists)
  - `updateProgress()` marks `isCompleted` when last step reached
  - `updateProgress()` writes `lastSeenAt`
  - `updateProgress()` enforces ownership (404 if tour belongs to different role's user)
  - `restartTour()` resets `isCompleted=false, isSkipped=false, completedSteps=[]`
  - `createTour() / updateTour()`: validates stepIndex unique & contiguous
  - `updateTour()`: writes audit log
  - Permission check: only `tours:manage` can mutate

#### 8b — Integration tests (Vitest + Supertest)
- `tours/router.test.ts`:
  - `GET /api/tours/my` returns 401 unauthenticated
  - `GET /api/tours/my` happy path with mocked roles & permissions
  - `PUT /api/tours/:id/progress` validates schema (rejected payloads)
  - `PUT /api/tours/:id/progress` updates DB
  - `PUT /api/tours/:id/restart` resets
  - `POST /api/tours` returns 403 without `tours:manage`
  - `POST /api/tours` happy path creates tour
  - `PUT /api/tours/:id` validates step shape (bad position, bad stepIndex contiguity)

#### 8c — E2E tests (Playwright)
- `tours.spec.ts`:
  - **First-login flow**: seed user with ADMIN role, login → tour pops up automatically, popover visible, step counter says "1 of 4"
  - **Next/Prev**: click Next 3 times → on step 4, click Prev → back to step 3
  - **Multi-page navigation**: trigger step that has `route: '/admin/assets'` from `/dashboard` → page navigates, popover reappears anchored to correct element
  - **Skip flow**: click Skip → tour closes, refresh page → tour NOT auto-shown
  - **Resume flow**: stop at step 3 → close browser tab → reopen → tour resumes at step 3
  - **Restart from profile**: navigate /profile → click "Restart Tutorial" → tour shows from step 1
  - **Permission-filtered step**: as STAFF user, tour skips admin-only steps (verify only 3 steps shown, not 5)
  - **Mobile viewport**: resize to 375×667 → popover usable, no overflow
  - **Keyboard navigation**: TAB through buttons, ESC closes, Enter advances
  - **Admin authoring**: as SUPER_ADMIN, navigate `/admin/tours/:id`, add step, save → verify DB has new step

#### 8d — Manual smoke checklist
| # | Test | Pass? |
|---|---|---|
| 1 | Login fresh user → tour autostarts within 1s | |
| 2 | Tour popover styling matches shadcn (Card, border, shadow, font) | |
| 3 | Backdrop has subtle blur (not solid black) | |
| 4 | Spotlight is rounded (corners ≥ 8px) | |
| 5 | Pulsing beacon visible on highlighted element | |
| 6 | Mobile (DevTools 375px): popover muat, tombol stacked | |
| 7 | Keyboard-only: TAB navigates, Enter=Next, ESC=Skip | |
| 8 | Screen reader (VoiceOver): announces each step | |
| 9 | Step crossing pages: smooth navigate, no flash | |
| 10 | Skip → re-login → tour gak muncul | |
| 11 | Restart from profile → muncul lagi dari step 1 | |
| 12 | Permission change → tour-sync job runs → step ter-update | |
| 13 | i18n: switch ke English → tour text English | |
| 14 | i18n: switch ke Indonesia → tour text Indonesia | |
| 15 | Reduced motion: animations disabled, masih functional | |

#### 8e — Accessibility audit
- Run `axe-core` di browser console saat tour aktif
- Lighthouse A11y score ≥ 95
- Manual screen reader test (VoiceOver Mac): semua step terbaca
- Color contrast check: popover bg vs text (target WCAG AA 4.5:1)

### Tier 9 — Review & merge

- Dispatch `code-reviewer` agent → full diff review
- Dispatch `i18n-checker` → verify keys en+id parity
- Address findings
- Merge PR ke `main`
- Write `docs/phases/phase-15-complete.md` summary

## 4. Files matrix (consolidated)

### Backend
| File | Action |
|---|---|
| `apps/api/src/modules/tours/router.ts` | Create |
| `apps/api/src/modules/tours/service.ts` | Create |
| `apps/api/src/modules/tours/repository.ts` | Create |
| `apps/api/src/modules/tours/schema.ts` | Create |
| `apps/api/src/modules/tours/types.ts` | Create |
| `apps/api/src/modules/tours/service.test.ts` | Create |
| `apps/api/src/modules/tours/router.test.ts` | Create |
| `apps/api/src/app.ts` | Modify (mount router) |
| `apps/api/src/modules/auth/service.ts` | Modify (add `hasIncompleteTour` to /me) |
| `apps/api/prisma/seed.ts` | Modify (fix step targets to actual `data-tour` values) |

### Frontend
| File | Action |
|---|---|
| `apps/web/src/components/tour/tour-provider.tsx` | Create |
| `apps/web/src/components/tour/tour-popover.tsx` | Create |
| `apps/web/src/components/tour/tour-overlay.tsx` | Create |
| `apps/web/src/components/tour/tour-controls.tsx` | Create |
| `apps/web/src/hooks/use-tour.ts` | Create |
| `apps/web/src/stores/tour.store.ts` | Create |
| `apps/web/src/lib/tour-registry.ts` | Create |
| `apps/web/src/styles/tour.css` | Create |
| `apps/web/src/app/admin/tours/page.tsx` | Create |
| `apps/web/src/app/admin/tours/[id]/page.tsx` | Create |
| `apps/web/src/components/shared/tour-step-list.tsx` | Create |
| `apps/web/src/components/shared/tour-step-form-dialog.tsx` | Create |
| `apps/web/src/components/shared/tour-target-picker.tsx` | Create |
| `apps/web/src/app/profile/page.tsx` | Create / Modify (Restart button) |
| `apps/web/src/app/layout.tsx` | Modify (mount TourProvider) |
| `apps/web/src/components/shared/protected-route.tsx` | Modify (autostart trigger) |
| `apps/web/src/components/shared/app-sidebar.tsx` | Modify (add "Tours" nav for SUPER_ADMIN) |
| `apps/web/src/types/admin.ts` | Modify (Tour types) |
| `apps/web/package.json` | Modify (add `nextstepjs`, `framer-motion`, `@dnd-kit/core`, `@dnd-kit/sortable`, `focus-trap`) |

### Locale
| File | Action |
|---|---|
| `packages/shared/locales/en/tours.json` | Modify (populate) |
| `packages/shared/locales/id/tours.json` | Modify (populate) |

### E2E
| File | Action |
|---|---|
| `apps/web/e2e/tours.spec.ts` | Create (if Playwright already set up; else defer or run via MCP) |

## 5. API contract

### `GET /api/tours/my`
Auth: any authenticated user.
Returns: array of tour DTOs filtered by user's roles, with steps pre-filtered by permissions.

```ts
type TourDto = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  roleId: string;
  steps: TourStepDto[];      // already permission-filtered, already removed isActive=false
  progress: {                // per current user
    completedSteps: number[];
    isCompleted: boolean;
    isSkipped: boolean;
    lastStepIndex: number;
    lastSeenAt: string | null;
  } | null;
};
```

### `PUT /api/tours/:id/progress`
Body: `{ stepIndex: number, action: 'next'|'prev'|'skip'|'complete' }`
Effect:
- Upsert `UserTourProgress`
- `action='next'`: add stepIndex to completedSteps if not present
- `action='skip'`: set `isSkipped=true`
- `action='complete'`: set `isCompleted=true`
- Always update `lastSeenAt` & `lastStepIndex`

### `PUT /api/tours/:id/restart`
Resets progress for current user — `completedSteps=[]`, `isCompleted=false`, `isSkipped=false`.

### Admin (require `tours:manage`)

- `GET /api/tours` — list all tours (admin only)
- `POST /api/tours` — create tour
- `PUT /api/tours/:id` — update tour (steps JSON)
- `DELETE /api/tours/:id` — soft-delete or mark `isActive=false`
- `POST /api/tours/:id/sync` — manually re-enqueue `tour-sync` job

## 6. UI/UX dependencies summary

Packages added:
- `nextstepjs` (~10kB) — tour engine
- `framer-motion` (~30kB) — animation
- `@dnd-kit/core` + `@dnd-kit/sortable` (~20kB combined) — admin step reorder
- `focus-trap` (~4kB) — a11y focus management

Net JS bundle impact: ~65kB gzipped. Acceptable for an admin tool.

## 7. Risk register

| Risk | Mitigation |
|---|---|
| NextStep.js multi-page edge cases | Tier 4 has explicit MutationObserver + timeout; E2E test covers it |
| A11y gaps from library | Tier 3 hand-augments with focus trap, aria-*, live region; axe audit |
| Stale `data-tour` registry vs actual UI | Tier 5 starts with manual `tour-registry.ts`; Tier 8 test catches mismatches |
| Permission filter wrong (info leak) | Server-side filter (not client); unit test specifically per role |
| Tour breaks existing pages | Provider mounted at layout root; doesn't render UI unless `isActive=true`; manual smoke per page |
| Migration on `OnboardingTour.steps` shape | No migration — steps is JSONB; backward compat handled in service via Zod default-fill |
| `tour-sync` job races with manual edit | Sudah ada per-roleId jobId dedupe di Phase 11; admin edit & job tidak overlap |

## 8. Definition of Done

Phase 15 dianggap selesai bila:

- [ ] Tier 1–7 selesai, commit-able state
- [ ] `pnpm --filter api typecheck && lint && test` semua hijau
- [ ] `pnpm --filter web typecheck && lint` semua hijau
- [ ] Manual smoke checklist §8d ≥ 14/15 (tier 1 untuk yang kuning)
- [ ] axe DevTools: zero serious/critical
- [ ] Lighthouse A11y ≥ 95 saat tour aktif
- [ ] i18n-checker agent: en+id parity verified
- [ ] code-reviewer agent: zero blocking findings
- [ ] Commit history bersih (1 commit per tier, atau logical group)
- [ ] PR merged to `main`
- [ ] `docs/phases/phase-15-complete.md` written

## 9. Estimated effort

| Tier | Est. effort |
|---|---|
| 1 — Foundation | 0.5 day |
| 2 — Tour engine | 0.5 day |
| 3 — UI/UX polish | 1 day (paling lama karena animation + a11y detail) |
| 4 — Multi-page | 0.5 day |
| 5 — Admin authoring | 1 day |
| 6 — Autostart + Profile | 0.25 day |
| 7 — Locale population | 0.25 day |
| 8 — Testing | 1 day |
| 9 — Review & merge | 0.25 day |
| **Total** | **~5.25 days** |

In a focused agent dispatch (parallel tier 1 backend + tier 3 design), realistic completion: **2–3 sessions**.

## 10. Next actions if approved

1. Tier 1 dispatch — single backend-dev agent does foundation
2. Tier 2 + 3 — frontend-dev for engine + UI/UX in parallel with design refinement
3. Tier 4 — depends on tier 2/3, sequential
4. Tier 5 — parallel to tier 6
5. Tier 7 — small, can interleave
6. Tier 8 — test-writer agent throughout
7. Tier 9 — code-reviewer + i18n-checker agents
