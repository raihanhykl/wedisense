"use client";

import { useMemo, useState } from "react";
import { Pencil, PackagePlus } from "lucide-react";
import { useAssetCategories } from "@/hooks/use-reference-data";
import CategoryTreePicker from "@/components/shared/category-tree-picker";
import type { AssetImportRow } from "@/types/admin";

// ── Aggregated view of a new product the import will create ──────────
// Rows that share a (name, categoryName) pair represent the same product
// to be created — they're grouped here so the user sees "1 new product
// referenced by 5 rows" rather than 5 duplicate entries.
interface NewProductEntry {
  /** Stable key matching the backend's dedupe: lowercased name + categoryName. */
  key: string;
  name: string;
  categoryName: string;
  brand: string;
  model: string;
  eanCode: string;
  /** Indexes (in the parent's `rows` array) of every row this product covers. */
  rowIndexes: number[];
}

function entryKey(name: string, categoryName: string): string {
  return `${name.toLowerCase()}|${categoryName.toLowerCase()}`;
}

interface NewProductsReviewProps {
  /** Validated rows from the upload preview. We only inspect those carrying
   *  a `newProductSpec` — existing-product rows are ignored. */
  rows: AssetImportRow[];
  /**
   * Called with a transform function: given the current rows, return a new
   * array with edits applied. Caller plugs this back into its state.
   *
   * We pass a function (not a new array) so the parent owns the source of
   * truth and we don't accidentally fight stale closures with rapid edits.
   */
  onRowsChange: (transform: (rows: AssetImportRow[]) => AssetImportRow[]) => void;
}

export default function NewProductsReview({
  rows,
  onRowsChange,
}: NewProductsReviewProps) {
  const [editing, setEditing] = useState<NewProductEntry | null>(null);

  // Aggregate rows → unique new-product entries. Sorted by row count (most
  // referenced first) so the user reviews high-impact entries before
  // single-row outliers.
  const entries = useMemo<NewProductEntry[]>(() => {
    const map = new Map<string, NewProductEntry>();
    for (const r of rows) {
      const spec = r.newProductSpec;
      if (!spec) continue;
      const key = entryKey(spec.name, spec.categoryName);
      const existing = map.get(key);
      if (existing) {
        existing.rowIndexes.push(r.rowIndex);
      } else {
        map.set(key, {
          key,
          name: spec.name,
          categoryName: spec.categoryName,
          brand: spec.brand ?? "",
          model: spec.model ?? "",
          eanCode: spec.eanCode ?? "",
          rowIndexes: [r.rowIndex],
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.rowIndexes.length - a.rowIndexes.length,
    );
  }, [rows]);

  if (entries.length === 0) return null;

  // ── Apply edits to every row in the matching group ─────────────────
  // Caller owns the row state via onRowsChange; we just describe the
  // transformation. The dedupe key (name+categoryName) is recomputed after
  // the edit so the group can survive a category rename.
  const applyEdit = (
    originalKey: string,
    update: { categoryName: string; brand: string; model: string; eanCode: string },
  ) => {
    onRowsChange((current) =>
      current.map((r) => {
        const spec = r.newProductSpec;
        if (!spec) return r;
        const k = entryKey(spec.name, spec.categoryName);
        if (k !== originalKey) return r;
        return {
          ...r,
          newProductSpec: {
            name: spec.name,
            categoryName: update.categoryName,
            ...(update.brand && { brand: update.brand }),
            ...(update.model && { model: update.model }),
            ...(update.eanCode && { eanCode: update.eanCode }),
          },
        };
      }),
    );
  };

  return (
    <>
      <div className="rounded-lg border border-blue-200 bg-blue-50/40">
        <div className="flex items-start gap-3 border-b border-blue-200 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <PackagePlus className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {entries.length} new product{entries.length === 1 ? "" : "s"} will be created
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These products are not in the catalog yet. They&apos;ll be added when
              you confirm. Review them now — once imported, asset records will reference these products.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-card">
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-left font-medium">Brand</th>
                <th className="px-4 py-2 text-left font-medium">Model</th>
                <th className="px-4 py-2 text-left font-medium">EAN</th>
                <th className="px-4 py-2 text-left font-medium">Used by</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.key} className="border-b last:border-b-0">
                  <td className="px-4 py-2 font-medium">{e.name}</td>
                  <td className="px-4 py-2">{e.categoryName}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.brand || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.model || "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">
                    {e.eanCode || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.rowIndexes.length} row{e.rowIndexes.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(e)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditNewProductDialog
          entry={editing}
          onCancel={() => setEditing(null)}
          onSave={(update) => {
            applyEdit(editing.key, update);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

// ── Edit dialog ──────────────────────────────────────────────────────
// Local, non-async: just collects the new values and calls onSave. The
// parent applies the transform to its row state. Category dropdown is
// populated from the catalog via useAssetCategories so users can't
// introduce typos.

interface EditDialogProps {
  entry: NewProductEntry;
  onCancel: () => void;
  onSave: (update: {
    categoryName: string;
    brand: string;
    model: string;
    eanCode: string;
  }) => void;
}

function EditNewProductDialog({ entry, onCancel, onSave }: EditDialogProps) {
  const { data: categories = [] } = useAssetCategories();

  const [categoryName, setCategoryName] = useState(entry.categoryName);
  const [brand, setBrand] = useState(entry.brand);
  const [model, setModel] = useState(entry.model);
  const [eanCode, setEanCode] = useState(entry.eanCode);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!categoryName.trim()) {
      setError("Category is required.");
      return;
    }
    onSave({
      categoryName: categoryName.trim(),
      brand: brand.trim(),
      model: model.trim(),
      eanCode: eanCode.trim(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-newproduct-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="edit-newproduct-title" className="mb-1 text-lg font-semibold">
          Edit new product
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Changes apply to all{" "}
          <span className="font-medium">{entry.rowIndexes.length}</span> row
          {entry.rowIndexes.length === 1 ? "" : "s"} that reference this product.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="enp-name">
              Name
            </label>
            <input
              id="enp-name"
              value={entry.name}
              disabled
              readOnly
              className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              To rename, edit column A in your Excel file and re-upload.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="enp-cat">
              Category <span className="text-destructive">*</span>
            </label>
            {/* The import flow matches categories by NAME, so the picker is
                bridged name↔id: an Excel-typed name that doesn't exist in
                the catalog resolves to no selection and is surfaced through
                the placeholder ("current — may not exist") instead of being
                silently overwritten. Picking a node stores its exact name. */}
            <CategoryTreePicker
              id="enp-cat"
              data-tour="import-product-category-picker"
              value={
                categories.find(
                  (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
                )?.id ?? null
              }
              onChange={(id) => {
                const cat = categories.find((c) => c.id === id);
                setCategoryName(cat ? cat.name : "");
              }}
              categories={categories}
              placeholder={
                categoryName
                  ? `${categoryName} (current — may not exist)`
                  : "Select category"
              }
              clearLabel="— Clear selection —"
            />
            {categories.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Loading categories...
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="enp-brand">
                Brand
              </label>
              <input
                id="enp-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="enp-model">
                Model
              </label>
              <input
                id="enp-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="enp-ean">
              EAN
            </label>
            <input
              id="enp-ean"
              value={eanCode}
              onChange={(e) => setEanCode(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
