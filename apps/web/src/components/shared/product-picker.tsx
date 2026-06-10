"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import AutocompletePicker, {
  type AutocompleteItem,
} from "./autocomplete-picker";
import NewProductDialog from "./new-product-dialog";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";

// Product picker — wires AutocompletePicker to:
//   - GET /api/products?search=…&limit=20   (autocomplete via paginated list)
//   - "+ Save as new product" opens NewProductDialog with the typed name
//     prefilled; the dialog requires a category before POSTing
//     /api/products. The category drives the asset-number prefix
//     (WDS-{CATEGORY_CODE}-…), so it must be chosen explicitly — the
//     backend no longer accepts category-less product creation.
//
// Used in PO line-item rows (Tier 7.7) and the asset module (Tier 7.9).

interface ProductRow {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  eanCode?: string | null;
}

function toItem(p: ProductRow): AutocompleteItem {
  return {
    id: p.id,
    label: p.name,
    ...(p.brand || p.model || p.eanCode
      ? {
          subtitle: [p.brand, p.model, p.eanCode].filter(Boolean).join(" · "),
        }
      : {}),
  };
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
  const queryClient = useQueryClient();

  // Quick-create dialog state — opened by the "+ Save as new" row with
  // the typed query as the proposed product name.
  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    name: string;
  }>({ open: false, name: "" });

  const searchFn = useCallback(
    (q: string) =>
      apiGet<ProductRow[]>("/api/products", { search: q, limit: 20 }),
    [],
  );

  const onCreateRequest = useCallback((productName: string) => {
    setCreateDialog({ open: true, name: productName });
  }, []);

  const handleCreateProduct = useCallback(
    async (input: {
      name: string;
      categoryId: string;
      brand: string;
      model: string;
      eanCode: string;
    }): Promise<boolean> => {
      try {
        const payload: {
          name: string;
          categoryId: string;
          source: "MANUAL";
          brand?: string;
          model?: string;
          eanCode?: string;
        } = {
          name: input.name.trim(),
          categoryId: input.categoryId,
          source: "MANUAL",
        };
        if (input.brand.trim()) payload.brand = input.brand.trim();
        if (input.model.trim()) payload.model = input.model.trim();
        if (input.eanCode.trim()) payload.eanCode = input.eanCode.trim();

        const created = await apiPost<ProductRow>("/api/products", payload);
        // Other consumers (reference-data hook, other open forms) pick up
        // the new product on their next render.
        void queryClient.invalidateQueries({ queryKey: ["ref", "products"] });
        onChange(toItem(created));
        toast.success(`Product created: ${created.name}`);
        setCreateDialog({ open: false, name: "" });
        return true;
      } catch (err: unknown) {
        toast.error(getApiErrorMessage(err, "Failed to create product."));
        return false;
      }
    },
    [onChange, queryClient],
  );

  return (
    <>
      <AutocompletePicker<ProductRow>
        value={value}
        onChange={onChange}
        searchFn={searchFn}
        toItem={toItem}
        {...(allowCreate && { onCreateRequest })}
        createNoun="product"
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        id={id}
        name={name}
        emptyMessage="No products match. Type a name and click + to create."
        {...(prefilledQuery && { prefilledQuery })}
      />
      {createDialog.open && (
        <NewProductDialog
          initial={{
            name: createDialog.name,
            brand: "",
            model: "",
            eanCode: "",
          }}
          onCancel={() => setCreateDialog({ open: false, name: "" })}
          onSubmit={handleCreateProduct}
        />
      )}
    </>
  );
}
