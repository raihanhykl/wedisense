"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { relativeTime } from "@/lib/utils";
import type { NotificationItem } from "@/types/admin";

// 30s background poll for the unread badge. TanStack Query's
// `refetchInterval` automatically pauses while the tab is hidden, so a user
// who walks away from their laptop doesn't keep hitting the API for nothing
// — that alone cuts the previous `setInterval` polling traffic in half on
// most laptops (background tabs were polling continuously). Tab refocus
// immediately fires a fresh poll so badges feel live on return.
const UNREAD_REFETCH_MS = 30_000;

export default function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  useOutsideClick(bellRef, () => setOpen(false), open);

  // Badge count — polled in the background, shared cache across any future
  // component that wants to read it.
  const { data: unreadData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () =>
      apiGet<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: UNREAD_REFETCH_MS,
    // Override the global "don't refetch on focus" default — for a notification
    // bell, refetching on tab-focus IS the right call so users see fresh state
    // immediately when they come back.
    refetchOnWindowFocus: true,
    // Keep the badge value snappy — don't show stale-then-fresh flicker.
    staleTime: 0,
  });
  const unreadCount = unreadData?.count ?? 0;

  // List — only fetched while the dropdown is open. Closing the dropdown
  // doesn't unmount; we just toggle `enabled` so the query goes quiet.
  const { data: items = [], isLoading: loading, isError: errorFlag } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () => apiGet<NotificationItem[]>("/api/notifications", { limit: 5 }),
    enabled: open,
    staleTime: 30_000,
  });
  const error = errorFlag ? "Failed to load notifications" : "";

  const onItemClick = async (n: NotificationItem) => {
    if (!n.isRead) {
      try {
        await apiPut<{ id: string }>(`/api/notifications/${n.id}/read`);
        // Update both cached queries optimistically. Background poll will
        // confirm next tick.
        queryClient.setQueryData<NotificationItem[]>(
          ["notifications", "list"],
          (prev) =>
            prev?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ??
            prev,
        );
        queryClient.setQueryData<{ count: number }>(
          ["notifications", "unread-count"],
          (prev) =>
            prev ? { count: Math.max(0, prev.count - 1) } : prev,
        );
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
      queryClient.setQueryData<NotificationItem[]>(
        ["notifications", "list"],
        (prev) => prev?.map((x) => ({ ...x, isRead: true })) ?? prev,
      );
      queryClient.setQueryData<{ count: number }>(
        ["notifications", "unread-count"],
        { count: 0 },
      );
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
