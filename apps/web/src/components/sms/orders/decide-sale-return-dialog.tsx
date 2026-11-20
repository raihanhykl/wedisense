"use client";

/**
 * Approve or reject a received sale return. Rejecting hands the motorcycle
 * back to the customer. Used from the SPK page and the VIN card.
 */
import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import type { DecideSaleReturnResult } from "@/lib/sms/orders-types";

interface DecideSaleReturnDialogProps {
  orderId: string;
  lineId: string;
  vin: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function DecideSaleReturnDialog({
  orderId,
  lineId,
  vin,
  onClose,
  onSuccess,
}: DecideSaleReturnDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresReason = decision === "REJECTED";
  const canSubmit = !requiresReason || reason.trim().length >= 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await smsPut<DecideSaleReturnResult>(
        `/api/sms/orders/${orderId}/lines/${lineId}/sale-return/decide`,
        {
          decision,
          reason: requiresReason ? reason.trim() : undefined,
        },
        idempotencyKey,
      );
      toast.success(
        decision === "APPROVED"
          ? `Sale return approved for VIN ${vin}.`
          : `Sale return rejected for VIN ${vin} — motorcycle stays with customer.`,
      );
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record decision."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Decide sale return</h2>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{vin}</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">Decision</label>
              <div className="flex overflow-hidden rounded-md border">
                {(["APPROVED", "REJECTED"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDecision(d)}
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                      decision === d
                        ? d === "APPROVED"
                          ? "bg-emerald-600 text-white"
                          : "bg-destructive text-destructive-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {d === "APPROVED" ? "Approve" : "Reject"}
                  </button>
                ))}
              </div>
            </div>
            {requiresReason && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Reason for rejection <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Why is this return being rejected?"
                  autoFocus
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">{reason.length}/500</p>
              </div>
            )}
            {decision === "REJECTED" && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Rejecting the return sends the motorcycle back to the customer — it will remain
                in the customer{"'"}s possession.
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button type="button" onClick={onClose} disabled={submitting}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !canSubmit}
              data-tour="sms-order-decide-sale-return"
              className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                decision === "APPROVED"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }`}>
              {submitting ? "Submitting…" : decision === "APPROVED" ? "Approve" : "Reject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
