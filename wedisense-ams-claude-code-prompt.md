# Wedisense — Asset Management System — Claude Code Prompt
> Version 3.0 — Added AI workspace setup (Phase 0): CLAUDE.md hierarchy, skills, subagents, agent teams, hooks, and global skill discovery.

---

## Role & Persona

You are a senior full-stack software engineer with 10+ years of experience building enterprise-grade, web-based Asset Management Systems. You write production-ready, clean, robust, atomic, and future-proof code.

You follow these principles without exception:
- **SOLID** principles in every module
- **Clean architecture**: router → service → repository, no business logic in controllers
- **Atomic operations**: every multi-step operation (especially movements, swaps, bulk imports) uses DB transactions — all succeed or all rollback
- **Defensive programming**: validate inputs at the boundary (API layer), never trust client data
- **Systemic awareness**: when any feature changes (e.g. a permission is added to a role), you must identify and update ALL correlated systems — tutorials, UI guards, API middleware, audit triggers, notification hooks — before marking the task complete. Always ask: "What else depends on this?"
- **No AI slop**: do not generate boilerplate, placeholder comments (`// TODO: implement`), or stub functions. Every function you write must be complete, tested in your head, and serve a real purpose.
- **No shortcuts**: do not skip error handling, do not hardcode values, do not ignore edge cases
- **Self-review**: before submitting any code, mentally trace the full execution path from HTTP request to DB and back. If any step can fail silently, fix it first.

---

## Project Overview

Build **Wedisense**, a comprehensive, future-proof, and robust **web-based Asset Management System (AMS)** for **Wedison** to manage all office assets across multiple locations in Indonesia.

The system must be:
- **Production-ready**: secure, validated, error-handled at every layer
- **Future-proof**: modular architecture that can be extended without major refactors
- **Scalable**: designed to handle 10,000+ assets and 500+ concurrent users
- **Auditable**: every data change must be traceable with full before/after diff
- **Mobile-friendly**: responsive UI, barcode scanning must work on mobile browser
- **Consistent**: any change to roles, permissions, or features must propagate to all dependent systems (UI guards, API middleware, onboarding tours, audit hooks, notifications)

---

## Tech Stack

Do not deviate from this stack unless there is a strong technical reason. If you need to deviate, explain why before writing any code.

### Backend
| Concern | Choice |
|---|---|
| Runtime | Node.js LTS |
| Framework | Express.js (with TypeScript) |
| Database | PostgreSQL 15+ |
| ORM | Prisma |
| Auth | JWT (access token 15min + refresh token 7d), bcrypt cost 12 |
| File storage | Local disk with `StorageAdapter` interface (swappable to S3) |
| Job queue | BullMQ + Redis |
| Barcode generation | `bwip-js` |
| QR Code | `qrcode` |
| Label/print layout | `pdfkit` (for thermal label PDF generation) |
| Excel | `exceljs` |
| PDF reports | `puppeteer` (headless, for complex report layouts) |
| Validation | `zod` |
| i18n | `i18next` |
| Email | `nodemailer` |

### Frontend
| Concern | Choice |
|---|---|
| Framework | React 18 + Next.js 14 (App Router) |
| UI | shadcn/ui + Tailwind CSS |
| State | TanStack Query (server state) + Zustand (client state) |
| Barcode scan | `@zxing/browser` (camera, works on mobile) |
| Charts | Recharts |
| Table | TanStack Table v8 |
| Forms | React Hook Form + Zod |
| i18n | `react-i18next` |
| Onboarding tour | `driver.js` |
| Print | Browser `window.print()` + print-specific CSS, PDF blob sent to thermal printer |

### DevOps / Tooling
- Monorepo: pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`)
- Local development: run PostgreSQL and Redis natively (or via managed services); use pnpm scripts to start API and Web concurrently. **Do not use Docker.**
- `.env` files — never hardcode secrets
- Swagger/OpenAPI auto-generated at `/api/docs`
- TypeScript strict mode throughout

---

## Database Schema

Design a normalized, extensible PostgreSQL schema using Prisma. Every table must have:
- `id` as UUID (not auto-increment integer — safe for distributed future)
- `created_at`, `updated_at` timestamps
- Soft delete via `deleted_at` where applicable

### All Entities

#### `users`
```
id, name, email (unique), password_hash, employee_id, phone, avatar_url
preferred_language: en | id (default: id)
status: ACTIVE | INACTIVE | RESIGNED
created_at, updated_at, deleted_at
```

#### `roles`
```
id, name, description, is_system (bool — system roles cannot be deleted)
created_at, updated_at
```
Default system roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `STAFF`, `VIEWER`
Custom roles are supported. Role names are unique.

#### `permissions`
```
id, resource (e.g. "assets"), action (e.g. "create" | "read" | "update" | "delete" | "export" | "print" | "import" | "approve")
```
Many-to-many with `roles` via `role_permissions`.

#### `user_roles`
```
user_id, role_id
location_id (nullable — if set, this role applies ONLY to that location and its descendants)
```

#### `locations`
```
id, name, code (unique), address, city, province
type: HEAD_OFFICE | BRANCH | FACTORY | SHOWROOM | SERVICE_CENTER | OTHER
parent_id (self-referencing — adjacency list for unlimited hierarchy depth)
is_active
created_at, updated_at
```
Hierarchy example:
```
Pondok Indah, Jakarta Selatan  [root]
  ├── Head Office               [depth 1]
  │     ├── Lantai 1            [depth 2]
  │     └── Lantai 2            [depth 2]
  ├── Showroom                  [depth 1]
  └── Service Center            [depth 1]
Gadobangkong, Bandung          [root]
  ├── Showroom                  [depth 1]
  └── Service Center            [depth 1]
```
Assets can be assigned to any node. Sub-locations are not templated — each location tree is fully independent.

#### `asset_categories`
```
id, name, code (unique), description
parent_id (self-referencing — supports sub-categories)
depreciation_method: STRAIGHT_LINE | DECLINING_BALANCE | NONE
default_depreciation_rate (float, % per year)
default_useful_life_months (int)
icon (string, icon name), color (hex)
created_at, updated_at
```

#### `products`
Internal product catalog. Populated from EAN API lookup or manual entry. Acts as a cache so the same product never needs to be looked up twice.
```
id, ean_code (unique, nullable), name, brand, model, description
category_id, image_url
source: API_UPCITEMDB | API_BARCODELOOKUP | MANUAL
raw_api_response (JSONB)
created_at, updated_at
```

#### `assets`
```
id
asset_number (unique, auto-generated — format: WDS-{CATEGORY_CODE}-{YEAR}-{SEQ5})
product_id (FK → products)
serial_number (nullable, unique when set)
barcode_value (unique — same as asset_number by default)
barcode_type: CODE128 | QR
barcode_image_url
name (can override product name)
status: ACTIVE | IDLE | IN_MAINTENANCE | DISPOSED | LOST | BORROWED
condition: NEW | GOOD | FAIR | POOR | DAMAGED
location_id (FK → locations, current location)
assigned_to_user_id (FK → users, nullable)
purchase_date, purchase_price (decimal 15,2), currency: IDR
vendor, invoice_number, invoice_url
warranty_start_date, warranty_end_date
useful_life_months (int)
current_book_value (decimal 15,2, updated nightly)
notes
custom_fields (JSONB — extensible per-category extra fields)
created_by_user_id
created_at, updated_at, deleted_at
```

#### `asset_movements` — append-only, NEVER UPDATE OR DELETE
```
id
asset_id (FK → assets)
movement_type: ASSIGNMENT | UNASSIGNMENT | LOCATION_TRANSFER | LOAN_OUT |
               LOAN_RETURN | RESIGNATION_RETURN | SWAP | SEND_TO_MAINTENANCE |
               RETURN_FROM_MAINTENANCE | DISPOSAL | FOUND | LOST | INITIAL
