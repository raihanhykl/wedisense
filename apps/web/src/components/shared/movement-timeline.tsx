"use client";

import { cn } from "@/lib/utils";
import type { MovementListItem } from "@/types/admin";

// ── Movement type badge colors ──────────────────────────────────────
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

function formatFromTo(movement: MovementListItem): string {
  const from =
    movement.fromUser?.name ?? movement.fromLocation?.name ?? "-";
  const to =
    movement.toUser?.name ?? movement.toLocation?.name ?? "-";
  return `${from} \u2192 ${to}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface MovementTimelineProps {
  movements: MovementListItem[];
}

export default function MovementTimeline({
  movements,
}: MovementTimelineProps) {
  if (movements.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No movement history.
      </p>
    );
  }

  return (
    <div className="relative space-y-0">
      {movements.map((movement, index) => (
        <div key={movement.id} className="relative flex gap-4 pb-6 last:pb-0">
          {/* Vertical line */}
          {index < movements.length - 1 && (
            <div className="absolute left-[9px] top-5 h-full w-px bg-border" />
          )}

          {/* Dot */}
          <div className="relative z-10 mt-1.5 h-[18px] w-[18px] flex-shrink-0 rounded-full border-2 border-primary bg-background" />

          {/* Content */}
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <MovementTypeBadge type={movement.movementType} />
              <span className="text-xs text-muted-foreground">
                {formatDate(movement.createdAt)}
              </span>
            </div>

            <p className="text-sm">{formatFromTo(movement)}</p>

            <p className="text-xs text-muted-foreground">
              Performed by {movement.performedBy.name}
            </p>

            {movement.notes && (
              <p className="text-xs italic text-muted-foreground">
                {movement.notes}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
