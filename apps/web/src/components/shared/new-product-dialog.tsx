"use client";

import { useState, type KeyboardEvent } from "react";
import { useAssetCategories } from "@/hooks/use-reference-data";

// ── New product dialog ──────────────────────────────────────────────
// Small modal for adding a product the user couldn't find in the catalog.
// Category is required — the product's category drives the asset-number
// prefix (WDS-{CATEGORY_CODE}-…), so it must be correct at creation time;
// re-categorising later does NOT renumber existing assets.
//
// Used by:
//   - ProductPicker's inline "+ Save as new product" row (PO line items,
//     asset forms) — name prefilled from the typed query.
//   - MultiAssetCreateForm's EAN-scan fallback — name/brand/model/EAN
//     prefilled from the external lookup.
//
// Returning a boolean from onSubmit lets the parent close-on-success or
// leave the dialog open on failure so the user can correct and retry.

export interface NewProductDialogProps {
  initial: { name: string; brand: string; model: string; eanCode: string };
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    categoryId: string;
    brand: string;
    model: string;
    eanCode: string;
  }) => Promise<boolean>;
}

export default function NewProductDialog({
  initial,
  onCancel,
  onSubmit,
}: NewProductDialogProps) {
  const { data: categories = [] } = useAssetCategories();
  const [name, setName] = useState(initial.name);
  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState(initial.brand);
  const [model, setModel] = useState(initial.model);
  const [eanCode, setEanCode] = useState(initial.eanCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!categoryId) {
      setError("Category is required.");
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit({ name, categoryId, brand, model, eanCode });
    setSubmitting(false);
    if (!ok) {
      // onSubmit already toasted; just keep the dialog open so the user can retry.
      setError("Save failed. See the toast for details.");
    }
  };

  // The dialog is position:fixed but still a DOM descendant of whatever
  // <form> hosts the ProductPicker (PO page, asset forms). Without this
  // trap, Enter inside a dialog input fires the browser's implicit
  // submission of that ANCESTOR form — validating a half-filled PO form
  // while the user is mid-dialog. Intercept Enter on text inputs and
  // route it to the dialog's own submit instead.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;
    if ((e.target as HTMLElement).tagName !== "INPUT") return;
    e.preventDefault();
    if (!submitting) void submit();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-product-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="new-product-title" className="mb-1 text-lg font-semibold">
          New product
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Add this product to the catalog so you can link it to assets.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-name">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-cat">
              Category <span className="text-destructive">*</span>
            </label>
            <select
              id="np-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">-- Select category --</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {categories.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No categories available. Ask an admin to create one first.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="np-brand">
                Brand
              </label>
              <input
                id="np-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="np-model">
                Model
              </label>
              <input
                id="np-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-ean">
              EAN code
            </label>
            <input
              id="np-ean"
              value={eanCode}
              onChange={(e) => setEanCode(e.target.value)}
              placeholder="13-digit barcode"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create product"}
          </button>
        </div>
      </div>
    </div>
  );
}
