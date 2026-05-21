import { LocationType } from "@wedisense/shared/types";

/**
 * Single source of truth for human-readable LocationType labels.
 *
 * Why this file exists: the Prisma enum (HEAD_OFFICE, BRANCH, …) is a stable
 * machine identifier — never show it directly to users. Components that need
 * to render or pick a LocationType pull from here, which keeps the labels
 * consistent across the tree page, the picker dropdown, the form select,
 * and any future detail page.
 *
 * Phase 14 swap-in: when i18n is wired up, replace `label` with
 * `t(\`locations.types.${value}\`)`. The i18n keys are already authored in
 * `packages/shared/locales/{en,id}/locations.json` under `types.*`, so the
 * swap is a mechanical find-replace — no schema or call-site shape change.
 */

export type LocationTypeValue = LocationType;

export interface LocationTypeOption {
  /** Machine value — what gets sent to the API and stored in Prisma. */
  value: LocationTypeValue;
  /** Human-readable label rendered in selects, badges, etc. */
  label: string;
  /** Optional short description shown in tooltips or list dividers. */
  description: string;
}

/**
 * Ordered for the form select — most-common types first, "Other" last.
 * Order matters for UX, not correctness, so keep it stable.
 */
export const LOCATION_TYPE_OPTIONS: readonly LocationTypeOption[] = [
  {
    value: "HEAD_OFFICE",
    label: "Head Office",
    description: "Primary corporate site",
  },
  {
    value: "BRANCH",
    label: "Branch",
    description: "Regional branch office",
  },
  {
    value: "FACTORY",
    label: "Factory",
    description: "Manufacturing or production site",
  },
  {
    value: "SHOWROOM",
    label: "Showroom",
    description: "Customer-facing display area",
  },
  {
    value: "SERVICE_CENTER",
    label: "Service Center",
    description: "Service and repair facility",
  },
  {
    value: "OTHER",
    label: "Other",
    description: "Other location type",
  },
] as const;

const LABEL_LOOKUP = new Map<LocationTypeValue, string>(
  LOCATION_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * Returns the human label for a LocationType. Falls back to the raw value
 * (uppercased machine identifier) for forward-compat if the API ever ships
 * a new enum value before the web bundle is updated.
 */
export function getLocationTypeLabel(value: string): string {
  return LABEL_LOOKUP.get(value as LocationTypeValue) ?? value;
}

/**
 * Type guard for narrowing arbitrary strings into LocationTypeValue. Used
 * by the form's Zod schema and by code that consumes API responses where
 * type is typed as `string`.
 */
export function isLocationType(value: unknown): value is LocationTypeValue {
  return typeof value === "string" && LABEL_LOOKUP.has(value as LocationTypeValue);
}
