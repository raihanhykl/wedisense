"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { nowDateTimeInputValue, wibDateTimeInputToIso } from "@/lib/sms/labels";
import type { ReturnRequestRow } from "@/lib/sms/returns-types";

interface HandBackDialogProps {
  request: ReturnRequestRow;
  onClose: () => void;
  onSuccess: () => void;
}

export function HandBackDialog({ request, onClose, onSuccess }: HandBackDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [handedBackAt, setHandedBackAt] = useState(nowDateTimeInputValue());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await smsPut(
        `/api/sms/return-requests/${request.id}/custody-handback`,
        {
          handedBackAt: wibDateTimeInputToIso(handedBackAt),
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      toast.success("Motorcycle handed back to rider. Custody resolved.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record handback."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Hand back to rider</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {request.requestNumber} · VIN{" "}
            <span className="font-mono font-medium">{request.unit.vin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The return request was rejected by {request.fromShowroom.name}. Record when you
              handed the motorcycle back to the rider. After this, the unit returns to Active RTO
              status under {request.fromShowroom.name}.
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Handed back at <span className="text-destructive">*</span>
              </label>
              <input
                type="datetime-local"
                value={handedBackAt}
                onChange={(e) => setHandedBackAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Handback notes (optional)"
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
              data-tour="sms-return-handback-submit"
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submitting ? "Recording…" : "Hand back"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
