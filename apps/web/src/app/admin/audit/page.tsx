"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSearch } from "lucide-react";
import { apiGetPaginated } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { usePermission } from "@/hooks/use-permission";
import { relativeTime, cn } from "@/lib/utils";
import AuditFilterBar from "@/components/shared/audit-filter-bar";
import AuditDetailDrawer, {
  AuditActionBadge,
} from "@/components/shared/audit-detail-drawer";
import type { AuditLogDto, AuditLogFilters } from "@/types/admin";
import type { PaginationMeta } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [20, 50, 100];

const EMPTY_FILTERS: AuditLogFilters = {
  search: "",
  action: "",
  resourceType: "",
  resourceTypeCustom: "",
  userId: "",
  dateFrom: "",
  dateTo: "",
};

// ── Build query params from filter state ──────────────────────────────
function buildParams(
  f: AuditLogFilters,
  page: number,
  limit: number,
): Record<string, unknown> {
  const params: Record<string, unknown> = { page, limit };
  if (f.search) params.search = f.search;
  if (f.action) params.action = f.action;
  // When "Other" is selected, use the custom value; otherwise use selected.
  const rt =
    f.resourceType === "__other__" ? f.resourceTypeCustom : f.resourceType;
  if (rt) params.resourceType = rt;
  if (f.userId) params.userId = f.userId;
  if (f.dateFrom) params.dateFrom = f.dateFrom;
  if (f.dateTo) params.dateTo = f.dateTo;
  return params;
}

function buildExportQs(f: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.action) params.set("action", f.action);
  const rt =
    f.resourceType === "__other__" ? f.resourceTypeCustom : f.resourceType;
  if (rt) params.set("resourceType", rt);
  if (f.userId) params.set("userId", f.userId);
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  return params.toString();
}

