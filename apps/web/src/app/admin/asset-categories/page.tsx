"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import CategoryFormDialog from "@/components/shared/category-form-dialog";
import type { AssetCategoryDetail } from "@/types/admin";

// ── Page ────────────────────────────────────────────────────────────
// Flat table view, sorted by name. The schema supports parent/child nesting
// but in practice most installs run a single level — we surface the parent
// as a column rather than rendering a tree to keep the management surface
// straightforward.
export default function AssetCategoriesPage() {
  const canManage = usePermission("categories:manage");
  const [categories, setCategories] = useState<AssetCategoryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategoryDetail | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const data = await apiGet<AssetCategoryDetail[]>("/api/asset-categories");
      setCategories(data);
    } catch (err) {
      setPageError(getApiErrorMessage(err, "Failed to load categories"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  const handleAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handleEdit = (category: AssetCategoryDetail) => {
    setEditing(category);
    setDialogOpen(true);
  };

  const handleDelete = async (category: AssetCategoryDetail) => {
    if (category._count.products > 0) {
      window.alert(
        `Cannot delete "${category.name}" — ${category._count.products} product(s) still reference it. Reassign them first.`,
      );
      return;
    }
    if (
      !window.confirm(
        `Delete category "${category.name}"? This soft-deletes the record — assets and asset numbers keep their existing codes.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/asset-categories/${category.id}`);
      await fetchCategories();
    } catch (err) {
      window.alert(getApiErrorMessage(err, "Delete failed"));
    }
  };

  // Memoise the sorted list — categories rarely change but parent lookups
  // happen in every row render below, so keep the dropdown source stable.
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Categorise products and assets. The code is used as a segment of
            the asset number (e.g. WDS-<span className="font-mono">IT</span>-2026-00001).
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={handleAdd}
            data-tour="add-asset-category-btn"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add Category
          </button>
        )}
      </div>

      {pageError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      <div
        data-tour="asset-categories-table"
        className="overflow-hidden rounded-lg border bg-card"
      >
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading categories...
          </p>
        ) : sortedCategories.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No categories yet.{canManage && " Click \"Add Category\" to create one."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Parent</th>
                <th className="px-4 py-3 font-medium">Depreciation</th>
                <th className="px-4 py-3 font-medium">Products</th>
                {canManage && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {sortedCategories.map((c) => (
                <tr key={c.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {c.color && (
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-sm border"
                          style={{ backgroundColor: c.color }}
                          aria-hidden
                        />
                      )}
                      <span className="font-medium">{c.name}</span>
                    </div>
                    {c.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.parent ? `${c.parent.name} (${c.parent.code})` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.depreciationMethod === "NONE" ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <>
                        <span className="font-medium">
                          {c.depreciationMethod === "STRAIGHT_LINE"
                            ? "Straight line"
                            : "Declining balance"}
                        </span>
                        {(c.defaultDepreciationRate != null ||
                          c.defaultUsefulLifeMonths != null) && (
                          <span className="ml-1 text-muted-foreground">
                            (
                            {c.defaultDepreciationRate != null
                              ? `${c.defaultDepreciationRate}%/yr`
                              : ""}
                            {c.defaultDepreciationRate != null && c.defaultUsefulLifeMonths != null && ", "}
                            {c.defaultUsefulLifeMonths != null
                              ? `${c.defaultUsefulLifeMonths} mo`
                              : ""}
                            )
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c._count.products}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(c)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(c)}
                        disabled={c._count.products > 0}
                        title={
                          c._count.products > 0
                            ? `Reassign ${c._count.products} product(s) first`
                            : "Delete"
                        }
                        className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage && (
        <CategoryFormDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSuccess={() => void fetchCategories()}
          editing={editing}
          allCategories={categories}
        />
      )}
    </div>
  );
}
