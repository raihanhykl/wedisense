"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGetPaginated, apiDelete } from "@/lib/api";
import api from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { AssetListItem } from "@/types/admin";
import PrintDialog from "@/components/shared/print-dialog";

// ── Status badge helpers ────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  IDLE: "bg-gray-100 text-gray-800",
  IN_MAINTENANCE: "bg-yellow-100 text-yellow-800",
  DISPOSED: "bg-red-100 text-red-800",
  LOST: "bg-red-100 text-red-800",
  BORROWED: "bg-blue-100 text-blue-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Currency formatter ──────────────────────────────────────────────
const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatIDR(value: string | null): string {
  if (!value) return "-";
  const num = Number(value);
  if (isNaN(num)) return "-";
  return idrFormatter.format(num);
}

// ── Location options type ───────────────────────────────────────────
interface LocationOption {
  id: string;
  name: string;
}

// ── Page ────────────────────────────────────────────────────────────
export default function AssetsPage() {
  const canCreate = usePermission("assets:create");
  const canUpdate = usePermission("assets:update");
  const canDelete = usePermission("assets:delete");
  const canPrint = usePermission("assets:print");
  const canExport = usePermission("assets:export");
  const canImport = usePermission("assets:import");

  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [page, setPage] = useState(1);
  const [locations, setLocations] = useState<LocationOption[]>([]);

  // Selection state for bulk print
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);

  // Export state
  const [exportLoading, setExportLoading] = useState(false);
  const [exportBanner, setExportBanner] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    try {
      const result = await apiGetPaginated<LocationOption[]>("/api/locations", {
        limit: 100,
      });
      setLocations(result.data);
    } catch {
      // handle error silently
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 10 };
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (locationFilter) params.locationId = locationFilter;

      const result = await apiGetPaginated<AssetListItem[]>(
        "/api/assets",
        params,
      );
      setAssets(result.data);
      setMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, locationFilter]);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };
  const handleLocationChange = (value: string) => {
    setLocationFilter(value);
    setPage(1);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this asset?")) return;
    try {
      await apiDelete(`/api/assets/${id}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      void fetchAssets();
    } catch {
      // handle error
    }
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)));
    }
  };

  const allSelected = assets.length > 0 && selectedIds.size === assets.length;
  const someSelected = selectedIds.size > 0;

  const handleExport = async () => {
    setExportLoading(true);
    setExportBanner(null);
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (locationFilter) params.locationId = locationFilter;

      const queryString = new URLSearchParams(params).toString();
      const url = `/api/assets/export${queryString ? `?${queryString}` : ""}`;

      const response = await api.get<Blob>(url, { responseType: "blob" });

      // Backend can return EITHER the xlsx file OR a JSON envelope
      // { success, data: { mode: 'async', reportId, ... } } for large exports.
      // We sniff Content-Type to discriminate.
      const contentType = response.headers["content-type"] as string | undefined;
      if (contentType && contentType.includes("application/json")) {
        const text = await response.data.text();
        const json = JSON.parse(text) as {
          data?: { mode?: string; reportId?: string; message?: string };
        };
        if (json.data?.mode === "async") {
          setExportBanner(
            json.data.message ??
              "Export queued — you'll be notified when the report is ready.",
          );
          return;
        }
        // Unexpected JSON — surface as error
        setExportBanner("Unexpected response from server. Please try again.");
        return;
      }

      // Blob download
      const blobUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = blobUrl;
      anchor.download = `wedisense-assets-${date}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setExportBanner(getApiErrorMessage(err, "Export failed. Please try again."));
    } finally {
      setExportLoading(false);
    }
  };

  const statusOptions = useMemo(
    () => ["ACTIVE", "IDLE", "IN_MAINTENANCE", "DISPOSED", "LOST", "BORROWED"],
    [],
  );

  return (
    <div className="p-6" data-tour="asset-list">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
        <div className="flex items-center gap-2">
          {canPrint && someSelected && (
            <button
              type="button"
              onClick={() => setPrintDialogOpen(true)}
              className="rounded-md border border-primary bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
            >
              Print Labels ({selectedIds.size})
            </button>
          )}
          {canExport && (
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exportLoading}
              data-tour="export-assets-btn"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {exportLoading ? "Exporting..." : "Export Excel"}
            </button>
          )}
          {canCreate && (
            <Link
              href="/admin/assets/new"
              data-tour="add-asset-btn"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add Asset
            </Link>
          )}
        </div>
      </div>

      {/* Export async banner */}
      {exportBanner && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span>{exportBanner}</span>
          <button
            type="button"
            onClick={() => setExportBanner(null)}
            className="ml-4 text-blue-600 hover:text-blue-800"
          >
            &times;
          </button>
        </div>
      )}

      {/* Import link */}
      {canImport && (
        <div className="mb-4 flex items-center gap-2">
          <Link
            href="/admin/assets/import"
            data-tour="import-assets-btn"
            className="text-sm text-primary hover:underline"
          >
            Import from Excel
          </Link>
        </div>
      )}

      {/* Filters bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name or asset number..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="asset-search"
        />
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          value={locationFilter}
          onChange={(e) => handleLocationChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All Locations</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      {/* Selected count bar */}
      {someSelected && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          <span className="font-medium">{selectedIds.size} asset(s) selected</span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">Asset #</th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Condition</th>
              <th className="px-4 py-3 text-left font-medium">Location</th>
              <th className="px-4 py-3 text-left font-medium">Assigned To</th>
              <th className="px-4 py-3 text-right font-medium">
                Purchase Price
              </th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading assets...
                </td>
              </tr>
            ) : assets.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No assets found.
                </td>
              </tr>
            ) : (
              assets.map((asset) => (
                <tr
                  key={asset.id}
                  className={cn(
                    "border-b last:border-b-0",
                    selectedIds.has(asset.id) && "bg-primary/5",
                  )}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(asset.id)}
                      onChange={() => toggleSelect(asset.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/assets/${asset.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {asset.assetNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium">{asset.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={asset.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {asset.condition}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {asset.location.name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {asset.assignedTo?.name ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {formatIDR(asset.purchasePrice)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canUpdate && (
                      <Link
                        href={`/admin/assets/${asset.id}/edit`}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Edit
                      </Link>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(asset.id)}
                        className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                      >
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

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing page {meta.page} of {meta.totalPages} ({meta.total} total
            assets)
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Print Dialog */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => {
          setPrintDialogOpen(false);
          setSelectedIds(new Set());
        }}
        assetIds={Array.from(selectedIds)}
      />
    </div>
  );
}
