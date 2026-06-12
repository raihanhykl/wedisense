"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { ArrowUpRight, Loader2, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGetPaginated } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { useAssetCategories } from "@/hooks/use-reference-data";
import { cn } from "@/lib/utils";
import ProductFormDialog from "@/components/shared/product-form-dialog";
import type { PaginationMeta } from "@/lib/api";
import type { ProductListItem } from "@/types/admin";

// ── Sort state ───────────────────────────────────────────────────────
type ProductSortField = "name" | "brand" | "createdAt" | "assetCount";
type SortOrder = "asc" | "desc";

// ── Sortable header ──────────────────────────────────────────────────
interface SortableHeaderProps {
  label: string;
  field: ProductSortField;
  currentSort: ProductSortField;
  currentOrder: SortOrder;
  onSort: (field: ProductSortField) => void;
  align?: "left" | "right";
}

function SortableHeader({
  label,
  field,
  currentSort,
  currentOrder,
  onSort,
  align = "left",
}: SortableHeaderProps) {
  const isActive = currentSort === field;
  const indicator = isActive ? (currentOrder === "asc" ? "↑" : "↓") : "↕";
  return (
    <th
      className={cn(
        "px-4 py-3 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
      aria-sort={isActive ? (currentOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className="text-xs opacity-60">{indicator}</span>
      </button>
    </th>
  );
}

// ── Source badge ─────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    API_UPCITEMDB: "UPCitemdb",
    API_BARCODELOOKUP: "Barcode Lookup",
    MANUAL: "Manual",
  };
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {labels[source] ?? source}
    </span>
  );
}

// ── Delete conflict dialog ────────────────────────────────────────────
// Shown when a product has active assets (pre-check) or when a 409 comes
// back from the server (totalAssetCount > 0 or purchaseOrderItemCount > 0).
interface DeleteBlockedDialogProps {
  product: ProductListItem;
  /** Details from a 409 PRODUCT_IN_USE response, if any. */
  conflictDetails?: {
    activeAssetCount: number;
    totalAssetCount: number;
    purchaseOrderItemCount: number;
  };
  onClose: () => void;
}

function DeleteBlockedDialog({
  product,
  conflictDetails,
  onClose,
}: DeleteBlockedDialogProps) {
  // Prefer the server details (409) because they include totalAssetCount
  // which may exceed the visible assetCount (active only).
  const activeAssets = conflictDetails?.activeAssetCount ?? product.assetCount;
  const totalAssets = conflictDetails?.totalAssetCount ?? product.assetCount;
  const poItems = conflictDetails?.purchaseOrderItemCount ?? product.purchaseOrderItemCount;
  const hasArchived = totalAssets > activeAssets;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-2 text-lg font-semibold">Cannot delete product</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          <strong className="text-foreground">{product.name}</strong> is still referenced by:
        </p>
        <ul className="mb-4 space-y-1 text-sm">
          {totalAssets > 0 && (
            <li>
              <span className="font-medium">{activeAssets}</span> active asset
              {activeAssets !== 1 ? "s" : ""}
              {hasArchived && (
                <span className="text-muted-foreground">
                  {" "}(plus {totalAssets - activeAssets} archived — including archived assets)
                </span>
              )}
            </li>
          )}
          {poItems > 0 && (
            <li>
              <span className="font-medium">{poItems}</span> purchase order item
              {poItems !== 1 ? "s" : ""} — referenced by purchase order items
            </li>
          )}
        </ul>
        <p className="mb-4 text-sm text-muted-foreground">
          Reassign or delete those assets first, then retry.
        </p>
        {totalAssets > 0 && (
          <Link
            href={`/admin/assets?productId=${product.id}`}
            className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            onClick={onClose}
          >
            View linked assets
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const canManage = usePermission("products:manage");
  const canDelete = usePermission("products:delete");

  const { data: categories = [] } = useAssetCategories();

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Debounced search — mirrors the assets page pattern exactly.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [sortField, setSortField] = useState<ProductSortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductListItem | null>(null);

  // Delete-blocked dialog state.
  const [blockedProduct, setBlockedProduct] = useState<ProductListItem | null>(null);
  const [conflictDetails, setConflictDetails] = useState<
    | { activeAssetCount: number; totalAssetCount: number; purchaseOrderItemCount: number }
    | undefined
  >(undefined);

  // ── Debounce search keystrokes ───────────────────────────────────
  useEffect(() => {
    if (searchInput === search) return;
    const t = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput, search]);

  // ── Fetch ────────────────────────────────────────────────────────
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        limit: 20,
        sort: sortField,
        order: sortOrder,
      };
      if (search.trim()) params.search = search.trim();
      if (categoryFilter) params.categoryId = categoryFilter;

      const result = await apiGetPaginated<ProductListItem[]>("/api/products", params);
      setProducts(result.data);
      setMeta(result.meta);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load products."));
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryFilter, sortField, sortOrder]);

  useEffect(() => {
    // No fetch for viewers behind the permission gate — the list endpoint is
    // open to all authenticated users, but loading data nobody can see is waste.
    if (!canManage) return;
    void fetchProducts();
  }, [canManage, fetchProducts]);

  // ── Permission gate ──────────────────────────────────────────────
  // Rendered AFTER all hooks so the hook order stays stable when the
  // permission flips mid-session (Rules of Hooks).
  if (!canManage) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
        data-tour="products-page"
      >
        <Package className="h-12 w-12 text-muted-foreground" />
        <div>
          <p className="font-semibold">Access denied</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You need the{" "}
            <code className="rounded bg-muted px-1 text-xs">products:manage</code>{" "}
            permission to manage the product catalog.
          </p>
        </div>
      </div>
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────
  const handleAdd = () => {
    setEditingProduct(null);
    setDialogOpen(true);
  };

  const handleEdit = (product: ProductListItem) => {
    setEditingProduct(product);
    setDialogOpen(true);
  };

  const handleSort = (field: ProductSortField) => {
    setPage(1);
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleDelete = async (product: ProductListItem) => {
    // Pre-check: active assets known from the list response.
    if (product.assetCount > 0) {
      setConflictDetails(undefined);
      setBlockedProduct(product);
      return;
    }
    if (!window.confirm(`Delete product "${product.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await apiDelete(`/api/products/${product.id}`);
      toast.success(`Product deleted: ${product.name}`);
      void fetchProducts();
    } catch (err) {
      // 409 PRODUCT_IN_USE — may have archived assets or PO items the list
      // count doesn't include.
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        // AppError serializes details as an array; the guard payload is its
        // first element.
        const details = (err.response.data?.error?.details as
          | Array<{ activeAssetCount: number; totalAssetCount: number; purchaseOrderItemCount: number }>
          | undefined)?.[0];
        setConflictDetails(details);
        setBlockedProduct(product);
        return;
      }
      toast.error(getApiErrorMessage(err, "Failed to delete product."));
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("id-ID", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  return (
    <div className="p-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal product catalog. Products are shared across assets and purchase
            orders — any EAN lookup result is cached here to avoid redundant API calls.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          data-tour="add-product-btn"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Product
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ maxWidth: "20rem" }}>
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search by name, brand, model, EAN..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
            data-tour="product-search"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="product-category-filter"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div
        data-tour="products-table"
        className="overflow-hidden rounded-lg border bg-card"
      >
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortableHeader
                label="Name"
                field="name"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHeader
                label="Brand"
                field="brand"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              <th className="px-4 py-3 text-left font-medium">Model</th>
              <th className="px-4 py-3 text-left font-medium">Category</th>
              <th className="px-4 py-3 text-left font-medium">Source</th>
              <SortableHeader
                label="Assets"
                field="assetCount"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
              <SortableHeader
                label="Created"
                field="createdAt"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {search.trim() || categoryFilter
                    ? "No products match the current filters."
                    : "No products yet. Click Add Product to create one."}
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  {/* Name + EAN */}
                  <td className="px-4 py-3">
                    <div className="font-medium">{product.name}</div>
                    {product.eanCode && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {product.eanCode}
                      </div>
                    )}
                  </td>
                  {/* Brand */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {product.brand ?? <span className="opacity-50">—</span>}
                  </td>
                  {/* Model */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {product.model ?? <span className="opacity-50">—</span>}
                  </td>
                  {/* Category */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {product.category.name}
                  </td>
                  {/* Source */}
                  <td className="px-4 py-3">
                    <SourceBadge source={product.source} />
                  </td>
                  {/* Assets count */}
                  <td className="px-4 py-3 text-right">
                    {product.assetCount > 0 ? (
                      <Link
                        href={`/admin/assets?productId=${product.id}`}
                        data-tour="product-view-assets-link"
                        className="inline-flex items-center justify-end gap-1 font-medium text-primary hover:underline"
                        title={`View ${product.assetCount} asset(s) for this product`}
                      >
                        {product.assetCount}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  {/* Created */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(product.createdAt)}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleEdit(product)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Edit product"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(product)}
                        className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                        title="Delete product"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────── */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing page {meta.page} of {meta.totalPages} ({meta.total} total products)
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Create / Edit dialog ─────────────────────────────────── */}
      <ProductFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => void fetchProducts()}
        editingProduct={editingProduct}
      />

      {/* ── Delete-blocked dialog ────────────────────────────────── */}
      {blockedProduct && (
        <DeleteBlockedDialog
          product={blockedProduct}
          conflictDetails={conflictDetails}
          onClose={() => {
            setBlockedProduct(null);
            setConflictDetails(undefined);
          }}
        />
      )}
    </div>
  );
}
