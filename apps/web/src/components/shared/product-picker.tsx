"use client";

import { useCallback } from "react";
import AutocompletePicker, {
  type AutocompleteItem,
} from "./autocomplete-picker";
import { apiGet, apiPost } from "@/lib/api";

// Product picker — wires AutocompletePicker to:
//   - GET /api/products?search=…&limit=20   (autocomplete via paginated list)
//   - POST /api/products with name only      (quick-save; backend falls
//     back to the first available category — spec §2.5)
//
// Used in PO line-item rows (Tier 7.7) and the asset module (Tier 7.9).

interface ProductRow {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  eanCode?: string | null;
}

interface ProductPickerProps {
  value: AutocompleteItem | null;
  onChange: (next: AutocompleteItem | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  allowCreate?: boolean;
  /** Pre-fill the search input — see AutocompletePicker docs. */
  prefilledQuery?: string;
}

export default function ProductPicker({
  value,
  onChange,
  disabled,
  invalid,
  placeholder = "Search product…",
  id,
  name,
  allowCreate = true,
  prefilledQuery,
}: ProductPickerProps) {
  const searchFn = useCallback(
    (q: string) =>
      apiGet<ProductRow[]>("/api/products", { search: q, limit: 20 }),
    [],
  );

  const onCreate = useCallback(
    (productName: string) =>
      apiPost<ProductRow>("/api/products", {
        name: productName,
        // categoryId omitted — backend falls back to first category
        // alphabetically (see products/service.ts createProduct).
      }),
    [],
  );

  return (
    <AutocompletePicker<ProductRow>
      value={value}
      onChange={onChange}
      searchFn={searchFn}
      toItem={(p) => ({
        id: p.id,
        label: p.name,
        ...(p.brand || p.model || p.eanCode
          ? {
              subtitle: [p.brand, p.model, p.eanCode]
                .filter(Boolean)
                .join(" · "),
            }
          : {}),
      })}
      {...(allowCreate && { onCreate })}
      createNoun="product"
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      id={id}
      name={name}
      emptyMessage="No products match. Type a name and click + to create."
      {...(prefilledQuery && { prefilledQuery })}
    />
  );
}
