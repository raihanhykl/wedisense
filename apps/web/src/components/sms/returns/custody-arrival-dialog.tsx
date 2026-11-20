"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { nowDateTimeInputValue, wibDateTimeInputToIso, VEHICLE_CONDITION_LABEL, type VehicleCondition } from "@/lib/sms/labels";
import type { ReturnRequestRow } from "@/lib/sms/returns-types";

interface CustodyArrivalDialogProps {
  request: ReturnRequestRow;
  onClose: () => void;
  onSuccess: () => void;
}


export function CustodyArrivalDialog({ request, onClose, onSuccess }: CustodyArrivalDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [custodyReceivedAt, setCustodyReceivedAt] = useState(nowDateTimeInputValue());
  const [condition, setCondition] = useState<VehicleCondition | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await smsPut(
        `/api/sms/return-requests/${request.id}/custody-received`,
        {
          custodyReceivedAt: wibDateTimeInputToIso(custodyReceivedAt),
          condition: condition || undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      toast.success("Custody recorded — motorcycle is now held at this showroom.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record custody arrival."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Record custody arrival</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {request.requestNumber} · VIN{" "}
            <span className="font-mono font-medium">{request.unit.vin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              The motorcycle has physically arrived here but the official receipt has not been
              approved by {request.fromShowroom.name} yet. Recording custody lets both sides track
              the motorcycle while approval is pending.
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Arrived at <span className="text-destructive">*</span>
              </label>
              <input
                type="datetime-local"
                value={custodyReceivedAt}
                onChange={(e) => setCustodyReceivedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                required
              />
            </div>

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

            <div>
              <label className="mb-1 block text-sm font-medium">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes about the motorcycle's arrival"
                maxLength={500}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
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
              disabled={submitting}
              data-tour="sms-return-custody-submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Recording…" : "Record custody"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
