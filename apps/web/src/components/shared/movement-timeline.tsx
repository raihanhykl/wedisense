"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import HandoverFormBadge from "@/components/handover/handover-form-badge";
import type { MovementHandoverFormRef } from "@/types/admin";

// ── Input shape ─────────────────────────────────────────────────────
// Deliberately looser than MovementListItem: the asset-detail history
// endpoint (/api/assets/:id/movements) has no `asset` on each row, and
// older callers don't carry approvedBy / return dates. Everything that
// is optional here renders only when present.
export interface MovementTimelineItem {
  id: string;
  movementType: string;
  referenceNumber: string;
  status: string;
  notes: string | null;
  createdAt: string;
  expectedReturnDate?: string | null;
  actualReturnDate?: string | null;
  fromUser: { id: string; name: string; employeeId?: string | null } | null;
  toUser: { id: string; name: string; employeeId?: string | null } | null;
  fromLocation: { id: string; name: string; code?: string | null } | null;
  toLocation: { id: string; name: string; code?: string | null } | null;
  performedBy: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
  /** The signed BAST authorising this movement, when one was cited. */
  handoverForm?: MovementHandoverFormRef | null;
  /** Present on the global movements list; hidden on a single asset's history. */
  asset?: { id: string; name: string; assetNumber: string } | null;
}

// ── Movement type badge colors ──────────────────────────────────────
const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  INITIAL: "bg-slate-100 text-slate-800",
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

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-gray-100 text-gray-800",
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

// COMPLETED is the normal state and would just be noise on every row;
// only the exceptional states get a badge.
function MovementStatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") return null;
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

// ── Formatting ──────────────────────────────────────────────────────
function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

const NO_HOLDER = "Unassigned (company stock)";

function userLabel(
  user: { name: string; employeeId?: string | null } | null,
): string {
  if (!user) return NO_HOLDER;
  return user.employeeId ? `${user.name} (${user.employeeId})` : user.name;
}

/**
 * One-line, human-readable summary of what the movement did. The from/to
 * chips below give the raw data; this sentence is what an operator reads
 * first when scanning a long history ("who had it, where did it go").
 */
export function describeMovement(m: MovementTimelineItem): string {
  const from = m.fromUser?.name;
  const to = m.toUser?.name;
  const fromLoc = m.fromLocation?.name;
  const toLoc = m.toLocation?.name;
  const due = formatDate(m.expectedReturnDate);
  const returned = formatDate(m.actualReturnDate);

  switch (m.movementType) {
    case "INITIAL":
      return to
        ? `Registered at ${toLoc ?? "-"}, assigned to ${to}`
        : `Registered at ${toLoc ?? "-"}`;
    case "ASSIGNMENT":
      return from
        ? `Reassigned from ${from} to ${to ?? "-"}`
        : `Assigned to ${to ?? "-"}`;
    case "UNASSIGNMENT":
      return from
        ? `Returned by ${from} to company stock`
        : "Unassigned, returned to company stock";
    case "LOCATION_TRANSFER":
      return `Moved from ${fromLoc ?? "-"} to ${toLoc ?? "-"}`;
    case "LOAN_OUT":
      return due
        ? `Loaned to ${to ?? "-"}, due back ${due}`
        : `Loaned to ${to ?? "-"}`;
    case "LOAN_RETURN":
      return returned
        ? `Loan returned by ${from ?? "-"} on ${returned}`
        : `Loan returned by ${from ?? "-"}`;
    case "RESIGNATION_RETURN":
      return `Returned by ${from ?? "-"} (resignation)`;
    case "SWAP":
      return `Swapped: ${from ?? "-"} → ${to ?? "-"}`;
    case "SEND_TO_MAINTENANCE":
      return "Sent to maintenance";
    case "RETURN_FROM_MAINTENANCE":
      return "Returned from maintenance";
    case "DISPOSAL":
      return "Disposed";
    case "LOST":
      return "Reported lost";
    case "FOUND":
      return "Found and restored";
    default:
      return m.movementType.replace(/_/g, " ");
  }
}

// ── Detail chips ────────────────────────────────────────────────────
function TransitionRow({
  label,
  from,
  to,
}: {
  label: string;
  from: string;
  to: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className="w-16 shrink-0 font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-foreground">{from}</span>
      <span aria-hidden className="text-muted-foreground">
        →
      </span>
      <span className="font-medium text-foreground">{to}</span>
    </div>
  );
}

interface MovementTimelineProps {
  movements: MovementTimelineItem[];
  /** Render the asset link on each row (global list). Off on a single asset's page. */
  showAsset?: boolean;
}

export default function MovementTimeline({
  movements,
  showAsset = false,
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
      {movements.map((movement, index) => {
        // Holder transition is only meaningful when the movement touched
        // the assignee. Maintenance / disposal / found / lost carry no
        // user on either side, so the row is hidden rather than showing
        // "Unassigned → Unassigned".
        const touchesHolder = !!(movement.fromUser || movement.toUser);
        // Same for location: INITIAL has only a `to`, transfers have both.
        const touchesLocation = !!(movement.fromLocation || movement.toLocation);
        const due = formatDate(movement.expectedReturnDate);
        const returned = formatDate(movement.actualReturnDate);

        return (
          <div key={movement.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Vertical line */}
            {index < movements.length - 1 && (
              <div className="absolute left-[9px] top-5 h-full w-px bg-border" />
            )}

            {/* Dot */}
            <div className="relative z-10 mt-1.5 h-[18px] w-[18px] flex-shrink-0 rounded-full border-2 border-primary bg-background" />

            {/* Content */}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <MovementTypeBadge type={movement.movementType} />
                <MovementStatusBadge status={movement.status} />
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(movement.createdAt)}
                </span>
                <span
                  className="font-mono text-[11px] text-muted-foreground"
                  title="Movement reference number"
                >
                  {movement.referenceNumber}
                </span>
              </div>

              <p className="text-sm font-medium">{describeMovement(movement)}</p>

              {showAsset && movement.asset && (
                <p className="text-xs text-muted-foreground">
                  Asset:{" "}
                  <Link
                    href={`/admin/assets/${movement.asset.id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {movement.asset.assetNumber}
                  </Link>{" "}
                  {movement.asset.name}
                </p>
              )}

              {(touchesHolder || touchesLocation) && (
                <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
                  {touchesHolder && (
                    <TransitionRow
                      label="Holder"
                      from={userLabel(movement.fromUser)}
                      to={userLabel(movement.toUser)}
                    />
                  )}
                  {touchesLocation && (
                    <TransitionRow
                      label="Location"
                      from={movement.fromLocation?.name ?? "-"}
                      to={movement.toLocation?.name ?? "-"}
                    />
                  )}
                </div>
              )}

              {(due || returned) && (
                <p className="text-xs text-muted-foreground">
                  {due && <span>Expected return: {due}</span>}
                  {due && returned && <span> · </span>}
                  {returned && <span>Actual return: {returned}</span>}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                Performed by {movement.performedBy?.name ?? "-"}
                {movement.approvedBy && (
                  <span> · Approved by {movement.approvedBy.name}</span>
                )}
              </p>

              {movement.notes && (
                <p className="text-xs italic text-muted-foreground">
                  “{movement.notes}”
                </p>
              )}

              {/* The signed paper record behind this movement, when there is one. */}
              {movement.handoverForm && (
                <div className="pt-0.5">
                  <HandoverFormBadge form={movement.handoverForm} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
