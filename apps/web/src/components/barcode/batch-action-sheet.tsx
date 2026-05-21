"use client";

import { useState } from "react";
import { ArrowRight, MoveRight, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import LocationTreePicker from "@/components/shared/location-tree-picker";

export interface BatchAsset {
  id: string;
  name: string;
  assetNumber: string;
  location: { id: string; name: string; code: string } | null;
}

interface BatchActionSheetProps {
  open: boolean;
  onClose: () => void;
  assets: BatchAsset[];
  /** Remove an asset from the cart (e.g. user scanned by mistake). */
  onRemoveAsset: (id: string) => void;
  /** Fires after a bulk action commits successfully so the parent can
   *  clear the cart + dismiss the sheet. */
  onCommitted: () => void;
}

type SheetView = "menu" | "move";

/**
 * Surfaces after the user closes a batch scan with collected assets.
 * Two-step flow: pick an action from the menu, then provide the action's
 * input (e.g. target location for Move). Commits via the existing bulk
 * endpoints — for v1 only Move is wired; future actions (assign user,
 * change status, schedule maintenance) plug into the menu the same way.
 */
export default function BatchActionSheet({
  open,
  onClose,
  assets,
  onRemoveAsset,
  onCommitted,
}: BatchActionSheetProps) {
  const [view, setView] = useState<SheetView>("menu");
  const [targetLocationId, setTargetLocationId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleClose = () => {
    setView("menu");
    setTargetLocationId(null);
    onClose();
  };

  const handleMove = async () => {
    if (!targetLocationId) return;
    setSubmitting(true);
    try {
      const result = await apiPost<{
        succeeded: string[];
        failed: { assetId: string; reason: string }[];
        skipped: { assetId: string; reason: string }[];
      }>(`/api/assets/bulk-move-location`, {
        assetIds: assets.map((a) => a.id),
        toLocationId: targetLocationId,
      });
      // Partial-success aware: tell the user exactly how many landed,
      // how many were already there, and how many failed. Failed items
      // remain in the cart so the user can retry / inspect.
      const summary = [
        `${result.succeeded.length} moved`,
        result.skipped.length > 0 && `${result.skipped.length} skipped`,
        result.failed.length > 0 && `${result.failed.length} failed`,
      ]
        .filter(Boolean)
        .join(" · ");
      if (result.failed.length > 0) {
        toast.error(summary);
      } else {
        toast.success(summary);
      }
      onCommitted();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Bulk move failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-sheet-title"
    >
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col rounded-t-lg border bg-card shadow-lg sm:rounded-lg">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 id="batch-sheet-title" className="text-base font-semibold">
            {view === "menu"
              ? `Batch · ${assets.length} item${assets.length === 1 ? "" : "s"}`
              : "Move to location"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {view === "menu" ? (
            <>
              <ul className="mb-4 divide-y rounded-md border bg-background">
                {assets.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.assetNumber}
                        {a.location && ` · ${a.location.name}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(a.id)}
                      aria-label={`Remove ${a.name}`}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Bulk action
              </h3>
              <ActionMenuRow
                icon={<MoveRight className="h-4 w-4" />}
                label="Move to location"
                description="Transfer all assets to a single target location."
                onClick={() => setView("move")}
              />
              {/* Future actions plug in here — assign user, change status,
                  schedule maintenance. Same component shape. */}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Moving{" "}
                <span className="font-medium text-foreground">
                  {assets.length} asset{assets.length === 1 ? "" : "s"}
                </span>
                . Pick a destination:
              </p>
              <LocationTreePicker
                value={targetLocationId}
                onChange={setTargetLocationId}
                placeholder="Select target location"
              />
              <p className="mt-3 text-xs text-muted-foreground">
                A LOCATION_TRANSFER movement record is created for each asset.
                Already-at-target assets are skipped.
              </p>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
          {view === "move" && (
            <button
              type="button"
              onClick={() => {
                setView("menu");
                setTargetLocationId(null);
              }}
              disabled={submitting}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Back
            </button>
          )}
          {view === "menu" && (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Close
            </button>
          )}
          {view === "move" && (
            <button
              type="button"
              onClick={handleMove}
              disabled={!targetLocationId || submitting}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
              )}
            >
              {submitting ? "Moving…" : "Move"}
              {!submitting && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ── Inline action row ────────────────────────────────────────────────

function ActionMenuRow({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md border bg-background px-3 py-2 text-left hover:bg-accent"
    >
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
