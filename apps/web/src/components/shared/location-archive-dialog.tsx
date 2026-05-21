"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, PowerOff, X } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import LocationTreePicker from "@/components/shared/location-tree-picker";
import type { LocationFlat } from "@/types/admin";

/**
 * Archive flow modal.
 *
 * Two states drive the UX:
 *   1. Probing — we fetch the direct-asset count for this location to
 *      decide which case to show. Single GET, fast.
 *   2a. "No assets" → minimal confirm: "Archive this location?" + button.
 *   2b. "N direct assets" → show count + LocationTreePicker for target +
 *       a preview of the first asset names so the user sees what's moving.
 *
 * The backend endpoint is atomic from the caller's POV: move assets + flip
 * isActive=false in a single POST. Partial-failure cases bubble up via
 * AppError details and we surface a friendly message.
 */

interface AssetSummary {
  direct: { total: number };
}

interface LocationArchiveDialogProps {
  open: boolean;
  onClose: () => void;
  /** The location being archived. */
  location: LocationFlat;
  /** Fired after a successful archive so callers can refetch state. */
  onArchived: () => void;
}

export default function LocationArchiveDialog({
  open,
  onClose,
  location,
  onArchived,
}: LocationArchiveDialogProps) {
  const [probing, setProbing] = useState(true);
  const [directCount, setDirectCount] = useState(0);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Probe direct-asset count whenever the dialog opens. We re-probe rather
  // than caching because the summary may have shifted (other admins, jobs).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProbing(true);
    setError(null);
    setTargetId(null);
    apiGet<AssetSummary>(`/api/locations/${location.id}/asset-summary`)
      .then((s) => {
        if (!cancelled) setDirectCount(s.direct.total);
      })
      .catch((e) => {
        if (!cancelled)
          setError(getApiErrorMessage(e, "Failed to inspect location"));
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, location.id]);

  const requiresMigration = directCount > 0;
  // Block the submit button until the user has picked a target (when needed).
  const canSubmit = useMemo(() => {
    if (probing || submitting) return false;
    if (requiresMigration && !targetId) return false;
    if (requiresMigration && targetId === location.id) return false;
    return true;
  }, [probing, submitting, requiresMigration, targetId, location.id]);

  const handleArchive = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiPost(`/api/locations/${location.id}/archive`, {
        migrateAssetsTo: requiresMigration ? targetId : null,
      });
      toast.success(
        requiresMigration
          ? `Archived ${location.name} · ${directCount} asset${directCount === 1 ? "" : "s"} moved`
          : `Archived ${location.name}`,
      );
      onArchived();
      onClose();
    } catch (e) {
      setError(getApiErrorMessage(e, "Archive failed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <PowerOff className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Archive location</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm">
            Archiving{" "}
            <span className="font-medium">{location.name}</span> hides it from
            pickers and reports. You can reactivate later from the location
            detail page.
          </p>

          {probing ? (
            <p className="text-xs text-muted-foreground">
              Checking for direct assets…
            </p>
          ) : requiresMigration ? (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-900 dark:text-amber-100">
                  <span className="font-medium">{directCount}</span> direct
                  asset{directCount === 1 ? " is" : "s are"} pinned here. Pick a
                  target location below — they&apos;ll be moved before the
                  archive flips. (Assets in sub-locations are not affected.)
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">
                  Move assets to
                </label>
                <LocationTreePicker
                  value={targetId}
                  onChange={setTargetId}
                  placeholder="Select target location"
                />
              </div>

              {targetId === location.id && (
                <p className="text-xs text-destructive">
                  Cannot move assets into the same location being archived.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No direct assets at this location. Ready to archive.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-card px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={!canSubmit}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50",
              requiresMigration ? "bg-amber-600 hover:bg-amber-700" : "bg-primary hover:bg-primary/90",
            )}
          >
            {submitting ? (
              "Working…"
            ) : requiresMigration ? (
              <>
                Move & Archive <ArrowRight className="h-3.5 w-3.5" />
              </>
            ) : (
              "Archive"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
