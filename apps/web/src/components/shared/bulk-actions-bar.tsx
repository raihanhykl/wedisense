"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  X,
  MapPin,
  UserCircle,
  Wrench,
  Printer,
  Trash2,
} from "lucide-react";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { useUsers } from "@/hooks/use-reference-data";
import { cn } from "@/lib/utils";
import LocationTreePicker from "./location-tree-picker";

// Backend's BulkActionResult shape. Kept in sync with apps/api/src/modules/
// assets/service.ts — only the fields the UI surfaces.
interface BulkActionResult {
  succeeded: string[];
  skipped: Array<{ assetId: string; reason: string }>;
  failed: Array<{ assetId: string; reason: string }>;
}

const CONDITION_VALUES = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "DAMAGED",
] as const;
type Condition = (typeof CONDITION_VALUES)[number];

interface BulkActionsBarProps {
  /** Currently-selected asset IDs from the parent table. */
  selectedIds: string[];
  /** Clear selection (called on Cancel + after a successful action). */
  onClearSelection: () => void;
  /** Re-fetch the underlying list after a mutation that changed data. */
  onMutated: () => void;
  /** Open the existing PrintDialog with the current selection. */
  onPrint: () => void;
  /** Permission gates passed in so the bar reflects what the user can do. */
  canUpdate: boolean;
  canDelete: boolean;
  canPrint: boolean;
}

type ActiveDialog =
  | { kind: "move" }
  | { kind: "assign" }
  | { kind: "condition" }
  | { kind: "delete" }
  | null;

export default function BulkActionsBar({
  selectedIds,
  onClearSelection,
  onMutated,
  onPrint,
  canUpdate,
  canDelete,
  canPrint,
}: BulkActionsBarProps) {
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [busy, setBusy] = useState(false);

  if (selectedIds.length === 0) return null;

  // Toast-and-summarise helper. Every bulk endpoint returns the same shape,
  // so the surfacing logic is shared.
  const reportResult = (
    result: BulkActionResult,
    actionLabel: string,
  ) => {
    const ok = result.succeeded.length;
    const skip = result.skipped.length;
    const fail = result.failed.length;
    if (fail === 0 && skip === 0) {
      toast.success(`${actionLabel}: ${ok} asset${ok === 1 ? "" : "s"} updated.`);
    } else {
      // Mixed result — keep the toast informative but not overwhelming.
      // Failed reasons go to console so devs can inspect; users see counts.
      if (fail > 0) {
        console.warn(`${actionLabel} failures:`, result.failed);
      }
      toast.warning(
        `${actionLabel}: ${ok} updated, ${skip} skipped, ${fail} failed.`,
      );
    }
  };

  const runAction = async <T,>(
    promise: Promise<T>,
    actionLabel: string,
    extract: (r: T) => BulkActionResult,
  ) => {
    setBusy(true);
    try {
      const r = await promise;
      reportResult(extract(r), actionLabel);
      setDialog(null);
      onClearSelection();
      onMutated();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `${actionLabel} failed`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        // Sticky to viewport bottom — sits above any page-level content.
        // Centred horizontally so it doesn't collide with scrollbars on
        // long lists. Slight transition for the entry/exit looks polished
        // when selection changes from 0 to N rapidly.
        className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-card px-3 py-2 shadow-lg"
        data-tour="bulk-actions-bar"
      >
        <span className="mr-2 text-sm font-medium">
          {selectedIds.length} selected
        </span>

        <button
          type="button"
          onClick={onClearSelection}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Clear selection (Esc)"
        >
          <X className="h-4 w-4" />
        </button>

        <span className="mx-1 h-6 w-px bg-border" />

        {canUpdate && (
          <ActionButton
            icon={<MapPin className="h-4 w-4" />}
            label="Move"
            onClick={() => setDialog({ kind: "move" })}
          />
        )}
        {canUpdate && (
          <ActionButton
            icon={<UserCircle className="h-4 w-4" />}
            label="Assign"
            onClick={() => setDialog({ kind: "assign" })}
          />
        )}
        {canUpdate && (
          <ActionButton
            icon={<Wrench className="h-4 w-4" />}
            label="Condition"
            onClick={() => setDialog({ kind: "condition" })}
          />
        )}
        {canPrint && (
          <ActionButton
            icon={<Printer className="h-4 w-4" />}
            label="Print"
            onClick={() => onPrint()}
          />
        )}
        {canDelete && (
          <ActionButton
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            danger
            onClick={() => setDialog({ kind: "delete" })}
          />
        )}
      </div>

      {dialog?.kind === "move" && (
        <MoveLocationDialog
          count={selectedIds.length}
          onCancel={() => setDialog(null)}
          onConfirm={(toLocationId) =>
            void runAction(
              apiPost<BulkActionResult>("/api/assets/bulk-move-location", {
                assetIds: selectedIds,
                toLocationId,
              }),
              "Move location",
              (r) => r,
            )
          }
          busy={busy}
        />
      )}

      {dialog?.kind === "assign" && (
        <AssignUserDialog
          count={selectedIds.length}
          onCancel={() => setDialog(null)}
          onConfirm={(toUserId) =>
            void runAction(
              apiPost<BulkActionResult>("/api/assets/bulk-assign-user", {
                assetIds: selectedIds,
                toUserId,
              }),
              toUserId ? "Assign" : "Unassign",
              (r) => r,
            )
          }
          busy={busy}
        />
      )}

      {dialog?.kind === "condition" && (
        <ChangeConditionDialog
          count={selectedIds.length}
          onCancel={() => setDialog(null)}
          onConfirm={(condition) =>
            void runAction(
              apiPost<BulkActionResult>("/api/assets/bulk-change-condition", {
                assetIds: selectedIds,
                condition,
              }),
              "Change condition",
              (r) => r,
            )
          }
          busy={busy}
        />
      )}

      {dialog?.kind === "delete" && (
        <DeleteConfirmDialog
          count={selectedIds.length}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void runAction(
              apiPost<BulkActionResult>("/api/assets/bulk-delete", {
                assetIds: selectedIds,
              }),
              "Delete",
              (r) => r,
            )
          }
          busy={busy}
        />
      )}
    </>
  );
}

