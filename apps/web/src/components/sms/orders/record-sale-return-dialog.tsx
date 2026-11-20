"use client";

/**
 * Record that a sold motorcycle came back (sale return). The unit goes to
 * inspection at its responsible showroom; the return still needs a decision.
 * Used from the SPK page and the VIN card.
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
import type { SaleReturnResult } from "@/lib/sms/orders-types";

interface RecordSaleReturnDialogProps {
  orderId: string;
  lineId: string;
  vin: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecordSaleReturnDialog({
  orderId,
  lineId,
  vin,
  onClose,
  onSuccess,
}: RecordSaleReturnDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [receivedAt, setReceivedAt] = useState(nowDateTimeInputValue());
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState<VehicleCondition | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError("Please provide a reason (at least 3 characters).");
      return;
    }
    if (!condition) {
      setError("Please select the condition on arrival.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await smsPut<SaleReturnResult>(
        `/api/sms/orders/${orderId}/lines/${lineId}/sale-return`,
        {
          receivedAt: receivedAt ? wibDateTimeInputToIso(receivedAt) : undefined,
          reason: reason.trim(),
          condition,
        },
        idempotencyKey,
      );
      toast.success(`Sale return recorded for VIN ${vin}. An inspection has been opened.`);
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record sale return."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Record sale return</h2>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{vin}</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Received at (WIB) <span className="text-destructive">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={receivedAt}
                max={nowDateTimeInputValue()}
                onChange={(e) => setReceivedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                minLength={3}
                maxLength={500}
                placeholder="Why is the customer returning this motorcycle?"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">{reason.length}/500</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Condition on arrival <span className="text-destructive">*</span>
              </label>
              <select
                required
                value={condition}
                onChange={(e) => setCondition(e.target.value as VehicleCondition | "")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>Select condition</option>
                {Object.entries(VEHICLE_CONDITION_LABEL).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button type="button" onClick={onClose} disabled={submitting}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              data-tour="sms-order-record-sale-return"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {submitting ? "Recording…" : "Record return"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