function hasActiveFilters(f: AuditLogFilters): boolean {
  return !!(
    f.search ||
    f.action ||
    f.resourceType ||
    f.resourceTypeCustom ||
    f.userId ||
    f.dateFrom ||
    f.dateTo
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b">
      {[40, 20, 12, 24, 16, 14].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-3.5 rounded bg-muted"
            style={{ width: `${w}%`, minWidth: "2rem" }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────
function MobileCard({
  entry,
  onClick,
}: {
  entry: AuditLogDto;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border-b px-4 py-3 text-left hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <AuditActionBadge action={entry.action} />
            <span className="text-sm font-medium">{entry.resourceType}</span>
          </div>
          {entry.user && (
            <p className="text-xs text-muted-foreground">
              {entry.user.name}{" "}
              <span className="opacity-70">({entry.user.email})</span>
            </p>
          )}
          {!entry.user && (
            <p className="text-xs text-muted-foreground">system</p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {entry.resourceId}
          </p>
        </div>
        <span
          title={entry.createdAt}
          className="shrink-0 text-xs text-muted-foreground"
        >
          {relativeTime(entry.createdAt)}
        </span>
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function AuditPage() {
  const canRead = usePermission("audit:read");
  const accessToken = useAuthStore((s) => s.accessToken);

  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [items, setItems] = useState<AuditLogDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = buildParams(filters, page, limit);
      const result = await apiGetPaginated<AuditLogDto[]>(
        "/api/audit-logs",
        params,
      );
      setItems(result.data);
      setMeta(result.meta);
    } catch {
      setError("Failed to load audit logs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, limit]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Reset page when filters change (not when page itself changes).
  const handleFiltersChange = (f: AuditLogFilters) => {
    setFilters(f);
    setPage(1);
  };

  const handleClear = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  // ── CSV export (blob download to send Authorization header) ──────
  const handleExport = async () => {
    if (!accessToken) return;
    setExporting(true);
    try {
      const qs = buildExportQs(filters);
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/audit-logs/export${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Export request failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dateStr = now
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 16);
      a.href = objectUrl;
      a.download = `audit-${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // ── Permission gate ──────────────────────────────────────────────
  if (!canRead) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
        data-tour="audit-page"
      >
        <FileSearch className="h-12 w-12 text-muted-foreground" />
        <div>
          <p className="font-semibold">Access denied</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You need the <code className="rounded bg-muted px-1 text-xs">audit:read</code>{" "}
            permission to view audit logs.
          </p>
        </div>
      </div>
    );
  }

  const activeFilters = hasActiveFilters(filters);
  const rangeStart = meta.total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, meta.total);

  return (
    <div className="flex h-full flex-col" data-tour="audit-page">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight" data-tour="audit-page-title">
          Audit Log
        </h1>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={meta.total === 0 || exporting || loading}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          data-tour="audit-export-btn"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────── */}
      <AuditFilterBar
        filters={filters}
        onChange={handleFiltersChange}
        onClear={handleClear}
      />

      {/* ── Error banner ────────────────────────────────────────────── */}
      {error && (
        <div className="mx-6 mt-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchLogs()}
            className="ml-4 font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Table — desktop ─────────────────────────────────────────── */}
      <div className="hidden flex-1 overflow-auto md:block" data-tour="audit-table">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b bg-card text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Timestamp</th>
              <th className="px-4 py-3 text-left font-medium">User</th>
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Resource</th>
              <th className="px-4 py-3 text-left font-medium">IP</th>
              <th className="px-4 py-3 text-left font-medium">
                <span className="sr-only">Detail</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              [...Array(5)].map((_, i) => <SkeletonRow key={i} />)}

            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    activeFilters={activeFilters}
                    onClear={handleClear}
                  />
                </td>
              </tr>
            )}

            {!loading &&
              items.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setSelectedLogId(entry.id)}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/40"
                  data-tour="audit-table-row"
                >
                  <td className="px-4 py-3">
                    <span
                      title={entry.createdAt}
                      className="whitespace-nowrap text-sm"
                    >
                      {relativeTime(entry.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {entry.user ? (
                      <div>
                        <p className="font-medium">{entry.user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.user.email}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        system
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <AuditActionBadge action={entry.action} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{entry.resourceType}</p>
                    <p
                      className="max-w-[180px] truncate text-xs text-muted-foreground"
                      title={entry.resourceId}
                    >
                      {entry.resourceId}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="max-w-[160px] truncate text-xs text-muted-foreground"
                      title={entry.ipAddress ?? ""}
                    >
                      {entry.ipAddress
                        ? entry.ipAddress.slice(0, 20)
                        : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-primary hover:underline">
                      View
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Cards — mobile ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto md:hidden" data-tour="audit-card-list">
        {loading && (
          <div className="space-y-0">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse border-b px-4 py-3">
                <div className="mb-2 flex gap-2">
                  <div className="h-5 w-16 rounded-full bg-muted" />
                  <div className="h-5 w-24 rounded bg-muted" />
                </div>
                <div className="h-3 w-3/4 rounded bg-muted" />
              </div>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <EmptyState activeFilters={activeFilters} onClear={handleClear} />
        )}

        {!loading &&
          items.map((entry) => (
            <MobileCard
              key={entry.id}
              entry={entry}
              onClick={() => setSelectedLogId(entry.id)}
            />
          ))}
      </div>

      {/* ── Pagination footer ────────────────────────────────────────── */}
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-3 text-sm",
        )}
        data-tour="audit-pagination"
      >
        <p className="text-muted-foreground">
          {meta.total === 0
            ? "No results"
            : `${rangeStart}–${rangeEnd} of ${meta.total}`}
        </p>

        <div className="flex items-center gap-3">
          {/* Page size selector */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Rows:</span>
            <select
              value={limit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1 text-xs"
              data-tour="audit-page-size"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* Prev / Next */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Detail drawer ────────────────────────────────────────────── */}
      <AuditDetailDrawer
        logId={selectedLogId}
        onClose={() => setSelectedLogId(null)}
      />
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────
function EmptyState({
  activeFilters,
  onClear,
}: {
  activeFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <FileSearch className="h-10 w-10 text-muted-foreground" />
      <p className="font-medium">No audit logs match these filters</p>
      {activeFilters && (
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