// ── Internal: action button ───────────────────────────────────────────
function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Label text is hidden below sm (<640px) so the bar fits five action
      // buttons + count + close on phone screens. Icons stay (the title
      // attribute also provides hover text on desktop).
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium",
        danger
          ? "text-red-600 hover:bg-red-50"
          : "hover:bg-accent",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────
// Lightweight inline dialogs — none of these need their own files since
// they're tightly coupled to the bulk-actions surface.

function ModalShell({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function MoveLocationDialog({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (locationId: string) => void;
}) {
  const [locationId, setLocationId] = useState<string | null>(null);
  return (
    <ModalShell title="Move to location" onCancel={onCancel}>
      <p className="mb-3 text-xs text-muted-foreground">
        All {count} selected assets will be moved. Each gets a
        LOCATION_TRANSFER movement record.
      </p>
      <LocationTreePicker
        value={locationId}
        onChange={setLocationId}
        placeholder="Select target location..."
      />
      <DialogActions
        onCancel={onCancel}
        confirmLabel="Move"
        confirmDisabled={!locationId || busy}
        onConfirm={() => locationId && onConfirm(locationId)}
        busy={busy}
      />
    </ModalShell>
  );
}

function AssignUserDialog({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (userId: string | null) => void;
}) {
  const { data: users = [] } = useUsers();
  // Special sentinel "unassign" — sent to backend as null.
  const [selection, setSelection] = useState<string>("");
  return (
    <ModalShell title="Assign / unassign" onCancel={onCancel}>
      <p className="mb-3 text-xs text-muted-foreground">
        All {count} selected assets will be re-assigned. Picking
        &quot;Unassign&quot; clears the assignee and flips status to IDLE.
      </p>
      <select
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">— Select user or action —</option>
        <option value="__unassign__">Unassign (clear assignee)</option>
        <option disabled>──────────────</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
      <DialogActions
        onCancel={onCancel}
        confirmLabel={selection === "__unassign__" ? "Unassign" : "Assign"}
        confirmDisabled={!selection || busy}
        onConfirm={() =>
          onConfirm(selection === "__unassign__" ? null : selection)
        }
        busy={busy}
      />
    </ModalShell>
  );
}

function ChangeConditionDialog({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (condition: Condition) => void;
}) {
  const [condition, setCondition] = useState<Condition | "">("");
  return (
    <ModalShell title="Change condition" onCancel={onCancel}>
      <p className="mb-3 text-xs text-muted-foreground">
        All {count} selected assets will have their physical condition updated.
        No movement record is created — condition is metadata, not a transfer.
      </p>
      <select
        value={condition}
        onChange={(e) => setCondition(e.target.value as Condition)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">— Select condition —</option>
        {CONDITION_VALUES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <DialogActions
        onCancel={onCancel}
        confirmLabel="Update"
        confirmDisabled={!condition || busy}
        onConfirm={() => condition && onConfirm(condition)}
        busy={busy}
      />
    </ModalShell>
  );
}

function DeleteConfirmDialog({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Delete selected assets?" onCancel={onCancel}>
      <p className="mb-2 text-sm">
        Soft-delete {count} asset{count === 1 ? "" : "s"}. They&apos;ll stop
        appearing in lists but their history is preserved.
      </p>
      <p className="text-xs text-muted-foreground">
        Assets with movement history (other than INITIAL) must be set to
        DISPOSED or LOST first. Those will be reported as failures rather
        than deleted silently.
      </p>
      <DialogActions
        onCancel={onCancel}
        confirmLabel="Delete"
        confirmDisabled={busy}
        confirmDanger
        onConfirm={onConfirm}
        busy={busy}
      />
    </ModalShell>
  );
}

function DialogActions({
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  confirmDanger,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  confirmDanger?: boolean;
  busy: boolean;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled}
        className={cn(
          "rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50",
          confirmDanger
            ? "bg-red-600 hover:bg-red-700"
            : "bg-primary hover:bg-primary/90",
        )}
      >
        {busy ? "Working..." : confirmLabel}
      </button>
    </div>
  );
}
