"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { apiGet, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { cn } from "@/lib/utils";
import CategoryFormDialog from "@/components/shared/category-form-dialog";
import type { AssetCategoryDetail } from "@/types/admin";

// ── Page ────────────────────────────────────────────────────────────
// Tree table view: sub-categories render indented under their parent with
// expand/collapse per branch (all expanded by default — category trees are
// shallow). The Code column shows the full hierarchical code path ("IT/NB")
// since that is the segment stamped into asset numbers.

/** One renderable row of the category tree, in DFS order. */
interface CategoryTreeRow {
  category: AssetCategoryDetail;
  depth: number;
  hasChildren: boolean;
  /** Parent codes joined by "/" down to this node, e.g. "IT/NB". */
  codePath: string;
}

export default function AssetCategoriesPage() {
  const canManage = usePermission("categories:manage");
  const [categories, setCategories] = useState<AssetCategoryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategoryDetail | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  // ids of branches the user collapsed — empty set = everything expanded.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

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
    // Mirror the backend CATEGORY_HAS_CHILDREN guard so the user gets a
    // clear message instead of a 409 round-trip.
    if (categories.some((c) => c.parentId === category.id)) {
      window.alert(
        `Cannot delete "${category.name}" — it still has sub-categories. Delete or move them first.`,
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

  // DFS over the parentId links → ordered, depth-annotated rows. Children
  // sort alphabetically under their parent; collapsed branches are pruned.
  // A node whose parent is missing from the list (or unreachable through a
  // freak parent cycle) is promoted to root rather than silently dropped.
  const treeRows = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id));
    const childrenOf = new Map<string | null, AssetCategoryDetail[]>();
    for (const c of categories) {
      const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
      const list = childrenOf.get(key) ?? [];
      list.push(c);
      childrenOf.set(key, list);
    }
    childrenOf.forEach((list) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
    });

    const rows: CategoryTreeRow[] = [];
    const visited = new Set<string>();
    // `emit=false` keeps walking (so descendants of a collapsed branch still
    // count as visited) but stops producing rows.
    const walk = (parentKey: string | null, depth: number, prefix: string, emit: boolean) => {
      for (const c of childrenOf.get(parentKey) ?? []) {
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        const codePath = prefix ? `${prefix}/${c.code}` : c.code;
        const hasChildren = (childrenOf.get(c.id) ?? []).length > 0;
        if (emit) rows.push({ category: c, depth, hasChildren, codePath });
        walk(c.id, depth + 1, codePath, emit && !collapsedIds.has(c.id));
      }
    };
    walk(null, 0, "", true);

    // Members of a parent cycle have no root ancestor, so the walk above
    // never reaches them — surface them flat instead of hiding them.
    for (const c of categories) {
      if (!visited.has(c.id)) {
        const hasChildren = (childrenOf.get(c.id) ?? []).length > 0;
        rows.push({ category: c, depth: 0, hasChildren, codePath: c.code });
      }
    }
    return rows;
  }, [categories, collapsedIds]);

  const toggleBranch = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Categorise products and assets. The code path is used as a segment
            of the asset number — sub-category codes are prefixed by their
            parents (e.g. WDS-<span className="font-mono">IT/NB</span>-2026-00001).
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
        ) : treeRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No categories yet.{canManage && " Click \"Add Category\" to create one."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Code path</th>
                <th className="px-4 py-3 font-medium">Depreciation</th>
                <th className="px-4 py-3 font-medium">Products</th>
                {canManage && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {treeRows.map(({ category: c, depth, hasChildren, codePath }) => (
                <tr key={c.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div
                      className="flex items-start gap-1"
                      style={{ paddingLeft: `${depth * 24}px` }}
                    >
                      {/* Expand/collapse — invisible for leaves to keep alignment */}
                      <button
                        type="button"
                        onClick={() => toggleBranch(c.id)}
                        aria-label={collapsedIds.has(c.id) ? "Expand" : "Collapse"}
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent",
                          !hasChildren && "invisible",
                        )}
                      >
                        {collapsedIds.has(c.id) ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <div className="min-w-0">
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
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{codePath}</td>
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
                  <td className="px-4 py-3">
                    {c._count.products > 0 ? (
                      // Deep-link to the asset list pre-filtered to this
                      // category (the assets page seeds its filter from
                      // ?categoryId — exact match, same scope as this count).
                      <Link
                        href={`/admin/assets?categoryId=${c.id}`}
                        title={`View assets in "${c.name}"`}
                        data-tour="category-view-assets-link"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {c._count.products}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
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
                        disabled={c._count.products > 0 || hasChildren}
                        title={
                          c._count.products > 0
                            ? `Reassign ${c._count.products} product(s) first`
                            : hasChildren
                              ? "Delete or move its sub-categories first"
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
