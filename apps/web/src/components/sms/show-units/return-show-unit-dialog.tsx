"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { nowDateTimeInputValue, wibDateTimeInputToIso, type VehicleCondition } from "@/lib/sms/labels";
import type { ShowLoanRow } from "@/lib/sms/show-loans-types";


const CONDITION_OPTIONS: { value: VehicleCondition; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "POOR", label: "Poor" },
  { value: "DAMAGED", label: "Damaged" },
];

interface ReturnShowUnitDialogProps {
  loanId: string;
  unitVin: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReturnShowUnitDialog({
  loanId,
  unitVin,
  onClose,
  onSuccess,
}: ReturnShowUnitDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const [returnedAt, setReturnedAt] = useState(nowDateTimeInputValue);
  const [condition, setCondition] = useState<VehicleCondition>("GOOD");
  const [hasFindings, setHasFindings] = useState(false);
  const [findings, setFindings] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasFindings && findings.trim().length < 3) {
      setError("Please describe the findings (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPut<ShowLoanRow>(
        `/api/sms/show-loans/${loanId}/return`,
        {
          returnedAt: returnedAt ? wibDateTimeInputToIso(returnedAt) : undefined,
          condition,
          hasFindings,
          findings: hasFindings ? findings : undefined,
          notes: notes || undefined,
        },
        idempotencyKey,
      );
      if (result.alreadyDone) {
        toast.info("Return was already recorded.");
      } else if (hasFindings) {
        toast.success(`${unitVin} returned — sent to inspection queue.`);
      } else {
        toast.success(`${unitVin} returned as available.`);
      }
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record return."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Record show unit return</h2>
          <p className="mt-0.5 text-sm text-muted-foreground font-mono">{unitVin}</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            {/* Return date */}
            <div>
              <label className="mb-1 block text-sm font-medium">Returned at (WIB)</label>
              <input
                type="datetime-local"
                value={returnedAt}
                max={nowDateTimeInputValue()}
                onChange={(e) => setReturnedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">Defaults to now. Cannot be in the future.</p>
            </div>

            {/* Condition */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Condition <span className="text-destructive">*</span>
              </label>
              <select
                required
                value={condition}
                onChange={(e) => setCondition(e.target.value as VehicleCondition)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CONDITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Has findings */}
            <div>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={hasFindings}
                  onChange={(e) => setHasFindings(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                />
                <span className="text-sm font-medium">Unit has findings / damage</span>
              </label>
              {hasFindings && (
                <p className="mt-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Findings will send this unit to the inspection queue before it can be offered again.
                </p>
              )}
            </div>

            {/* Findings description */}
            {hasFindings && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Describe the findings <span className="text-destructive">*</span>
                </label>
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder="Describe what was found on the unit…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-0.5 text-xs text-muted-foreground">{findings.length} / 1000</p>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes…"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-tour="sms-unit-record-show-return"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Recording…" : "Record return"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