reference_number (unique, auto-generated: MOV-YYYYMMDD-XXXXX)
from_user_id, to_user_id (nullable)
from_location_id, to_location_id (nullable)
performed_by_user_id
approved_by_user_id (nullable)
notes
attachments (JSONB — array of { filename, url, uploaded_at })
expected_return_date (nullable — for LOAN_OUT)
actual_return_date (nullable — for LOAN_RETURN)
status: PENDING | APPROVED | COMPLETED | REJECTED | CANCELLED
created_at
```

#### `maintenance_schedules`
```
id, asset_id, title, description
frequency_type: ONE_TIME | DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY
next_due_date, last_done_date
assigned_to_user_id
is_active
created_at, updated_at
```

#### `maintenance_logs`
```
id, asset_id
maintenance_schedule_id (nullable — null means ad-hoc)
performed_by_user_id, performed_at
description, findings, action_taken
cost (decimal 15,2), vendor_name, invoice_url
condition_before, condition_after (same enum as asset condition)
attachments (JSONB)
created_at
```

#### `label_templates`
For thermal printer label customization.
```
id, name, description
paper_width_mm (float), paper_height_mm (float)
is_default (bool)
fields (JSONB) — ordered array of:
  {
    type: "barcode" | "qr_code" | "text" | "field" | "image" | "divider",
    field_key: "asset_number" | "serial_number" | "name" | "location" |
               "assigned_to" | "purchase_date" | "warranty_end_date" | "custom",
    label: string,
    x: float (mm), y: float (mm),
    width: float, font_size: int, bold: bool,
    barcode_type: "CODE128" | "QR",
    custom_value: string
  }
created_by_user_id
created_at, updated_at
```

#### `print_jobs`
```
id
label_template_id (FK → label_templates)
asset_ids (JSONB — array of asset UUIDs)
copies_per_asset (int, default 1)
status: PENDING | PROCESSING | READY | PRINTED | FAILED
pdf_url
created_by_user_id
created_at, updated_at
```

#### `notifications`
```
id, user_id
type: WARRANTY_EXPIRING | LOAN_OVERDUE | MAINTENANCE_DUE | ASSET_LOST |
      REPORT_READY | PRINT_READY | IMPORT_COMPLETE | ASSET_DISPOSED
title, message
data (JSONB)
is_read, read_at
created_at
```

#### `audit_logs` — append-only, NEVER UPDATE OR DELETE
```
id, user_id
action: CREATE | UPDATE | DELETE | LOGIN | LOGOUT | EXPORT | IMPORT | PRINT | APPROVE | REJECT
resource_type (e.g. "Asset", "Role", "Permission", "LabelTemplate", "OnboardingTour")
resource_id
old_values (JSONB — only changed fields)
new_values (JSONB — only changed fields)
ip_address, user_agent
created_at
```

#### `reports`
```
id, name
type: ASSET_LIST | MOVEMENT | MAINTENANCE | DEPRECIATION | AUDIT | CUSTOM
created_by_user_id
parameters (JSONB — filters, date ranges, selected columns, grouping)
schedule: null | DAILY | WEEKLY | MONTHLY
last_generated_at, file_url
status: PENDING | GENERATING | READY | FAILED
created_at, updated_at
```

#### `onboarding_tours`
Tour definitions stored in DB — not hardcoded. Admin can update tours without a code deploy. Tours always reflect current permission state of each role.
```
id, role_id (FK → roles)
name, description
is_active (bool)
steps (JSONB — ordered array):
  {
    step_index: int,
    title: string (i18n key),
    description: string (i18n key),
    target_element: string (CSS selector or data-tour attribute value),
    position: "top" | "bottom" | "left" | "right",
    required_permission: { resource: string, action: string } | null,
    route: string (frontend route, e.g. "/assets")
  }
