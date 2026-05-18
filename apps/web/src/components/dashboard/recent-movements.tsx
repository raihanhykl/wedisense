"use client";

import Link from "next/link";
import type { RecentMovement } from "@/types/admin";
import { relativeTime, cn } from "@/lib/utils";

interface RecentMovementsProps {
  data: RecentMovement[];
  loading: boolean;
  error: string;
}

const MOVEMENT_COLORS: Record<string, string> = {
  ASSIGNMENT: "bg-blue-100 text-blue-700",
  UNASSIGNMENT: "bg-blue-100 text-blue-700",
  LOAN_OUT: "bg-indigo-100 text-indigo-700",
  LOAN_RETURN: "bg-indigo-100 text-indigo-700",
  LOCATION_TRANSFER: "bg-purple-100 text-purple-700",
  DISPOSAL: "bg-red-100 text-red-700",
  LOST: "bg-red-100 text-red-700",
  FOUND: "bg-emerald-100 text-emerald-700",
  SEND_TO_MAINTENANCE: "bg-amber-100 text-amber-700",
  RETURN_FROM_MAINTENANCE: "bg-amber-100 text-amber-700",
  RESIGNATION_RETURN: "bg-orange-100 text-orange-700",
  SWAP: "bg-cyan-100 text-cyan-700",
  INITIAL: "bg-gray-100 text-gray-600",
};

function formatMovementType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function buildSubtitle(m: RecentMovement): string {
  const parts: string[] = [];
  if (m.fromLocation?.name) parts.push(m.fromLocation.name);
  if (m.toLocation?.name) {
    parts.push(`→ ${m.toLocation.name}`);
  } else if (m.fromUser?.name) {
    parts.push(`from ${m.fromUser.name}`);
  }
  if (m.toUser?.name) parts.push(`→ ${m.toUser.name}`);
  return parts.join(" ") || `by ${m.performedBy.name}`;
}

export default function RecentMovements({
  data,
  loading,
  error,
}: RecentMovementsProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Recent Movements
      </h3>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!loading && !error && data.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No recent movements
        </p>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="divide-y">
          {data.map((m) => (
            <Link
              key={m.id}
              href={`/admin/assets/${m.asset.id}`}
              className="flex items-start gap-3 py-3 text-left transition-colors hover:bg-muted/30 -mx-4 px-4"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                  MOVEMENT_COLORS[m.movementType] ?? "bg-gray-100 text-gray-600",
                )}
              >
                {formatMovementType(m.movementType)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.asset.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.asset.assetNumber} · {buildSubtitle(m)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">
                  {relativeTime(m.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">{m.referenceNumber}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
