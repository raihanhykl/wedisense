"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGetPaginated, apiDelete } from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { AssetListItem } from "@/types/admin";

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
      void fetchAssets();
    } catch {
      // handle error
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

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
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
                  colSpan={8}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading assets...
                </td>
              </tr>
            ) : assets.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No assets found.
                </td>
              </tr>
            ) : (
              assets.map((asset) => (
                <tr key={asset.id} className="border-b last:border-b-0">
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
    </div>
  );
}