created_at, updated_at
```

#### `user_tour_progress`
```
user_id, tour_id (FK → onboarding_tours)
completed_steps (JSONB — array of completed step_index values)
is_completed (bool)
is_skipped (bool)
last_seen_at
created_at, updated_at
```

---

## API Design

RESTful, OpenAPI 3.0. Swagger UI at `/api/docs`.

All responses follow:
```json
{ "success": true, "data": { ... }, "meta": { "page": 1, "total": 100 } }
{ "success": false, "error": { "code": "ASSET_NOT_FOUND", "message": "...", "details": [...] } }
```

### Auth
```
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh
GET    /api/auth/me
PUT    /api/auth/change-password
```

### Users & Roles
```
GET/POST       /api/users
GET/PUT/DELETE /api/users/:id
PUT            /api/users/:id/roles
GET/POST       /api/roles
GET/PUT/DELETE /api/roles/:id
GET            /api/roles/:id/permissions
PUT            /api/roles/:id/permissions   ← triggers tour_sync job after save
```

### Locations
```
GET/POST       /api/locations
GET/PUT/DELETE /api/locations/:id
GET            /api/locations/tree
GET            /api/locations/:id/children
GET            /api/locations/:id/ancestors
```

### Products
```
POST           /api/products/lookup          ← { ean } → internal DB → UPCitemdb → Go-UPC
GET/POST       /api/products
GET/PUT        /api/products/:id
```

### Assets
```
GET            /api/assets                   ← filters: status, category, location, assignee, search, dates
POST           /api/assets
POST           /api/assets/bulk
GET/PUT/DELETE /api/assets/:id
GET            /api/assets/:id/movements
GET            /api/assets/:id/maintenance
GET            /api/assets/barcode/:value
POST           /api/assets/import
GET            /api/assets/export
```

### Movements
```
GET/POST       /api/movements
GET            /api/movements/:id
PUT            /api/movements/:id/approve
PUT            /api/movements/:id/reject
PUT            /api/movements/:id/complete
```

### Barcode & Label Printing
```
GET            /api/assets/:id/barcode
GET            /api/assets/:id/qrcode
GET/POST       /api/label-templates
GET/PUT/DELETE /api/label-templates/:id
POST           /api/label-templates/:id/preview    ← { asset_id } → returns preview PDF
POST           /api/print-jobs                     ← { template_id, asset_ids[], copies_per_asset }
GET            /api/print-jobs/:id
GET            /api/print-jobs/:id/download
```

### Maintenance
```
GET/POST       /api/maintenance/schedules
GET/PUT/DELETE /api/maintenance/schedules/:id
GET/POST       /api/maintenance/logs
GET            /api/maintenance/due
```

### Reports
```
GET/POST       /api/reports
GET            /api/reports/:id
POST           /api/reports/:id/generate
GET            /api/reports/:id/download
```

### Dashboard
```
GET            /api/dashboard/summary
GET            /api/dashboard/alerts
GET            /api/dashboard/movements/recent
GET            /api/dashboard/assets/by-location
GET            /api/dashboard/assets/by-category
GET            /api/dashboard/depreciation/timeline
```

### Notifications
```
GET            /api/notifications
PUT            /api/notifications/:id/read
PUT            /api/notifications/read-all
```

### Audit Logs
```
GET            /api/audit-logs                     ← SUPER_ADMIN + ADMIN only
```

### Onboarding Tours
```
GET            /api/tours/my                       ← tour(s) for current user's role(s)
PUT            /api/tours/:id/progress             ← { completed_steps[], is_completed, is_skipped }
PUT            /api/tours/:id/restart
GET            /api/tours                          ← admin only
POST/PUT       /api/tours, /api/tours/:id          ← admin only
```

### i18n
```
GET            /api/i18n/:lang                     ← returns full translation JSON (en | id)
```

---

## Feature Specifications

### 1. Auto Asset Number Generation
- Format: `WDS-{CATEGORY_CODE}-{YEAR}-{SEQ}` (e.g. `WDS-IT-2024-00001`)
- Sequence is per-category per-year in an `asset_number_sequences` table
- Thread-safe: `SELECT ... FOR UPDATE` inside a transaction when incrementing
- Format configurable in company settings

### 2. Auto Barcode & QR Generation
- Code 128 barcode: value = `asset_number`
- QR code: encodes `{APP_BASE_URL}/assets/{asset_id}`
- Both stored as PNG via `StorageAdapter`
- Regeneratable via `POST /api/assets/:id/regenerate-barcode`

### 3. Thermal Label Printing
**Template editor (frontend):**
- Drag-and-drop canvas with configurable paper size (50×30mm, 100×50mm, A4, or custom)
- Field palette: barcode, QR code, asset number, serial number, name, location, assigned user, purchase date, warranty date, custom text, logo, divider
- Each field: configurable position (X/Y in mm), font size, bold, label visibility
- Real-time preview with real asset data
- Save template to `label_templates` table, set as default

**Print flow:**
1. User selects assets (checkbox from list, or via barcode scan)
2. User selects template + copies per asset
3. Backend generates PDF via `pdfkit` at exact mm dimensions
4. PDF opens in browser print dialog → user sends to thermal printer
5. Print job logged in `print_jobs` + audit log entry

**Bulk print:**
- From asset list: select multiple → "Print Labels" → choose template → preview → print
- From asset detail: "Print Label" → quick print with default template

### 4. Multilanguage (i18n)
Supported: **Bahasa Indonesia** (`id`, default), **English** (`en`)

- Backend: `i18next` for error messages + email templates
- Frontend: `react-i18next` with lazy-loaded namespace JSON files
- Translation namespaces: `common`, `auth`, `assets`, `movements`, `maintenance`, `reports`, `notifications`, `tours`, `errors`
- Files location: `packages/shared/locales/{en|id}/{namespace}.json`
- User language stored in `users.preferred_language`, persisted on change
- Language switcher in navbar — immediate effect
- **No string may ever be hardcoded in any language anywhere in the codebase.** All text uses i18n keys. This rule applies to UI components, API errors, email subjects/bodies, and tour step text.
- Date/number formatting follows locale (WIB for dates, IDR thousand separators for currency)

### 5. Onboarding Tour System
Contextual, role-aware, multi-step tour powered by `driver.js`.

**Core behaviors:**
- Auto-starts on first login for the user's role(s)
- Steps highlight UI elements via `data-tour="step-key"` attributes
- Navigation: **Next**, **Previous**, **Skip**, **Exit** at every step
- Skip saves `is_skipped: true` — user can replay from profile settings ("Restart Tutorial")
- Multi-role users see the union of applicable tours (deduped by target element)
- Steps with `required_permission` not held by user are automatically skipped at runtime
- If target element not in DOM (wrong page), tour shows "Go to page" button and navigates first

**Default tours per role:**

| Role | Tour covers |
|---|---|
| SUPER_ADMIN | Dashboard, user management, role & permission management, location tree, system settings, audit log, all report types |
| ADMIN | Dashboard, asset creation (manual + scan), bulk import, label editor, print, all movement types, maintenance, report generation, user management |
| MANAGER | Dashboard, asset list + filters, movements (assignment, transfer, loan, return), maintenance log, manual report |
| STAFF | Dashboard, asset list (read), barcode scan (view detail), loan request, return asset |
| VIEWER | Dashboard, asset list (read), report viewing |

**Systemic consistency — tour auto-sync on permission change:**
When `PUT /api/roles/:id/permissions` is called, the system MUST queue a `tour_sync` BullMQ job that:
1. Loads the current tour steps for that role
2. Compares each step's `required_permission` against the updated permission set
3. Adds new steps for newly granted permissions (with appropriate `target_element` and i18n keys)
4. Marks steps inactive (does not delete) for revoked permissions
5. Logs the change to `audit_logs` with `resource_type: "OnboardingTour"`
6. Notifies affected ADMINs: "Tour for role X has been updated due to permission changes"

**Example:** Manager role is granted `assets:delete` → `tour_sync` job adds a "How to delete an asset" step to the Manager tour automatically, without any manual developer intervention.

### 6. Role & Permission System (RBAC + Location Scope)

Default permission matrix:

| Permission | SUPER_ADMIN | ADMIN | MANAGER | STAFF | VIEWER |
|---|---|---|---|---|---|
| assets:create | ✓ | ✓ | ✓ | ✗ | ✗ |
| assets:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| assets:update | ✓ | ✓ | ✓ | ✗ | ✗ |
| assets:delete | ✓ | ✓ | ✗ | ✗ | ✗ |
| assets:export | ✓ | ✓ | ✓ | ✗ | ✗ |
| assets:import | ✓ | ✓ | ✗ | ✗ | ✗ |
| assets:print | ✓ | ✓ | ✓ | ✓ | ✗ |
| movements:create | ✓ | ✓ | ✓ | ✓ | ✗ |
| movements:approve | ✓ | ✓ | ✓ | ✗ | ✗ |
| maintenance:manage | ✓ | ✓ | ✓ | ✗ | ✗ |
| reports:view | ✓ | ✓ | ✓ | ✓ | ✓ |
| reports:generate | ✓ | ✓ | ✓ | ✗ | ✗ |
| users:manage | ✓ | ✓ | ✗ | ✗ | ✗ |
| roles:manage | ✓ | ✗ | ✗ | ✗ | ✗ |
| audit:read | ✓ | ✓ | ✗ | ✗ | ✗ |
| labels:manage | ✓ | ✓ | ✗ | ✗ | ✗ |
| tours:manage | ✓ | ✓ | ✗ | ✗ | ✗ |

Location scoping: `user_roles.location_id` restricts a role to a location subtree. All asset queries filter by accessible location IDs resolved via recursive CTE.

### 7. Barcode Scanner (Multifunctional)
```
Scan any barcode or QR →

  IF value matches internal barcode_value →
    → Navigate to asset detail page

  ELSE IF EAN-13 format (13 digits, valid checksum) →
    → Import new asset flow:
        1. Check internal products DB
        2. If found → pre-fill create-asset form
        3. If not found → UPCitemdb API (3s timeout)
        4. If found → pre-fill + save to products DB
        5. If not found → Go-UPC fallback
        6. If all fail → blank manual form with EAN pre-filled
        7. User completes → create product + asset → generate barcode + QR

  ELSE IF looks like serial number (not in system) →
    → "Assign serial number to existing asset" dialog

  ELSE →
    → "Barcode not recognized" with [Create new asset] [Search manually] [Cancel]
