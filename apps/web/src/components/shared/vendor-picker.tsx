"use client";

import { useCallback } from "react";
import AutocompletePicker, {
  type AutocompleteItem,
} from "./autocomplete-picker";
import { apiGet, apiPost } from "@/lib/api";

// Vendor picker — wires the generic AutocompletePicker to:
//   - GET /api/vendors/search?q=…&limit=20   (autocomplete)
//   - POST /api/vendors                       (quick-save with name only)
//
// Spec §2.4 — inline quick-save is the chosen UX; detail fields land
// later from the vendor management page.

interface VendorRow {
  id: string;
  name: string;
  taxId?: string | null;
}

interface VendorPickerProps {
  value: AutocompleteItem | null;
  onChange: (next: AutocompleteItem | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  /** Disable the quick-save affordance for read-only flows. */
  allowCreate?: boolean;
  /** Pre-fill the search input — see AutocompletePicker docs. */
  prefilledQuery?: string;
}

export default function VendorPicker({
  value,
  onChange,
  disabled,
  invalid,
  placeholder = "Search vendor…",
  id,
  name,
  allowCreate = true,
  prefilledQuery,
}: VendorPickerProps) {
  // Stable handlers — the AutocompletePicker only re-runs the search
  // effect when the query changes, so identity-stable callbacks aren't
  // strictly required, but they're cheap and a habit-good practice.
  const searchFn = useCallback(
    (q: string) =>
      apiGet<VendorRow[]>("/api/vendors/search", { q, limit: 20 }),
    [],
  );

  const onCreate = useCallback(
    (name: string) =>
      apiPost<VendorRow>("/api/vendors", { name }),
    [],
  );

  return (
    <AutocompletePicker<VendorRow>
      value={value}
      onChange={onChange}
      searchFn={searchFn}
      toItem={(v) => ({
        id: v.id,
        label: v.name,
        ...(v.taxId ? { subtitle: v.taxId } : {}),
      })}
      {...(allowCreate && { onCreate })}
      createNoun="vendor"
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      id={id}
      name={name}
      emptyMessage="No vendors match. Type a name and click + to create."
      {...(prefilledQuery && { prefilledQuery })}
    />
  );
}
