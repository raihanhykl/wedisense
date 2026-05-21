"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { apiGetPaginated } from "@/lib/api";
import { usePermission } from "@/hooks/use-permission";
import { formatIDR } from "@/lib/utils";
import { ProcurementBatchStatusBadge } from "@/components/shared/procurement-status-badge";
import type {
  ProcurementBatchListItem,
  ProcurementBatchStatus,
} from "@/types/admin";
import type { PaginationMeta } from "@/lib/api";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const STATUS_OPTIONS: Array<{ value: ProcurementBatchStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "ITEMS_PENDING", label: "Items Pending" },
  { value: "RECEIVED", label: "Received" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

interface Filters {
  search: string;
  status: ProcurementBatchStatus | "";
  vendor: string;
  bastNumber: string;
  invoiceNumber: string;
  purchaseDateFrom: string;
  purchaseDateTo: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "",
  vendor: "",
  bastNumber: "",
  invoiceNumber: "",
  purchaseDateFrom: "",
  purchaseDateTo: "",
};

function buildParams(
  f: Filters,
  page: number,
  limit: number,
): Record<string, unknown> {
  const params: Record<string, unknown> = { page, limit };
  if (f.search) params.search = f.search;
  if (f.status) params.status = f.status;
  if (f.vendor) params.vendor = f.vendor;
  if (f.bastNumber) params.bastNumber = f.bastNumber;
  if (f.invoiceNumber) params.invoiceNumber = f.invoiceNumber;
  if (f.purchaseDateFrom) {
    params.purchaseDateFrom = `${f.purchaseDateFrom}T00:00:00.000Z`;
  }
  if (f.purchaseDateTo) {
    params.purchaseDateTo = `${f.purchaseDateTo}T23:59:59.999Z`;
  }
  return params;
}

function hasActiveFilters(f: Filters): boolean {
  return !!(
    f.search ||
    f.status ||
    f.vendor ||
    f.bastNumber ||
    f.invoiceNumber ||
    f.purchaseDateFrom ||
    f.purchaseDateTo
  );
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
  if (currency === "IDR") return formatIDR(amount);
  return `${currency} ${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(amount))}`;
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b">
      {[28, 32, 16, 24, 20, 12, 20].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3.5 rounded bg-muted" style={{ width: `${w * 4}px` }} />
        </td>
      ))}
    </tr>
  );
}

export default function ProcurementBatchesPage() {
  const canCreate = usePermission("procurement:create");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<ProcurementBatchListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce free-text inputs. Status + dates commit immediately.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedVendor, setDebouncedVendor] = useState("");
  const [debouncedBast, setDebouncedBast] = useState("");
  const [debouncedInvoice, setDebouncedInvoice] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedVendor(filters.vendor), 300);
    return () => clearTimeout(t);
  }, [filters.vendor]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBast(filters.bastNumber), 300);
    return () => clearTimeout(t);
  }, [filters.bastNumber]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInvoice(filters.invoiceNumber), 300);
    return () => clearTimeout(t);
  }, [filters.invoiceNumber]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    debouncedVendor,
    debouncedBast,
    debouncedInvoice,
    filters.status,
    filters.purchaseDateFrom,
    filters.purchaseDateTo,
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
        bastNumber: debouncedBast,
        invoiceNumber: debouncedInvoice,
      };
      const { data, meta: nextMeta } = await apiGetPaginated<
        ProcurementBatchListItem[]
      >("/api/procurement-batches", buildParams(effectiveFilters, page, limit));
      setRows(data);
      setMeta(nextMeta);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load procurement batches",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters,
    debouncedSearch,
    debouncedVendor,
    debouncedBast,
    debouncedInvoice,
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
          <h1 className="text-2xl font-semibold tracking-tight">Procurement Batches</h1>
          <p className="text-sm text-muted-foreground">
            Each batch represents one physical hand-over event (BAST). Batches
            may be linked to a parent Purchase Order or stand alone as a
            direct-purchase record.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/admin/procurement/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            data-tour="procurement-create"
          >
            <Plus className="h-4 w-4" />
            New Batch
          </Link>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
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
                placeholder="Batch #, name, BAST #, invoice #…"
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
              Vendor
            </label>
            <input
              type="text"
              value={filters.vendor}
              onChange={(e) =>
                setFilters((p) => ({ ...p, vendor: e.target.value }))
              }
              placeholder="From parent PO"
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              BAST #
            </label>
            <input
              type="text"
              value={filters.bastNumber}
              onChange={(e) =>
                setFilters((p) => ({ ...p, bastNumber: e.target.value }))
              }
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Invoice #
            </label>
            <input
              type="text"
              value={filters.invoiceNumber}
              onChange={(e) =>
                setFilters((p) => ({ ...p, invoiceNumber: e.target.value }))
              }
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Purchase date from
            </label>
            <input
              type="date"
              value={filters.purchaseDateFrom}
              onChange={(e) =>
                setFilters((p) => ({ ...p, purchaseDateFrom: e.target.value }))
              }
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Purchase date to
            </label>
            <input
              type="date"
              value={filters.purchaseDateTo}
              onChange={(e) =>
                setFilters((p) => ({ ...p, purchaseDateTo: e.target.value }))
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

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Batch #</th>
                <th className="px-4 py-2 font-medium">Parent PO</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">BAST</th>
                <th className="px-4 py-2 font-medium">Received</th>
                <th className="px-4 py-2 text-right font-medium">Assets</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
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
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {hasActiveFilters(filters)
                      ? "No batches match these filters."
                      : "No batches yet. Click New Batch to start."}
                  </td>
                </tr>
              ) : (
                rows.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/procurement/${b.id}`}
                        className="font-mono text-sm font-medium text-primary hover:underline"
                      >
                        {b.batchNumber}
                      </Link>
                      {b.name && (
                        <div className="text-xs text-muted-foreground">{b.name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.purchaseOrder ? (
                        <Link
                          href={`/admin/purchase-orders/${b.purchaseOrder.id}`}
                          className="text-sm hover:underline"
                        >
                          <span className="font-mono text-primary">
                            {b.purchaseOrder.poNumber}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {b.purchaseOrder.vendor}
                          </div>
                        </Link>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          Direct purchase
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ProcurementBatchStatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {b.bastNumber ? (
                        <div className="space-y-0.5">
                          <div className="font-mono text-foreground">{b.bastNumber}</div>
                          <div className="text-muted-foreground">
                            {formatDate(b.bastDate)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(b.receivedDate)}
                    </td>
                    <td className="px-4 py-3 text-right">{b.assetCount}</td>
                    <td className="px-4 py-3 text-right">
                      {formatTotal(b.totalAmount, b.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