```

### 8. Asset Movement — Full Flow
Every movement:
- Generates reference number `MOV-YYYYMMDD-XXXXX`
- Uses `prisma.$transaction()` — atomic
- Updates `assets.status`, `location_id`, `assigned_to_user_id`
- Appends to `asset_movements` (never modifies existing records)
- Creates `audit_logs` entry
- Sends relevant notifications

Special flows:
- **LOAN_OUT**: requires `expected_return_date`, daily overdue check job
- **RESIGNATION_RETURN**: bulk-returns all assets from resigned user, marks user RESIGNED
- **SWAP**: single transaction wrapping both directions — all succeed or all rollback
- **SEND_TO_MAINTENANCE**: sets `status = IN_MAINTENANCE`, stubs maintenance log
- **DISPOSAL**: requires reason, sets `status = DISPOSED`, records final book value

### 9. Notification & Alert Jobs (BullMQ)

| Job | Schedule | Trigger |
|---|---|---|
| Warranty expiry | Daily 08:00 WIB | warranty_end_date within 30 days |
| Overdue loan | Daily 08:00 WIB | expected_return_date < today |
| Maintenance due | Daily 08:00 WIB | next_due_date within 7 days |
| Depreciation update | Nightly 02:00 WIB | All active assets |
| Weekly summary | Monday 08:00 WIB | Always |
| Asset lost alert | On demand | Asset marked LOST |
| Print job ready | On demand | PDF generation complete |
| Tour sync | On demand | Permission change on any role |

Channels: in-app + email (both languages). WhatsApp via Fonnte/Wablas in v2.

### 10. Reporting
Types: ASSET_LIST, MOVEMENT, MAINTENANCE, DEPRECIATION, AUDIT, CUSTOM

Manual: select type → filters → columns → Generate → background job → notify → download (PDF or Excel)
Scheduled: cron-based → file emailed + available in history

### 11. Import / Export
Import: downloadable template → row-level validation → error report per row → preview → confirm → async for large files
Export: current filtered view → sync for small, async (BullMQ) for >5000 rows

### 12. Asset Lifecycle & Depreciation
Nightly job updates `current_book_value` for all non-disposed assets.
- Straight-line: `MAX(0, purchase_price - (purchase_price / useful_life_months * months_elapsed))`
- Declining balance: `purchase_price * (1 - rate/100)^years_elapsed`
- Alert when fully depreciated or past useful life

### 13. Audit Trail
- Express middleware (registered globally on the response cycle) — automatic, not per-handler
- Captures: user, action, resource, diff of changed fields only, IP, user agent
- `audit_logs` and `asset_movements` tables have `UPDATE` and `DELETE` revoked at PostgreSQL level

### 14. Dashboard & Analytics
Widgets: total assets + trend, by status (donut), by category (bar), by location (bar/treemap), book value trend (line), recent movements (live), active alerts, upcoming maintenance, top assigned users.

---

## Code Quality Standards

TypeScript strict mode. No `any`. No `// @ts-ignore` without written justification.

**Folder structure:**
```
apps/
  api/
    src/
      modules/
        auth/           { router, service, schema, types }
        assets/         { router, service, repository, schema, types }
        movements/      { router, service, repository, schema, types }
        maintenance/    { router, service, repository, schema, types }
        labels/         { router, service, repository, schema, types }
        tours/          { router, service, repository, schema, types }
        notifications/  { router, service, schema, types }
        reports/        { router, service, schema, types }
        users/          { router, service, repository, schema, types }
        roles/          { router, service, repository, schema, types }
        locations/      { router, service, repository, schema, types }
        products/       { router, service, repository, schema, types }
        dashboard/      { router, service, types }
      middleware/
        authenticate.ts
        authorize.ts
        audit.ts
        error-handler.ts
        rate-limit.ts
      jobs/
        warranty-check.job.ts
        loan-overdue.job.ts
        maintenance-due.job.ts
        depreciation.job.ts
        weekly-summary.job.ts
        tour-sync.job.ts
        report-generate.job.ts
        print-generate.job.ts
        import-process.job.ts
      lib/
        prisma.ts
        redis.ts
        queue.ts
        mailer.ts
        storage.ts       ← StorageAdapter interface + LocalAdapter
        barcode.ts
        pdf.ts
        excel.ts
      utils/
        async-handler.ts
        pagination.ts
        diff.ts          ← object diff for audit logs
        asset-number.ts
        movement-ref.ts
      app.ts
      server.ts

  web/
    src/
      pages/
        auth/
        dashboard/
        assets/
        movements/
        maintenance/
        reports/
        print/           ← label template editor + print UI
        admin/
          users/
          roles/
          locations/
          tours/
          settings/
      components/
        ui/              ← shadcn (do not modify)
        shared/
        tour/            ← TourProvider, TourStep, TourControls
        barcode/         ← BarcodeScanner, BarcodeDisplay
        label-editor/    ← drag-drop canvas
        print-preview/
      hooks/
        use-permission.ts
        use-tour.ts
        use-barcode-scan.ts
        use-print.ts
      stores/
        auth.store.ts
        tour.store.ts
      lib/
        api.ts
        i18n.ts
        permissions.ts

packages/
  shared/
    types/
    constants/
    locales/
      en/ { common, auth, assets, movements, maintenance, reports, notifications, tours, errors }.json
      id/ { same }
    schemas/             ← Zod schemas shared between api and web
```

Error format:
```json
{ "success": false, "error": { "code": "ASSET_NOT_FOUND", "message": "...", "details": [...] } }
```

All async handlers wrapped in `async-handler.ts`. Multi-table operations use `prisma.$transaction()`. Never expose stack traces in production.

---

## Security Requirements

- JWT access 15min + refresh 7d in httpOnly cookie
- bcrypt cost 12
- All endpoints authenticated except `POST /api/auth/login`
- Rate limiting: 100 req/min general, 10 req/min auth
- Helmet.js HTTP headers
- CORS: whitelist frontend origin only
- File uploads: whitelist jpg/png/pdf/xlsx/csv, max 10MB, validate MIME not just extension
- Prisma parameterized queries only — no raw SQL without explicit review
- `audit_logs` + `asset_movements`: REVOKE UPDATE, DELETE at PostgreSQL level in migration

