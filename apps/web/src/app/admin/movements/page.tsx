"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGetPaginated, apiPost } from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { MovementListItem } from "@/types/admin";
import MovementFormDialog from "@/components/shared/movement-form-dialog";
import MovementTimeline from "@/components/shared/movement-timeline";

// ── Status badge colors ──────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-gray-100 text-gray-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {status}
    </span>
  );
}

// ── Movement type badge colors ───────────────────────────────────────
const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  ASSIGNMENT: "bg-blue-100 text-blue-800",
  UNASSIGNMENT: "bg-blue-100 text-blue-800",
  LOCATION_TRANSFER: "bg-purple-100 text-purple-800",
  LOAN_OUT: "bg-orange-100 text-orange-800",
  LOAN_RETURN: "bg-orange-100 text-orange-800",
  SWAP: "bg-indigo-100 text-indigo-800",
  SEND_TO_MAINTENANCE: "bg-yellow-100 text-yellow-800",
  RETURN_FROM_MAINTENANCE: "bg-yellow-100 text-yellow-800",
  DISPOSAL: "bg-red-100 text-red-800",
  FOUND: "bg-green-100 text-green-800",
  LOST: "bg-red-100 text-red-800",
  RESIGNATION_RETURN: "bg-gray-100 text-gray-800",
};

function MovementTypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        MOVEMENT_TYPE_COLORS[type] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

// ── Date formatter ──────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Movement types for filter ───────────────────────────────────────
const MOVEMENT_TYPES = [
  "ASSIGNMENT",
  "UNASSIGNMENT",
  "LOCATION_TRANSFER",
  "LOAN_OUT",
  "LOAN_RETURN",
  "SWAP",
  "SEND_TO_MAINTENANCE",
  "RETURN_FROM_MAINTENANCE",
  "DISPOSAL",
  "LOST",
  "FOUND",
  "RESIGNATION_RETURN",
];

const STATUSES = ["PENDING", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED"];

// ── Page ────────────────────────────────────────────────────────────
export default function MovementsPage() {
  const canCreate = usePermission("movements:create");
  const canApprove = usePermission("movements:approve");

  const [movements, setMovements] = useState<MovementListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchMovements = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 10 };
      if (search.trim()) params.search = search.trim();
      if (typeFilter) params.movementType = typeFilter;
      if (statusFilter) params.status = statusFilter;

      const result = await apiGetPaginated<MovementListItem[]>(
        "/api/movements",
        params,
      );
      setMovements(result.data);
      setMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, statusFilter]);

  useEffect(() => {
    void fetchMovements();
  }, [fetchMovements]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const handleTypeChange = (value: string) => {
    setTypeFilter(value);
    setPage(1);
  };
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleApprove = async (id: string) => {
    try {
      await apiPost(`/api/movements/${id}/approve`);
      void fetchMovements();
    } catch {
      // handle error
    }
  };

  const handleReject = async (id: string) => {
    try {
      await apiPost(`/api/movements/${id}/reject`);
      void fetchMovements();
    } catch {
      // handle error
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-6" data-tour="movement-list">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Movements</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New Movement
          </button>
        )}
      </div>

      {/* Filters bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by reference number..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All Types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Reference #</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Asset</th>
              <th className="px-4 py-3 text-left font-medium">From / To</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              {canApprove && (
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={canApprove ? 7 : 6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading movements...
                </td>
              </tr>
            ) : movements.length === 0 ? (
              <tr>
                <td
                  colSpan={canApprove ? 7 : 6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No movements found.
                </td>
              </tr>
            ) : (
              movements.map((movement) => {
                const fromLabel =
                  movement.fromUser?.name ??
                  movement.fromLocation?.name ??
                  "-";
                const toLabel =
                  movement.toUser?.name ??
                  movement.toLocation?.name ??
                  "-";
                const isExpanded = expandedId === movement.id;

                return (
                  <tr key={movement.id} className="group border-b last:border-b-0">
                    <td colSpan={canApprove ? 7 : 6} className="p-0">
                      {/* Main row */}
                      <button
                        type="button"
                        className="flex w-full items-center text-left hover:bg-accent/50"
                        onClick={() => toggleExpand(movement.id)}
                      >
                        <span className="w-[15%] px-4 py-3 font-medium text-primary">
                          {movement.referenceNumber}
                        </span>
                        <span className="w-[15%] px-4 py-3">
                          <MovementTypeBadge type={movement.movementType} />
                        </span>
                        <span className="w-[15%] px-4 py-3">
                          {movement.asset.name}
                        </span>
                        <span className="w-[20%] px-4 py-3 text-muted-foreground">
                          {fromLabel} &rarr; {toLabel}
                        </span>
                        <span className="w-[10%] px-4 py-3">
                          <StatusBadge status={movement.status} />
                        </span>
                        <span className="w-[10%] px-4 py-3 text-muted-foreground">
                          {formatDate(movement.createdAt)}
                        </span>
                        {canApprove && (
                          <span className="w-[15%] px-4 py-3 text-right">
                            {movement.status === "PENDING" && (
                              <span className="flex justify-end gap-1">
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleApprove(movement.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.stopPropagation();
                                      void handleApprove(movement.id);
                                    }
                                  }}
                                  className="cursor-pointer rounded px-2 py-1 text-xs text-green-700 hover:bg-green-100"
                                >
                                  Approve
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleReject(movement.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.stopPropagation();
                                      void handleReject(movement.id);
                                    }
                                  }}
                                  className="cursor-pointer rounded px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                                >
                                  Reject
                                </span>
                              </span>
                            )}
                          </span>
                        )}
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="border-t bg-muted/30 px-6 py-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="font-medium">Asset</p>
                              <p className="text-muted-foreground">
                                {movement.asset.assetNumber} -{" "}
                                {movement.asset.name}
                              </p>
                            </div>
                            <div>
                              <p className="font-medium">Performed By</p>
                              <p className="text-muted-foreground">
                                {movement.performedBy.name}
                              </p>
                            </div>
                            {movement.approvedBy && (
                              <div>
                                <p className="font-medium">Approved By</p>
                                <p className="text-muted-foreground">
                                  {movement.approvedBy.name}
                                </p>
                              </div>
                            )}
                            {movement.expectedReturnDate && (
                              <div>
                                <p className="font-medium">
                                  Expected Return Date
                                </p>
                                <p className="text-muted-foreground">
                                  {formatDate(movement.expectedReturnDate)}
                                </p>
                              </div>
                            )}
                            {movement.actualReturnDate && (
                              <div>
                                <p className="font-medium">
                                  Actual Return Date
                                </p>
                                <p className="text-muted-foreground">
                                  {formatDate(movement.actualReturnDate)}
                                </p>
                              </div>
                            )}
                            {movement.notes && (
                              <div className="col-span-2">
                                <p className="font-medium">Notes</p>
                                <p className="text-muted-foreground">
                                  {movement.notes}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing page {meta.page} of {meta.totalPages} ({meta.total} total
            movements)
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

      {/* Create Movement Dialog */}
      <MovementFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => void fetchMovements()}
      />
    </div>
  );
}
