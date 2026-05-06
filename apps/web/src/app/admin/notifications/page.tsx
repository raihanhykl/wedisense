"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetPaginated, apiPut } from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { NotificationItem, NotificationType } from "@/types/admin";

// ── Type badge helpers ──────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  WARRANTY_EXPIRING: "bg-yellow-100 text-yellow-800",
  LOAN_OVERDUE: "bg-red-100 text-red-800",
  MAINTENANCE_DUE: "bg-orange-100 text-orange-800",
  ASSET_LOST: "bg-red-100 text-red-800",
  ASSET_DISPOSED: "bg-gray-100 text-gray-800",
  REPORT_READY: "bg-green-100 text-green-800",
  PRINT_READY: "bg-blue-100 text-blue-800",
  IMPORT_COMPLETE: "bg-green-100 text-green-800",
  TOUR_UPDATED: "bg-purple-100 text-purple-800",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        TYPE_COLORS[type] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All Types" },
  { value: "WARRANTY_EXPIRING", label: "WARRANTY EXPIRING" },
  { value: "LOAN_OVERDUE", label: "LOAN OVERDUE" },
  { value: "MAINTENANCE_DUE", label: "MAINTENANCE DUE" },
  { value: "ASSET_LOST", label: "ASSET LOST" },
  { value: "ASSET_DISPOSED", label: "ASSET DISPOSED" },
  { value: "REPORT_READY", label: "REPORT READY" },
  { value: "PRINT_READY", label: "PRINT READY" },
  { value: "IMPORT_COMPLETE", label: "IMPORT COMPLETE" },
  { value: "TOUR_UPDATED", label: "TOUR UPDATED" },
];

export default function NotificationsPage() {
  const router = useRouter();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [readFilter, setReadFilter] = useState("");

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, unknown> = { page, limit: 20 };
      if (typeFilter) params.type = typeFilter as NotificationType;
      if (readFilter !== "") params.isRead = readFilter;

      const result = await apiGetPaginated<NotificationItem[]>(
        "/api/notifications",
        params,
      );
      setItems(result.data);
      setMeta(result.meta);
    } catch {
      setError("Failed to load notifications. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, readFilter]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const handleTypeChange = (value: string) => {
    setTypeFilter(value);
    setPage(1);
  };

  const handleReadChange = (value: string) => {
    setReadFilter(value);
    setPage(1);
  };

  const onMarkRead = async (id: string) => {
    try {
      await apiPut<{ id: string }>(`/api/notifications/${id}/read`);
      setItems((prev) =>
        prev.map((x) => (x.id === id ? { ...x, isRead: true } : x)),
      );
    } catch {
      setError("Failed to mark notification as read.");
    }
  };

  const onMarkAllRead = async () => {
    try {
      await apiPut<{ count: number }>("/api/notifications/read-all");
      setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
    } catch {
      setError("Failed to mark all notifications as read.");
    }
  };

  const onRowClick = async (n: NotificationItem) => {
    if (!n.isRead) {
      await onMarkRead(n.id);
    }
    if (n.data?.url) {
      router.push(n.data.url);
    }
  };

  const unreadCount = items.filter((n) => !n.isRead).length;

  return (
    <div className="p-6" data-tour="notifications-page">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <button
          type="button"
          onClick={() => void onMarkAllRead()}
          disabled={unreadCount === 0}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          data-tour="mark-all-read-btn"
        >
          Mark all read
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="notification-type-filter"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={readFilter}
          onChange={(e) => handleReadChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="notification-read-filter"
        >
          <option value="">All</option>
          <option value="false">Unread</option>
          <option value="true">Read</option>
        </select>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* List */}
      <div className="overflow-hidden rounded-lg border bg-card">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading notifications...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No notifications found.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id}>
                <div
                  className={cn(
                    "flex items-start gap-3 px-4 py-4",
                    !n.isRead && "bg-blue-50/40",
                  )}
                >
                  {/* Unread dot */}
                  <div className="mt-1 w-2 shrink-0">
                    {!n.isRead && (
                      <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>

                  {/* Content — clickable area */}
                  <button
                    type="button"
                    onClick={() => void onRowClick(n)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <TypeBadge type={n.type} />
                      <span
                        className={cn(
                          "text-sm",
                          n.isRead ? "font-normal" : "font-semibold",
                        )}
                      >
                        {n.title}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {n.message}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </p>
                  </button>

                  {/* Mark read action */}
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => void onMarkRead(n.id)}
                      className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing page {meta.page} of {meta.totalPages} ({meta.total} total)
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
