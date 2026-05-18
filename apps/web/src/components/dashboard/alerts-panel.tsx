"use client";

import Link from "next/link";
import type { DashboardAlerts } from "@/types/admin";
import { cn } from "@/lib/utils";

interface AlertsPanelProps {
  data: DashboardAlerts | null;
  loading: boolean;
  error: string;
}

interface AlertTile {
  key: keyof DashboardAlerts;
  label: string;
  icon: string;
  href: string;
}

const TILES: AlertTile[] = [
  {
    key: "warrantyExpiring",
    label: "Warranty Expiring",
    icon: "⚠",
    href: "/admin/assets?warrantyExpiring=true",
  },
  {
    key: "loanOverdue",
    label: "Overdue Loans",
    icon: "⏰",
    href: "/admin/movements?overdue=true",
  },
  {
    key: "maintenanceDue",
    label: "Maintenance Due",
    icon: "🔧",
    href: "/admin/maintenance",
  },
  {
    key: "unreadNotifications",
    label: "Unread Notifications",
    icon: "🔔",
    href: "/admin/notifications",
  },
];

export default function AlertsPanel({ data, loading, error }: AlertsPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {loading &&
        Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border bg-muted"
          />
        ))}

      {!loading && error && (
        <p className="col-span-4 text-xs text-destructive">{error}</p>
      )}

      {!loading &&
        !error &&
        data &&
        TILES.map((tile) => {
          const count = data[tile.key];
          const hasAlert = count > 0;

          return (
            <Link
              key={tile.key}
              href={tile.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded-lg border p-4 text-center transition-colors hover:shadow-sm",
                hasAlert
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {tile.icon}
              </span>
              <span
                className={cn(
                  "text-2xl font-bold",
                  hasAlert ? "text-red-600" : "text-foreground",
                )}
              >
                {count}
              </span>
              <span className="text-xs font-medium">{tile.label}</span>
            </Link>
          );
        })}
    </div>
  );
}
