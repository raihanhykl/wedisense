"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { nowDateTimeInputValue, wibDateTimeInputToIso } from "@/lib/sms/labels";
import type { ConfirmPickupResult } from "@/lib/sms/orders-types";

interface ConfirmPickupDialogProps {
  orderId: string;
  lineId: string;
  vin: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ConfirmPickupDialog({
  orderId,
  lineId,
  vin,
  onClose,
  onSuccess,
}: ConfirmPickupDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [receiverName, setReceiverName] = useState("");
  const [handoverReference, setHandoverReference] = useState("");
  const [pickedUpAt, setPickedUpAt] = useState(nowDateTimeInputValue);
  const [vinConfirmed, setVinConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = receiverName.trim().length > 0 && vinConfirmed;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPut<ConfirmPickupResult>(
        `/api/sms/orders/${orderId}/lines/${lineId}/confirm-pickup`,
        {
          receiverName: receiverName.trim(),
          handoverReference: handoverReference.trim() || undefined,
          pickedUpAt: pickedUpAt ? wibDateTimeInputToIso(pickedUpAt) : undefined,
          vinConfirmed: true as const,
        },
        idempotencyKey,
      );
      if (result.alreadyDone) {
        toast.info("Pickup was already confirmed.");
      } else {
        toast.success("Pickup confirmed. Unit has left the showroom.");
      }
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to confirm pickup."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Confirm pickup</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The customer is taking this unit today. This action cannot be undone.
          </p>
        </div>

        {/* VIN displayed prominently */}
        <div className="border-b bg-muted/30 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">VIN on frame</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight">{vin}</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Receiver name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Full name of the person picking up"
                maxLength={255}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Handover reference (optional)</label>
              <input
                type="text"
                value={handoverReference}
                onChange={(e) => setHandoverReference(e.target.value)}
                placeholder="e.g. BPKB-001, receipt number"
                maxLength={100}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Picked up at (WIB)</label>
              <input
                type="datetime-local"
                value={pickedUpAt}
                max={nowDateTimeInputValue()}
                onChange={(e) => setPickedUpAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* VIN confirmation checkbox */}
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <input
                type="checkbox"
                checked={vinConfirmed}
                onChange={(e) => setVinConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-400"
              />
              <span className="text-sm font-medium text-amber-900">
                I matched the VIN on the frame to{" "}
                <span className="font-mono font-bold">{vin}</span> and they match.
              </span>
            </label>

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
              disabled={submitting || !canSubmit}
              data-tour="sms-order-confirm-pickup"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Confirming…" : "Confirm pickup"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
