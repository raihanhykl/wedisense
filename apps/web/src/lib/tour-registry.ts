/**
 * Tour target registry — the bridge between auto-discovered `data-tour=`
 * attributes (canonical source: the generated file below) and admin-UI
 * friendly descriptions.
 *
 * Architecture:
 *   1. tour-targets.generated.ts  → authoritative list of TOUR_TARGETS,
 *      regenerated from JSX via `pnpm tour:codegen`. Drift between code
 *      and registry is impossible after Tier 2 — CI runs the same script
 *      with --check and fails on stale.
 *
 *   2. TOUR_TARGET_DESCRIPTIONS    → manually-curated map of friendly
 *      labels, optional. Missing entries fall back to the slug itself
 *      humanised. Devs can add a description any time without blocking
 *      a tour from being authored.
 *
 *   3. TOUR_TARGET_REGISTRY        → the merged shape consumers actually
 *      use ({ value, description? }[]). Kept for backwards compat with
 *      <TourTargetPicker> and other call-sites that pre-date the split.
 */

import { TOUR_TARGETS, type TourTargetValue } from "./tour-targets.generated";

export type { TourTargetValue };

export interface TourTargetEntry {
  value: TourTargetValue;
  description?: string;
}

// ── Curated descriptions (optional, sparse) ────────────────────────────
// Keys MUST be a TourTargetValue — the as-const generated tuple makes
// any typo here a compile error, which is the whole point of the codegen.
// Add new entries opportunistically when authoring a tour; missing keys
// fall back to a humanised slug in `entryFor()` below.
const TOUR_TARGET_DESCRIPTIONS: Partial<Record<TourTargetValue, string>> = {
  "add-asset-btn": "Button to create a new asset",
  "add-asset-category-btn": "Button to add an asset category",
  "add-location-btn": "Button to add a location",
  "add-role-btn": "Button to add a new role",
  "add-row-btn": "Button to add a row in multi-asset form",
  "add-user-btn": "Button to add a user",
  "asset-categories-table": "Asset categories table",
  "asset-create": "Asset creation page/form",
  "asset-detail": "Asset detail page",
  "asset-edit": "Asset edit form",
  "asset-import": "Asset import feature",
  "asset-list": "Asset list table",
  "asset-rows": "Rows in multi-asset create form",
  "asset-search": "Asset search input",
  "barcode-scanner": "Barcode scanner component",
  "bulk-actions-bar": "Bulk actions floating bar",
  "category-filter": "Category filter dropdown",
  "columns-menu": "Column visibility menu",
  "confirm-import-btn": "Button to confirm asset import",
  "create-report-btn": "Button to create a report",
  "dashboard-alerts": "Dashboard alerts panel",
  "dashboard-charts": "Dashboard charts section",
  "dashboard-recent-movements": "Dashboard recent movements widget",
  "dashboard-summary": "Dashboard summary metrics",
  "download-import-template-btn": "Download import template button",
  "download-report-btn": "Button to download a report",
  "export-assets-btn": "Button to export assets",
  "generate-report-btn": "Button to generate a report",
  "import-assets-btn": "Button to start asset import",
  "import-file-input": "File input for asset import",
  "label-printing": "Label printing section",
  "location-tree": "Location tree view",
  "location-tree-picker": "Location tree picker component",
  "login-form": "Login form",
  "maintenance": "Maintenance page",
  "mark-all-read-btn": "Button to mark all notifications as read",
  "movement-list": "Movement list table",
  "new-product-btn": "Button to create a new product",
  "notification-bell": "Notification bell icon",
  "notification-read-filter": "Notification read/unread filter",
  "notification-type-filter": "Notification type filter",
  "notifications-page": "Notifications page",
  "report-create": "Report creation form",
  "report-detail": "Report detail page",
  "report-detail-download-btn": "Download button on report detail",
  "report-detail-generate-btn": "Generate button on report detail",
  "report-name-input": "Report name input field",
  "report-type-filter": "Report type filter",
  "report-type-select": "Report type select dropdown",
  "reports-list": "Reports list table",
  "role-management": "Role management page",
  "save-report-btn": "Button to save a report",
  "saved-views-menu": "Saved views menu",
  "scan-product-btn": "Button to scan a product barcode",
  "sidebar-nav": "Sidebar navigation",
  "status-filter": "Status filter dropdown",
  "upload-validate-btn": "Button to upload and validate import file",
  "user-management": "User management page",
  "user-search": "User search input",
};

// ── Public surface ─────────────────────────────────────────────────────

/**
 * Humanise a slug for the picker when no curated description is set.
 * Example: "asset-list" → "Asset list".
 */
function humanise(value: string): string {
  if (value.length === 0) return value;
  const spaced = value.replace(/-/g, " ");
  return spaced[0]!.toUpperCase() + spaced.slice(1);
}

function entryFor(value: TourTargetValue): TourTargetEntry {
  const description = TOUR_TARGET_DESCRIPTIONS[value] ?? humanise(value);
  return { value, description };
}

/**
 * Array view of every discoverable tour target, sorted by value. The
 * <TourTargetPicker> renders this list directly; the generated tuple
 * underneath is already alphabetised so no further sort is needed.
 */
export const TOUR_TARGET_REGISTRY: TourTargetEntry[] = TOUR_TARGETS.map(entryFor);

/**
 * Bare list of valid target values. Useful for `Set` membership checks or
 * Zod refinements that don't need the descriptions.
 */
export const TOUR_TARGET_VALUES: readonly TourTargetValue[] = TOUR_TARGETS;

/**
 * Type-guard helper: returns true if a runtime string matches a known
 * target. Useful at boundaries where we receive untyped data (DB, form
 * input) and need to confirm it lines up with the current code surface.
 */
export function isKnownTourTarget(value: string): value is TourTargetValue {
  return (TOUR_TARGETS as readonly string[]).includes(value);
}
