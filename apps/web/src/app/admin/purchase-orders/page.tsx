"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { apiGetPaginated } from "@/lib/api";
import { usePermission } from "@/hooks/use-permission";
import { formatIDR } from "@/lib/utils";
import { PurchaseOrderStatusBadge } from "@/components/shared/procurement-status-badge";
import type {
  PurchaseOrderListItem,
  PurchaseOrderStatus,
} from "@/types/admin";
import type { PaginationMeta } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const STATUS_OPTIONS: Array<{ value: PurchaseOrderStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "PARTIALLY_RECEIVED", label: "Partially Received" },
  { value: "FULLY_RECEIVED", label: "Fully Received" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
];

interface Filters {
  search: string;
  status: PurchaseOrderStatus | "";
  vendor: string;
  poDateFrom: string;
  poDateTo: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "",
  vendor: "",
  poDateFrom: "",
  poDateTo: "",
};

function buildParams(f: Filters, page: number, limit: number): Record<string, unknown> {
  const params: Record<string, unknown> = { page, limit };
  if (f.search) params.search = f.search;
  if (f.status) params.status = f.status;
  if (f.vendor) params.vendor = f.vendor;
  // Backend expects ISO-8601 datetimes. The HTML date input emits YYYY-MM-DD;
  // we promote to start-of-day UTC for `from` and end-of-day UTC for `to`.
  if (f.poDateFrom) params.poDateFrom = `${f.poDateFrom}T00:00:00.000Z`;
  if (f.poDateTo) params.poDateTo = `${f.poDateTo}T23:59:59.999Z`;
  return params;
}

function hasActiveFilters(f: Filters): boolean {
  return !!(f.search || f.status || f.vendor || f.poDateFrom || f.poDateTo);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTotal(amount: string | null, currency: string): string {
  if (!amount) return "—";
  // Backend serialises Decimal as string; formatIDR handles either.
  if (currency === "IDR") return formatIDR(amount);
  // Non-IDR rare today; show with explicit currency prefix.
  return `${currency} ${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(amount))}`;
}

// ── Skeleton row ──────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b">
      {[28, 32, 16, 20, 12, 12, 20, 16].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3.5 rounded bg-muted" style={{ width: `${w * 4}px` }} />
        </td>
      ))}
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const canCreate = usePermission("purchase-orders:create");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<PurchaseOrderListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce free-text inputs (search, vendor) so we don't fire a request
  // per keystroke. Status + date inputs commit instantly because they
  // change once per interaction.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedVendor, setDebouncedVendor] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedVendor(filters.vendor), 300);
    return () => clearTimeout(t);
  }, [filters.vendor]);

  // Reset to page 1 when the filter shape changes — otherwise we'd land
  // on page N of a result set that may not have N pages anymore.
  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    debouncedVendor,
    filters.status,
    filters.poDateFrom,
    filters.poDateTo,
    limit,
  ]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const effectiveFilters: Filters = {
        ...filters,
        search: debouncedSearch,
        vendor: debouncedVendor,
      };
      const { data, meta: nextMeta } = await apiGetPaginated<PurchaseOrderListItem[]>(
        "/purchase-orders",
        buildParams(effectiveFilters, page, limit),
      );
      setRows(data);
      setMeta(nextMeta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchase orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters,
    debouncedSearch,
    debouncedVendor,
    page,
    limit,
  ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalPages = meta.totalPages;
  const showingFrom = useMemo(
    () => (meta.total === 0 ? 0 : (page - 1) * limit + 1),
    [meta.total, page, limit],
  );
  const showingTo = useMemo(
    () => Math.min(page * limit, meta.total),
    [page, limit, meta.total],
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">
            Commercial commitments to vendors. Each PO contains one or more
            procurement batches.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/admin/purchase-orders/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            data-tour="po-create"
          >
            <Plus className="h-4 w-4" />
            New Purchase Order
          </Link>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Search
            </label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, search: e.target.value }))
                }
                placeholder="PO number, name, vendor…"
                className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((p) => ({
                  ...p,
                  status: e.target.value as Filters["status"],
                }))
              }
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              PO date from
            </label>
            <input
              type="date"
              value={filters.poDateFrom}
              onChange={(e) =>
                setFilters((p) => ({ ...p, poDateFrom: e.target.value }))
              }
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              PO date to
            </label>
            <input
              type="date"
              value={filters.poDateTo}
              onChange={(e) =>
                setFilters((p) => ({ ...p, poDateTo: e.target.value }))
              }
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        {hasActiveFilters(filters) && (
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">PO #</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">PO date</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Batches</th>
                <th className="px-4 py-2 text-right font-medium">Assets</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {hasActiveFilters(filters)
                      ? "No purchase orders match these filters."
                      : "No purchase orders yet. Click New Purchase Order to start."}
                  </td>
                </tr>
              ) : (
                rows.map((po) => (
                  <tr
                    key={po.id}
                    className="border-b transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/purchase-orders/${po.id}`}
                        className="font-mono text-sm font-medium text-primary hover:underline"
                      >
                        {po.poNumber}
                      </Link>
                      {po.name && (
                        <div className="text-xs text-muted-foreground">
                          {po.name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{po.vendor}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(po.poDate)}
                    </td>
                    <td className="px-4 py-3">
                      <PurchaseOrderStatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 text-right">{po.batchCount}</td>
                    <td className="px-4 py-3 text-right">{po.assetCount}</td>
                    <td className="px-4 py-3 text-right">
                      {formatTotal(po.totalAmount, po.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(po.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
            <div className="text-muted-foreground">
              Showing <span className="font-medium text-foreground">{showingFrom}</span>–
              <span className="font-medium text-foreground">{showingTo}</span> of{" "}
              <span className="font-medium text-foreground">{meta.total}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Per page</span>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                >
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="rounded-md border px-2 py-1 text-sm disabled:opacity-40 hover:bg-muted disabled:hover:bg-transparent"
                >
                  Prev
                </button>
                <span className="px-2 text-muted-foreground">
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="rounded-md border px-2 py-1 text-sm disabled:opacity-40 hover:bg-muted disabled:hover:bg-transparent"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
