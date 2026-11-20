"use client";

/**
 * Record the physical return of an RTO motorcycle to the responsible showroom.
 *
 * This creates a PENDING inspection and keeps the contract OPEN — the contract
 * must be explicitly closed after the inspection passes (or regardless of
 * inspection outcome, as an administrative act).
 */

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import {
  nowDateTimeInputValue,
  wibDateTimeInputToIso,
  VEHICLE_CONDITION_LABEL,
  type VehicleCondition,
} from "@/lib/sms/labels";
import type { RtoReturnResult } from "@/lib/sms/rto-types";

type ReturnKind = "RETURNED_BY_CUSTOMER" | "REPOSSESSED";

export interface RecordRtoReturnDialogProps {
  contractId: string;
  contractNumber: string;
  unitVin: string;
  onClose: () => void;
  onSuccess: (result: RtoReturnResult) => void;
}

export function RecordRtoReturnDialog({
  contractId,
  contractNumber,
  unitVin,
  onClose,
  onSuccess,
}: RecordRtoReturnDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const [returnKind, setReturnKind] = useState<ReturnKind>("RETURNED_BY_CUSTOMER");
  const [condition, setCondition] = useState<VehicleCondition | "">("");
  const [odometer, setOdometer] = useState("");
  const [returnedAt, setReturnedAt] = useState(nowDateTimeInputValue());
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const odometerValue = odometer.trim() ? parseInt(odometer, 10) : undefined;
      const result = await smsPut<RtoReturnResult>(
        `/api/sms/rto-contracts/${contractId}/return`,
        {
          returnKind,
          condition: condition || undefined,
          odometer: odometerValue,
          returnedAt: returnedAt ? wibDateTimeInputToIso(returnedAt) : undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      if (result.alreadyDone) {
        toast.info("This return was already recorded.");
      } else {
        toast.success(
          `Return recorded for VIN ${unitVin}. An inspection has been opened — close the contract after the inspection passes.`,
        );
      }
      onSuccess(result);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record RTO return."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Record RTO return</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Contract <span className="font-mono font-medium">{contractNumber}</span> · VIN{" "}
            <span className="font-mono font-medium">{unitVin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Recording a return opens an inspection and keeps the contract open. Close the
              contract separately after the inspection result is recorded (or as an
              administrative act when needed).
            </div>

            {/* Return kind */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Return type <span className="text-destructive">*</span>
              </label>
              <div className="flex overflow-hidden rounded-md border">
                {(["RETURNED_BY_CUSTOMER", "REPOSSESSED"] as ReturnKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setReturnKind(kind)}
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                      returnKind === kind
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {kind === "RETURNED_BY_CUSTOMER" ? "Returned by customer" : "Repossessed"}
                  </button>
                ))}
              </div>
            </div>

            {/* Returned at */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Returned at (WIB) <span className="text-destructive">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={returnedAt}
                max={nowDateTimeInputValue()}
                onChange={(e) => setReturnedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Condition */}
            <div>
              <label className="mb-1 block text-sm font-medium">Condition on arrival</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as VehicleCondition | "")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Not specified</option>
                {Object.entries(VEHICLE_CONDITION_LABEL).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Odometer */}
            <div>
              <label className="mb-1 block text-sm font-medium">Odometer reading (km)</label>
              <input
                type="number"
                min="0"
                max="9999999"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="e.g. 12500"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Optional notes about the return…"
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
              data-tour="sms-rto-return-submit"
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
