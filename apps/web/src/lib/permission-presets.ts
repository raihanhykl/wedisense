/**
 * Permission presets — opinionated quick-apply templates for the role
 * permission editor. Applied client-side: the preset writes a set of
 * `resource:action` keys into the editor's pending state, then the
 * existing `PUT /api/roles/:id/permissions` commits via the diff modal.
 *
 * Kept as a hard-coded list rather than a DB-managed feature because:
 *   - Wedisense ships with a fixed permission catalog. Presets only
 *     change if the catalog itself changes — a code event, not runtime.
 *   - DB-managed presets add a CRUD UI that doesn't pay rent at SMB
 *     scale (single tenant, single admin team).
 *
 * Presets reference permissions by the `resource:action` key (not the
 * UUID) so they stay portable across seeds and environments. The editor
 * resolves keys → permission IDs via the loaded catalog before applying.
 */

export interface PermissionPreset {
  id: string;
  label: string;
  description: string;
  /** Allowlist of `resource:action` keys to grant. Anything not in this
   *  list is revoked when the preset is applied (full overwrite). */
  permissionKeys: string[];
}

// Common keys are listed explicitly rather than computed from the catalog
// — when a new permission ships, the preset author should consciously
// decide whether it belongs in a baseline, not have it sneak in via a
// glob. Failing to add a new permission to a preset is the safer default.

const READ_ONLY_KEYS = [
  "assets:read",
  "movements:create",
  "reports:view",
  "vendors:read",
  "purchase-orders:read",
  "procurement:read",
];

const STAFF_BASELINE_KEYS = [
  ...READ_ONLY_KEYS,
  "assets:print",
];

const MANAGER_BASELINE_KEYS = [
  ...STAFF_BASELINE_KEYS,
  "assets:create",
  "assets:update",
  "assets:export",
  "movements:approve",
  "maintenance:manage",
  "reports:generate",
  "vendors:create",
  "vendors:update",
  "purchase-orders:create",
  "purchase-orders:update",
  "purchase-orders:close",
  "procurement:create",
  "procurement:update",
  "procurement:complete",
  "procurement:export",
];

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: "read-only",
    label: "Read-only",
    description:
      "View assets, reports, vendors, POs, procurement. Cannot create or modify anything.",
    permissionKeys: READ_ONLY_KEYS,
  },
  {
    id: "staff-baseline",
    label: "Staff baseline",
    description:
      "Read-only access + create movements + print asset labels. Cannot approve or modify.",
    permissionKeys: STAFF_BASELINE_KEYS,
  },
  {
    id: "manager-baseline",
    label: "Manager baseline",
    description:
      "Staff baseline + create/update assets, approve movements, manage maintenance + procurement.",
    permissionKeys: MANAGER_BASELINE_KEYS,
  },
  {
    id: "full-access",
    label: "Full access (warning)",
    description:
      "Grants every permission in the catalog including roles:manage. Equivalent to SUPER_ADMIN.",
    permissionKeys: [], // sentinel: filled at apply-time from the live catalog
  },
];

/**
 * Resolve a preset to the set of permission IDs from the live catalog.
 * Unknown keys (preset references a permission not present in catalog)
 * are silently dropped — surfaces as the preset granting fewer perms
 * than expected, never crashes.
 *
 * The `full-access` preset returns ALL catalog permission IDs.
 */
export function resolvePresetIds(
  preset: PermissionPreset,
  catalog: Array<{ id: string; resource: string; action: string }>,
): Set<string> {
  if (preset.id === "full-access") {
    return new Set(catalog.map((p) => p.id));
  }
  const want = new Set(preset.permissionKeys);
  return new Set(
    catalog
      .filter((p) => want.has(`${p.resource}:${p.action}`))
      .map((p) => p.id),
  );
}