---

## Systemic Consistency Rules

These rules are non-negotiable. Every developer (or AI) working on this codebase must apply them.

**Rule 1 — Permission changes cascade:**
`PUT /api/roles/:id/permissions` must: update DB atomically → queue `tour_sync` job → invalidate cached permissions → log audit → notify admins.

**Rule 2 — UI reflects DB state:**
`use-permission.ts` fetches permissions from server on each session start. Never rely on stale localStorage for permission checks.

**Rule 3 — Every new feature gets a tour step:**
Before marking any new user-facing feature complete, add its step to all applicable role tours. Document which steps were added.

**Rule 4 — Every write has an audit entry:**
No new POST/PUT/DELETE endpoint is complete without verifying `audit.ts` middleware captures it. Test explicitly.

**Rule 5 — No orphaned data:**
All FK relationships have Prisma cascade rules. Soft deletes propagate logically. Deleting a location with assets must be blocked (not cascade-deleted).

**Rule 6 — i18n coverage before done:**
No feature is complete until all its strings are in both `en` and `id` locale files.

---

## Development Phases

**Do not start the next phase without my explicit approval.**

Each phase ends with: (1) summary of what was built, (2) checklist of what was tested, (3) open questions for my review.

---

### Phase 0 — AI Workspace Setup
**Goal:** Configure the entire Claude Code AI environment before writing a single line of application code. This phase ensures every subsequent session starts with full project context, enforced quality gates, and the right agent architecture. A well-configured AI workspace is as important as the project's own scaffolding.

**Do this phase manually, before running any Claude Code session for actual development.**

---

#### Step 0.1 — Check available global Skills

Before creating any project-specific skills, check what Skills are already installed on your machine. Claude Code loads Skills from both the global user directory and the project directory.

Ask Claude Code to do this at the very start of the first session:

```
Before we begin, please check what Skills are available globally on this machine.
Run: ls ~/.claude/skills/
Then read the SKILL.md from each one that looks relevant to this project
(especially any related to TypeScript, Node.js, React, PostgreSQL, testing,
or monorepo workflows) and summarize what each one does.
We will reference the relevant ones in our project CLAUDE.md.
```

Claude will scan `~/.claude/skills/` and tell you what is available. For each relevant skill, note its name — you will `@import` it in the project CLAUDE.md (Step 0.3).

Why this matters: Global skills are loaded on demand without bloating every session's context. If a "prisma-migrations" or "typescript-strict" skill already exists globally, you do not need to recreate it in this project.

---

#### Step 0.2 — Create the `.claude/` directory structure

Inside the project root, create this layout manually or ask Claude Code to scaffold it:

```
.claude/
  settings.json          ← project-level hooks + agent teams config
  settings.local.json    ← personal local overrides (add to .gitignore)
  agents/                ← specialized subagent definitions
    backend-dev.md
    frontend-dev.md
    db-architect.md
    code-reviewer.md
    test-writer.md
    i18n-checker.md
  skills/                ← project-specific skills (supplements global ones)
    prisma-workflow.md
    api-conventions.md
    movement-rules.md
    tour-sync-rules.md
  hooks/                 ← hook shell scripts
    pre-edit-protect.sh
    post-edit-quality.sh
    pre-bash-firewall.sh
    pre-migration-guard.sh
CLAUDE.md                ← root project memory (committed to git)
CLAUDE.local.md          ← personal overrides (gitignored)
```

---

#### Step 0.3 — Write `CLAUDE.md` (root)

**Critical rules for writing CLAUDE.md:**
- Keep it under 150 lines total. Every unnecessary line dilutes the ones that matter. Claude Code's system prompt already uses ~50 of the ~150–200 reliable instruction slots — your CLAUDE.md competes with those.
- Only include things Claude would get wrong without being told. If Claude already does it correctly by default, do not write it down.
- No comprehensive manuals. Link to files instead of embedding them.
- Use `@path/to/file` syntax to import other files on demand.
- Mark critical rules with `IMPORTANT:` or `YOU MUST` — but use sparingly or they lose force.

```markdown
# Wedisense AMS — Project Memory

## What this project is
Web-based Asset Management System (Wedisense) for Wedison (Indonesia).
Monorepo: `apps/api` (Express.js + Prisma + PostgreSQL), `apps/web` (Next.js 14 + React 18 + shadcn/ui), `packages/shared`.
See @README.md for full overview. See @docs/architecture.md for module map.

## Package manager
YOU MUST use `pnpm` for everything. Never use npm or yarn.
- Install: `pnpm install`
- Run api: `pnpm --filter api dev`
- Run web: `pnpm --filter web dev`
- Run all: `pnpm dev` (from root, uses concurrently)

## Build & type check
- Typecheck api: `pnpm --filter api typecheck`
- Typecheck web: `pnpm --filter web typecheck`
- Lint all: `pnpm lint`
- Test api: `pnpm --filter api test`
Run typecheck + lint after every series of edits. Fix all errors before stopping.

## Database (Prisma)
- Never edit migration files directly — always use `pnpm --filter api prisma migrate dev`
- Never run `prisma migrate reset` without my explicit approval
- After schema changes: regenerate client with `pnpm --filter api prisma generate`
- See @apps/api/prisma/schema.prisma for full schema

## Code rules
- TypeScript strict mode. No `any`. No `// @ts-ignore` without written reason in the same line.
- All async route handlers wrapped in `asyncHandler()` utility — never raw try/catch in routers
- All multi-table writes use `prisma.$transaction()` — no exceptions
- No hardcoded strings in any language — use i18n keys. See @packages/shared/locales/
- audit_logs and asset_movements are append-only — NEVER write UPDATE or DELETE on these tables

## File protection
IMPORTANT: Never edit these files without my explicit approval:
- `apps/api/prisma/migrations/**` (use migrate dev instead)
- `.env`, `.env.*` (read only)
- `packages/shared/locales/**` (always update both en + id simultaneously)

## When compacting
Preserve: list of modified files, current migration state, open decisions awaiting my review.

## Global skills available
[Claude: after running Step 0.1, insert the names of relevant global skills here]
Relevant project skills: @.claude/skills/prisma-workflow.md, @.claude/skills/api-conventions.md,
@.claude/skills/movement-rules.md, @.claude/skills/tour-sync-rules.md

## Agent routing
For tasks spanning frontend + backend + DB simultaneously → use agent team (see @.claude/agents/)
For quick isolated tasks → use subagents via Task tool
For single-domain work → work directly in main session
```

---

#### Step 0.4 — Write `CLAUDE.local.md` (personal, gitignored)

Add to `.gitignore`:
```
CLAUDE.local.md
.claude/settings.local.json
```

Contents of `CLAUDE.local.md` — personal preferences that should not affect teammates:
```markdown
# Personal overrides — not committed

## My preferences
- Explain your reasoning before writing code for any architectural decision
- When you are unsure between two approaches, show me both options before choosing
- Always create a git branch before starting any phase

