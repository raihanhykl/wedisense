"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { relativeTime } from "@/lib/utils";
import type { NotificationItem } from "@/types/admin";

export default function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bellRef = useRef<HTMLDivElement>(null);
  useOutsideClick(bellRef, () => setOpen(false), open);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await apiGet<{ count: number }>(
        "/api/notifications/unread-count",
      );
      setUnreadCount(data.count);
    } catch {
      // silent — badge failing should not surface
    }
  }, []);

  useEffect(() => {
    void fetchUnread();
    const id = setInterval(() => void fetchUnread(), 30_000);
    return () => clearInterval(id);
  }, [fetchUnread]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<NotificationItem[]>("/api/notifications", {
        limit: 5,
      });
      setItems(res);
    } catch {
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void fetchList();
  }, [open, fetchList]);

  const onItemClick = async (n: NotificationItem) => {
    if (!n.isRead) {
      try {
        await apiPut<{ id: string }>(`/api/notifications/${n.id}/read`);
        setItems((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // silent — mark read failing is non-critical
      }
    }
    if (n.data?.url) {
      setOpen(false);
      router.push(n.data.url);
    }
  };

  const onMarkAllRead = async () => {
    try {
      await apiPut<{ count: number }>("/api/notifications/read-all");
      setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  };

  return (
    <div ref={bellRef} className="relative" data-tour="notification-bell">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border bg-card shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b p-3">
            <span className="text-sm font-medium">Notifications</span>
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              disabled={unreadCount === 0}
              className="text-xs text-blue-600 hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all read
            </button>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            )}
            {!loading && error && (
              <div className="p-4 text-center text-sm text-red-600">
                {error}
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No notifications
              </div>
            )}
            {!loading &&
              !error &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void onItemClick(n)}
                  className="block w-full border-b p-3 text-left hover:bg-muted/50 last:border-b-0"
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm ${n.isRead ? "font-normal" : "font-medium"}`}
                      >
                        {n.title}
                      </div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {n.message}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
          </div>

          {/* Footer */}
          <Link
            href="/admin/notifications"
            onClick={() => setOpen(false)}
            className="block border-t p-3 text-center text-sm hover:bg-muted/50"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
