"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, toSmsError } from "@/lib/sms/client";
import { apiGet } from "@/lib/api";
import { variantLabel } from "@/lib/sms/labels";
import { describeBookingConflict, type AddLinesResult, type BookingConflictDetail, type UnitPickerResult } from "@/lib/sms/orders-types";

interface AddUnitsDialogProps {
  orderId: string;
  spkNumber: string;
  showroomId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface UnitRow {
  rowId: string;
  unit: UnitPickerResult | null;
  conflict: BookingConflictDetail | null;
}

function newRow(): UnitRow {
  return { rowId: crypto.randomUUID(), unit: null, conflict: null };
}

// ── VIN picker for a single row ────────────────────────────────────────

interface VinPickerProps {
  showroomId: string;
  value: UnitPickerResult | null;
  excludeIds: string[];
  conflict: BookingConflictDetail | null;
  onSelect: (unit: UnitPickerResult | null) => void;
  onSelectAlternative: (unit: UnitPickerResult) => void;
}

function VinPicker({ showroomId, value, excludeIds, conflict, onSelect, onSelectAlternative }: VinPickerProps) {
  const [search, setSearch] = useState(value?.vin ?? "");
  const [results, setResults] = useState<UnitPickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchUnits = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const data = await apiGet<UnitPickerResult[]>("/api/sms/units", {
          showroomId,
          view: "ready",
          search: q,
          limit: 10,
        });
        setResults(data.filter((u) => !excludeIds.includes(u.id)));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [showroomId, excludeIds],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchUnits(search);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchUnits]);

  const handleSelect = (unit: UnitPickerResult) => {
    setSearch(unit.vin);
    setOpen(false);
    onSelect(unit);
  };

  const handleClear = () => {
    setSearch("");
    setResults([]);
    onSelect(null);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            if (!e.target.value) onSelect(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search VIN (last 4+ chars)"
          className={`flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono ${conflict ? "border-destructive" : ""}`}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border px-2 py-2 text-xs text-muted-foreground hover:bg-accent"
          >
            Clear
          </button>
        )}
      </div>
      {value && !conflict && (
        <p className="mt-1 text-xs text-muted-foreground">
          {variantLabel(value.variant)}
        </p>
      )}
      {conflict && (
        <div className="mt-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <p className="font-medium">
            {describeBookingConflict(conflict)}
          </p>
          {conflict.alternatives.length > 0 && (
            <div className="mt-1">
              <span className="text-muted-foreground">Try: </span>
              {conflict.alternatives.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() =>
                    onSelectAlternative({
                      id: alt.id,
                      vin: alt.vin,
                      variant: { id: "", name: alt.variantName, color: alt.color, model: { id: "", code: "", name: alt.modelName } },
                      physicalLocation: null,
                      status: "AVAILABLE",
                    })
                  }
                  className="ml-1 font-mono underline hover:no-underline"
                >
                  {alt.vin}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={() => handleSelect(u)}
              className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-mono font-semibold">{u.vin}</span>
              <span className="text-xs text-muted-foreground">{variantLabel(u.variant)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main dialog ────────────────────────────────────────────────────────

export function AddUnitsDialog({ orderId, spkNumber, showroomId, onClose, onSuccess }: AddUnitsDialogProps) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [rows, setRows] = useState<UnitRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const selectedIds = rows.map((r) => r.unit?.id).filter((id): id is string => !!id);
  const allSelected = rows.every((r) => r.unit !== null);
  const hasConflicts = rows.some((r) => r.conflict !== null);

  const addRow = () => {
    if (rows.length < 20) setRows((prev) => [...prev, newRow()]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const updateRow = (rowId: string, unit: UnitPickerResult | null) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, unit, conflict: null } : r)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const unitIds = rows.map((r) => r.unit?.id).filter((id): id is string => !!id);
    if (unitIds.length === 0) return;

    setSubmitting(true);
    setGlobalError(null);
    try {
      const result = await smsPost<AddLinesResult>(
        `/api/sms/orders/${orderId}/lines`,
        { unitIds },
        idempotencyKey,
      );
      toast.success(`${result.addedCount} unit${result.addedCount !== 1 ? "s" : ""} added to ${spkNumber}.`);
      onSuccess();
    } catch (err) {
      const smsErr = toSmsError(err, "Failed to add units.");
      if (smsErr.code === "SMS_BOOKING_CONFLICT") {
        // Map conflict details back to rows
        setIdempotencyKey(newIdempotencyKey());
        const conflicts = smsErr.details as unknown as Array<BookingConflictDetail>;
        setRows((prev) =>
          prev.map((row) => {
            const conflict = conflicts.find((c) => c.unitId === row.unit?.id) ?? null;
            return { ...row, conflict };
          }),
        );
        setGlobalError("One or more units cannot be booked. Fix the highlighted rows and try again.");
      } else {
        setGlobalError(smsErr.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Add units to {spkNumber}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Only available units at this showroom can be added.
          </p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="max-h-[60vh] overflow-y-auto p-5">
            <div className="space-y-3">
              {rows.map((row, idx) => (
                <div key={row.rowId} className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Unit {idx + 1}
                    </div>
                    <VinPicker
                      showroomId={showroomId}
                      value={row.unit}
                      excludeIds={selectedIds.filter((id) => id !== row.unit?.id)}
                      conflict={row.conflict}
                      onSelect={(unit) => updateRow(row.rowId, unit)}
                      onSelectAlternative={(unit) => {
                        updateRow(row.rowId, unit);
                      }}
                    />
                  </div>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      className="mt-6 rounded-md border px-2 py-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {rows.length < 20 && (
              <button
                type="button"
                onClick={addRow}
                className="mt-3 text-sm text-primary hover:underline"
                data-tour="sms-order-add-unit"
              >
                + Add another unit
              </button>
            )}
            {globalError && (
              <p className="mt-3 text-sm text-destructive">{globalError}</p>
            )}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !allSelected || selectedIds.length === 0 || hasConflicts}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Adding…" : `Add ${selectedIds.length} unit${selectedIds.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
