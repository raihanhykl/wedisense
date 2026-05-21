import type { PurchaseOrderStatus, ProcurementBatchStatus } from "@/types/admin";

// Phase 17 — shared status badge for the procurement family. Two unions
// (PO + Batch) share the same visual vocabulary so a user scanning a list
// of "Open" rows reads the same colour regardless of which entity the row
// represents.

const PO_PALETTE: Record<PurchaseOrderStatus, { label: string; cls: string }> = {
  OPEN: {
    label: "Open",
    cls: "bg-blue-50 text-blue-700 ring-blue-600/20",
  },
  PARTIALLY_RECEIVED: {
    label: "Partially Received",
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  FULLY_RECEIVED: {
    label: "Fully Received",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  CLOSED: {
    label: "Closed",
    cls: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
  },
  CANCELLED: {
    label: "Cancelled",
    cls: "bg-red-50 text-red-700 ring-red-600/20",
  },
};

const BATCH_PALETTE: Record<ProcurementBatchStatus, { label: string; cls: string }> = {
  DRAFT: {
    label: "Draft",
    cls: "bg-zinc-50 text-zinc-600 ring-zinc-500/20",
  },
  ITEMS_PENDING: {
    label: "Items Pending",
    cls: "bg-blue-50 text-blue-700 ring-blue-600/20",
  },
  RECEIVED: {
    label: "Received",
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  COMPLETED: {
    label: "Completed",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  CANCELLED: {
    label: "Cancelled",
    cls: "bg-red-50 text-red-700 ring-red-600/20",
  },
};

interface PoBadgeProps {
  status: PurchaseOrderStatus;
}

interface BatchBadgeProps {
  status: ProcurementBatchStatus;
}

const BASE_CLASS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

export function PurchaseOrderStatusBadge({ status }: PoBadgeProps) {
  const { label, cls } = PO_PALETTE[status];
  return <span className={`${BASE_CLASS} ${cls}`}>{label}</span>;
}

export function ProcurementBatchStatusBadge({ status }: BatchBadgeProps) {
  const { label, cls } = BATCH_PALETTE[status];
  return <span className={`${BASE_CLASS} ${cls}`}>{label}</span>;
}

// Re-exported for module-local convenience.
export { PO_PALETTE, BATCH_PALETTE };
