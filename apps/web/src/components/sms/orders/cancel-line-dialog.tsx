"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import type { CancelLineResult } from "@/lib/sms/orders-types";

interface CancelLineDialogProps {
  orderId: string;
  lineId: string;
  vin: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CancelLineDialog({
  orderId,
  lineId,
  vin,
  onClose,
  onSuccess,
}: CancelLineDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPut<CancelLineResult>(
        `/api/sms/orders/${orderId}/lines/${lineId}/cancel`,
        { reason: reason.trim() },
        idempotencyKey,
      );
      if (result.alreadyDone) {
        toast.info("This booking was already cancelled.");
      } else {
        toast.success("Booking cancelled.");
      }
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to cancel booking."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Cancel booking</h2>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{vin}</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this booking being cancelled?"
                maxLength={500}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                autoFocus
              />
              <p className="mt-1 text-xs text-muted-foreground">{reason.length}/500 characters</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting || reason.trim().length < 3}
              data-tour="sms-order-cancel-line"
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {submitting ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