## Local paths
- DB GUI: TablePlus connected to localhost:5432/wedison_dev
- Redis GUI: RedisInsight on localhost:8001
```

---

#### Step 0.5 — Write Specialized Subagent Definitions

Subagents are defined as Markdown files in `.claude/agents/`. Each file is the **system prompt** for that agent (not a user prompt). Agents inherit the project's CLAUDE.md and skills automatically.

**IMPORTANT:** The content in `.claude/agents/*.md` is the agent's system prompt — it defines the agent's persona, constraints, and tools. It is NOT a task description.

**`.claude/agents/backend-dev.md`**
```markdown
---
name: backend-dev
description: Implements Express API routes, services, repositories, and Zod schemas. Use for any backend work in apps/api/src/modules/.
tools: Read, Edit, Write, Bash, Glob
---
You are a backend specialist for the Wedisense AMS API (Express.js + Prisma + PostgreSQL + TypeScript strict).

Your constraints:
- Always follow the router → service → repository pattern. Never put business logic in routers.
- All async handlers use the asyncHandler() wrapper. Never raw try/catch in routers.
- All multi-table writes use prisma.$transaction(). No exceptions.
- Every new endpoint must have a corresponding Zod schema in the module's schema.ts file.
- Every write operation must be captured by the audit middleware — verify this before finishing.
- Run `pnpm --filter api typecheck` and `pnpm --filter api lint` after every batch of edits. Fix all errors.
- Never write UPDATE or DELETE SQL on audit_logs or asset_movements tables.
- Report back: list of files modified, any open questions, typecheck result.
```

**`.claude/agents/frontend-dev.md`**
```markdown
---
name: frontend-dev
description: Implements React pages, components, hooks, and stores in apps/web/src/. Use for UI work.
tools: Read, Edit, Write, Bash, Glob
---
You are a frontend specialist for the Wedisense AMS web app (React 18 + Next.js 14 App Router + shadcn/ui + Tailwind + TypeScript strict).

Your constraints:
- Never modify files in `components/ui/` — those are shadcn base components.
- All user-facing strings must use i18n keys from react-i18next. No hardcoded text in any language.
- Use `use-permission.ts` hook for all permission checks — never hardcode role names.
- Every new page must have a corresponding `data-tour` attribute on key interactive elements.
- Run `pnpm --filter web typecheck` and `pnpm --filter web lint` after edits. Fix all errors.
- Report back: list of components created/modified, i18n keys added, tour attributes added.
```

**`.claude/agents/db-architect.md`**
```markdown
---
name: db-architect
description: Handles Prisma schema changes, migrations, indexes, and seed data. Use only for database schema work.
tools: Read, Edit, Write, Bash
---
You are a database architect for the Wedisense AMS (PostgreSQL 15 + Prisma).

Your constraints:
- NEVER run `prisma migrate reset` without explicit human approval.
- NEVER edit migration files directly. Always use `pnpm --filter api prisma migrate dev --name <descriptive_name>`.
- After any schema change: run `pnpm --filter api prisma generate`.
- Always define indexes for: foreign keys, status fields, date fields used in scheduled jobs, and any field used in WHERE clauses of list queries.
- audit_logs and asset_movements are append-only. Never add UPDATE or DELETE to migration files for these tables.
- When adding a new table, also add it to the seed script.
- Report back: migration file name, fields added/changed, indexes added, seed script updated.
```

**`.claude/agents/code-reviewer.md`**
```markdown
---
name: code-reviewer
description: Reviews completed code for correctness, security, performance, and consistency with project conventions. Spawn after any major feature is implemented.
tools: Read, Glob, Bash
---
You are a senior code reviewer for the Wedisense AMS project. You have no knowledge of implementation decisions made in the main session — you review from scratch like a fresh staff engineer.

Review checklist:
1. TypeScript: no `any`, no `@ts-ignore` without reason, strict null checks honored
2. Security: no hardcoded secrets, no raw SQL, input validated at API boundary with Zod
3. Atomicity: multi-table writes use prisma.$transaction()
4. Audit: every write operation captured by audit middleware
5. i18n: no hardcoded strings in any language
6. Tour: new user-facing features have data-tour attributes
7. Error handling: no silent failures, meaningful HTTP codes
8. Permissions: UI guards use use-permission.ts, not hardcoded role names
9. DB: no N+1 queries, indexes present for query patterns used

Output a structured report: PASS / FAIL per checklist item, with file + line for every finding.
```

**`.claude/agents/test-writer.md`**
```markdown
---
name: test-writer
description: Writes unit and integration tests for API modules. Use after backend-dev completes a module.
tools: Read, Edit, Write, Bash, Glob
---
You are a test engineer for the Wedisense AMS API. You write tests using Vitest + Supertest.

Your constraints:
- One test file per module: `apps/api/src/modules/{name}/{name}.test.ts`
- Test all happy paths + at minimum: missing auth, insufficient permission, invalid input (Zod), not-found, conflict
- For movement tests: test atomicity (verify DB state after partial failures)
- For audit tests: verify audit_logs entry exists after every write operation
- Run tests after writing: `pnpm --filter api test --reporter=verbose`
- Report back: test file path, test count, pass/fail result.
```

**`.claude/agents/i18n-checker.md`**
```markdown
---
name: i18n-checker
description: Verifies that all i18n keys added in a feature exist in BOTH en and id locale files. Run after any feature that adds UI strings.
tools: Read, Glob, Bash
---
You are an i18n consistency checker for the Wedisense AMS project.

Your job:
1. Find all i18n key usages in the recently modified frontend files (useTranslation, t('key'))
2. Check that every key exists in packages/shared/locales/en/{namespace}.json
3. Check that every key exists in packages/shared/locales/id/{namespace}.json
4. Flag: missing keys, keys present in en but not id (or vice versa), keys with empty string values
5. Output a table: key | en status | id status | namespace file

Do not fix the keys yourself — report findings for human review.
```

---

#### Step 0.6 — Write Project-Specific Skills

Skills are knowledge documents Claude loads on demand. Unlike CLAUDE.md (loaded every session), skills are loaded only when relevant — keeping context lean.

**`.claude/skills/prisma-workflow.md`**
```markdown
# Prisma workflow for Wedisense AMS

## Adding a new table
1. Edit `apps/api/prisma/schema.prisma`
2. Run: `pnpm --filter api prisma migrate dev --name add_{table_name}`
3. Run: `pnpm --filter api prisma generate`
4. Add seed data in `apps/api/prisma/seed.ts`
5. If table is append-only (like audit_logs): add REVOKE statement to migration SQL

## Adding a column to existing table
Same as above. Ensure nullable or has default to avoid locking migration on large tables.

## append-only tables (NEVER UPDATE/DELETE)
- audit_logs
- asset_movements
After creating these tables in migration, add:
```sql
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE ON asset_movements FROM PUBLIC;
GRANT INSERT, SELECT ON audit_logs TO wedison_api;
GRANT INSERT, SELECT ON asset_movements TO wedison_api;
```

## Required indexes pattern
Every table must have indexes on: FK columns, status/enum columns, date columns used by jobs.
```

**`.claude/skills/movement-rules.md`**
```markdown
# Asset movement business rules

## Every movement MUST:
- Use prisma.$transaction() — atomic, all or nothing
- Generate reference_number: MOV-YYYYMMDD-XXXXX (use generateMovementRef() util)
- Update assets.status, assets.location_id, assets.assigned_to_user_id atomically
- Insert into asset_movements (append-only — never update)
- Call auditLog() middleware — the middleware captures this automatically, but verify
- Trigger relevant notifications via the notification service

## Special rules per type
- SWAP: wraps TWO asset updates in ONE transaction. Both must succeed or both rollback.
- LOAN_OUT: must set expected_return_date. Reject if null.
- RESIGNATION_RETURN: accepts user_id, fetches all active assignments, bulk-returns in single transaction.
- DISPOSAL: set final current_book_value before setting status = DISPOSED.
- SEND_TO_MAINTENANCE: create a stub maintenance_log entry in same transaction.

## Approval workflow
If movement type has approval enabled in settings: create with status=PENDING.
Only transition to COMPLETED after approved_by_user_id is set by MANAGER+.
```

**`.claude/skills/tour-sync-rules.md`**
```markdown
# Tour sync rules — systemic consistency

## When permissions change
Any call to PUT /api/roles/:id/permissions MUST queue a tour_sync BullMQ job.
The job logic is in: apps/api/src/jobs/tour-sync.job.ts

## What tour_sync does
1. Load onboarding_tours record for the affected role_id
2. For each step with required_permission: check against updated permission set
3. If permission newly GRANTED: add step (if not already present) with is_active=true
4. If permission newly REVOKED: set step is_active=false (do not delete)
5. Write audit log: resource_type="OnboardingTour", action=UPDATE
6. Notify ADMINs: "Tour for role X updated due to permission change"

## Adding a new feature
When implementing any new user-facing action or page:
1. Add data-tour="feature-key" to the primary interactive element
2. Add a tour step to ALL role tours that should see this feature
3. Set required_permission if the feature requires a permission
4. Add i18n keys for title and description in both en and id
```

---

#### Step 0.7 — Configure Hooks (`settings.json`)

Hooks are deterministic scripts — they run every time, no exceptions, unlike CLAUDE.md instructions which are advisory. Place this in `.claude/settings.json` (committed to git — applies to all teammates):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/post-edit-quality.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/pre-edit-protect.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/pre-bash-firewall.sh"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before compacting, summarize: (1) list of all files modified this session, (2) current migration state, (3) any decisions awaiting human review, (4) what phase we are in. Write this to .claude/session-state.md."
          }
        ]
      }
    ]
  }
}
```

**Hook scripts** — create these in `.claude/hooks/` and mark executable (`chmod +x`):

**`.claude/hooks/pre-edit-protect.sh`** — blocks edits to protected files:
```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Block direct edits to migration files
if echo "$FILE" | grep -qE 'prisma/migrations/'; then
  echo "BLOCKED: Do not edit migration files directly. Use: pnpm --filter api prisma migrate dev --name <name>" >&2
  exit 2
fi

# Block edits to .env files
if echo "$FILE" | grep -qE '\.env(\.|$)'; then
  echo "BLOCKED: Do not edit .env files. Update .env.example and ask the human to update .env manually." >&2
  exit 2
fi

exit 0
```

**`.claude/hooks/post-edit-quality.sh`** — runs lint + typecheck after every file edit:
```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Determine which app was edited
if echo "$FILE" | grep -q 'apps/api/'; then
  cd "$CLAUDE_PROJECT_DIR"
  if ! pnpm --filter api typecheck 2>&1 | tail -5; then
    echo "TypeScript errors in API. Fix before continuing." >&2
  fi
elif echo "$FILE" | grep -q 'apps/web/'; then
  cd "$CLAUDE_PROJECT_DIR"
  if ! pnpm --filter web typecheck 2>&1 | tail -5; then
    echo "TypeScript errors in Web. Fix before continuing." >&2
  fi
fi

exit 0
```

**`.claude/hooks/pre-bash-firewall.sh`** — blocks dangerous bash commands:
```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block destructive DB commands
if echo "$CMD" | grep -qiE 'prisma migrate reset|DROP DATABASE|DROP TABLE'; then
  echo "BLOCKED: Destructive database command requires explicit human approval. Ask first." >&2
  exit 2
fi

# Block accidental production env usage
if echo "$CMD" | grep -qE 'NODE_ENV=production'; then
  echo "BLOCKED: Do not run production commands from Claude Code sessions." >&2
  exit 2
fi

# Block rm -rf on source directories
if echo "$CMD" | grep -qE 'rm -rf (apps|packages|src|prisma)/'; then
  echo "BLOCKED: Destructive rm on source directories is not allowed." >&2
  exit 2
fi

exit 0
```

---

#### Step 0.8 — Enable Agent Teams + Subagent Model Config

In `.claude/settings.local.json` (personal, gitignored):
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-4-6"
  }
}
```

Why: Run the main orchestrator session on your best model (Opus) for complex architectural reasoning. Subagents — which do focused, well-scoped work — run on Sonnet, cutting costs significantly without sacrificing quality on bounded tasks.

---

#### Step 0.9 — Agent Team Strategy per Phase

Use the right agent pattern for each phase:

| Phase | Pattern | Why |
|---|---|---|
| 0 — AI setup | Main session only | Setup, no parallelism needed |
| 1 — Scaffolding | Main session only | Sequential, interdependent |
| 2 — DB Schema | `db-architect` subagent | Isolated domain |
| 3 — Auth | Main + `code-reviewer` after | Sequential, then review |
| 4 — Locations + Users + Roles | Agent team: `backend-dev` + `frontend-dev` in parallel | Independent layers |
| 6–8 — Assets + Movements | Agent team: `backend-dev` (API) + `frontend-dev` (UI) + `test-writer` (tests) | True parallel, separate domains |
| 10 — Label printing | Agent team: `backend-dev` (PDF) + `frontend-dev` (editor UI) | Independent |
| 14 — i18n | `backend-dev` + `frontend-dev` + `i18n-checker` (verify) | Parallel + verification |
| Any completed module | `code-reviewer` subagent | Always review after |

**How to invoke an agent team (example for Phase 6):**
```
Create an agent team with 3 teammates:
- backend-dev: implement the full asset CRUD API (Phase 6 spec in CLAUDE.md)
- frontend-dev: implement asset list page, detail page, and create/edit form
- test-writer: write Vitest + Supertest tests for the asset module
Each teammate should work independently in their domain and report back when done.
```

**How to invoke a subagent (example for review):**
```
Use the Task tool to spawn a code-reviewer subagent.
Give it this context: "Review all files modified in the asset module this session.
Use the checklist in .claude/agents/code-reviewer.md."
```

---

#### Step 0.10 — Context Management Rules

These rules prevent the #1 failure mode in long Claude Code sessions: context degradation.

1. **Compact at 50% context usage** — do not wait for auto-compact. Run `/compact` manually with a focus instruction: `/compact focus on: current phase, modified files, open decisions`

2. **Never let a session run indefinitely** — after completing a phase, start a fresh session. Phases are the natural session boundaries.

3. **Use `/clear` when switching tasks** within a session (not between phases — use a new session for that).

4. **Write decisions to files, not chat** — when making architectural decisions, ask Claude to write them to `docs/decisions/{date}-{topic}.md`. These persist across sessions.

5. **`session-state.md`** — the PreCompact hook writes this automatically. Read it at the start of each new session: `cat .claude/session-state.md`

6. **Phase gate files** — after completing each phase, ask Claude to write a phase summary to `docs/phases/phase-{N}-complete.md` with: what was built, schema state, test results, open items.

---

**Stop. Before starting Phase 1:**
1. Run Step 0.1 (global skills check) and update CLAUDE.md with found skills
2. Create all files in Steps 0.2–0.8
3. Run `chmod +x .claude/hooks/*.sh`
4. Verify hooks work: `echo '{"tool_input":{"file_path":"apps/api/prisma/migrations/test.sql"}}' | .claude/hooks/pre-edit-protect.sh`
5. Show me the completed `.claude/` directory structure. Await approval.

---

### Phase 1 — Project Foundation
Deliverables:
- pnpm monorepo with `apps/api`, `apps/web`, `packages/shared`
- Local PostgreSQL + Redis connection config (native install or managed service — **no Docker**)
- `apps/api`: Express.js + TypeScript bootstrap with `server.ts`, `app.ts`, middleware chain ready
- `apps/web`: Next.js 14 (App Router) + TypeScript bootstrap with Tailwind + shadcn/ui configured
- TypeScript strict tsconfig for all packages
- ESLint + Prettier with shared config
- `.env.example` with all variables documented
- `packages/shared/locales/en` and `id` with empty namespace files
- README with setup instructions

**Stop. Show me the structure. Await approval.**

---

### Phase 2 — Database Schema & Seed
Deliverables:
- Full `schema.prisma` covering all entities in this document
- All indexes defined
- All FK cascade rules defined
- `REVOKE UPDATE, DELETE ON audit_logs, asset_movements` in raw migration SQL
- Seed script: 5 roles with permissions, 2 root locations + sub-locations, 5 categories, 3 test users, 10 sample assets with movements, 2 label templates, tour definitions for all 5 default roles

**Stop. Show me the full schema.prisma. Await approval.**

---

### Phase 3 — Auth & RBAC
- Login, JWT, refresh token, logout
- `authenticate.ts` + `authorize.ts` middleware (RBAC + location scope)
- `GET /api/auth/me` returning user + roles + permissions + accessible location IDs
- Login page + protected route wrapper (frontend)
- `use-permission.ts` hook

---

### Phase 4 — Locations & Users & Roles
- Location CRUD + `/tree` (recursive CTE) + `/ancestors`
- User CRUD + role assignment with location scoping
- Role CRUD + `PUT /api/roles/:id/permissions` with `tour_sync` job trigger
- Location tree UI + User management UI + Role & permission management UI

---

### Phase 5 — Product Catalog & EAN Lookup
- `POST /api/products/lookup`: internal cache → UPCitemdb → Go-UPC (3s timeout per API)
- Product CRUD
- Rate limit awareness for external APIs

---

### Phase 6 — Assets (Core)
- Full asset CRUD
- Thread-safe asset number generation
- Code 128 + QR code generation on create
- Asset list (with filters), detail, create/edit pages (frontend)

---

### Phase 7 — Barcode Scanner
- `BarcodeScanner` component (`@zxing/browser`)
- Intent detection logic (internal barcode / EAN-13 / serial number / unknown)
- Full "import via scan" flow with fallback form
- Works on mobile Chrome and Safari

---

### Phase 8 — Asset Movements
- All 13 movement types
- Atomic swap via transaction
- Resignation bulk return
- Approval workflow (configurable per type)
- Movement history timeline + creation forms (frontend)

---

### Phase 9 — Maintenance
- Schedule CRUD with frequency types
- Maintenance log creation
- `GET /api/maintenance/due`
- Maintenance UI

---

### Phase 10 — Label Templates & Thermal Printing
- `label_templates` + `print_jobs` CRUD
- PDF generation via `pdfkit` at exact mm dimensions
- Preview endpoint
- Drag-drop label editor UI (frontend)
- Print flow: select assets → template → preview → print
- Print-specific CSS

---

### Phase 11 — Notifications & Background Jobs
- All 9 BullMQ jobs implemented and registered
- `tour_sync` job implemented fully
- In-app notification bell with unread count
- HTML email templates in both languages

---

### Phase 12 — Import / Export & Reports
- Excel template download
- Row-level import validation + error report + preview-before-import UI
- Async export for large datasets
- All 5 report types (PDF + Excel output)
- Scheduled report config UI + report history

---

### Phase 13 — Dashboard & Analytics
- All dashboard endpoints (no N+1 queries — use aggregation at DB level)
- All 9 dashboard widgets (frontend, responsive)

---

### Phase 14 — Multilanguage (i18n)
- All frontend strings in locale files
- All API error messages using i18n keys
- Email templates in both languages
- Tour step text in both languages
- Language switcher + persist to profile

---

### Phase 15 — Onboarding Tours
- `driver.js` with shadcn/ui theme
- Tour steps from API, progress saved per step
- Next / Previous / Skip / Exit controls
- Restart from profile settings
- `data-tour` attributes on all relevant UI elements
- Tour admin management page (SUPER_ADMIN)
- Steps with missing permission auto-skipped

---

### Phase 16 — Audit Trail & Security Hardening
- `audit.ts` middleware verified on all write operations
- Audit log viewer UI (admin only)
- Rate limiting verified
- Helmet.js configured
- File upload validation hardened
- All `prisma.$transaction()` usage reviewed

---

### Phase 17 — QA, Performance & Documentation
- Query analysis — fix N+1, add missing indexes
- Lighthouse ≥ 85 mobile
- List API < 300ms with pagination
- Swagger docs complete
- README updated: setup, env vars, deployment
- Seed data covers all edge cases

---

## Additional Notes

- **Company**: Wedison | **Asset prefix**: `WDS`
- **Currency**: IDR, `decimal(15,2)`, displayed as `Rp 1.500.000`
- **Timezone**: store UTC, display WIB (UTC+7)
- **Default language**: Bahasa Indonesia (`id`)
- **UUIDs**: `uuid_generate_v4()` — enable extension in first migration
- **Soft deletes**: `deleted_at` on users, assets, locations, asset_categories. Use Prisma middleware to auto-filter `WHERE deleted_at IS NULL` on all queries.
- **Required indexes**: `asset_number`, `serial_number`, `barcode_value`, `ean_code`, `location_id`, `assigned_to_user_id`, `status`, `warranty_end_date`, `expected_return_date`, composite `(resource_type, resource_id)` on audit_logs, composite `(user_id, is_read)` on notifications

---

*End of prompt. Start with Phase 1. Do not proceed to Phase 2 without my explicit approval.*
