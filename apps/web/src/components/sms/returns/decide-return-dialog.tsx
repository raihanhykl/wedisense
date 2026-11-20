"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, toSmsError } from "@/lib/sms/client";
import type { ReturnRequestRow } from "@/lib/sms/returns-types";

interface DecideReturnDialogProps {
  request: ReturnRequestRow;
  onClose: () => void;
  onSuccess: () => void;
}

type Decision = "APPROVED" | "REJECTED";

export function DecideReturnDialog({ request, onClose, onSuccess }: DecideReturnDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [decision, setDecision] = useState<Decision>("APPROVED");
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
      await smsPut(
        `/api/sms/return-requests/${request.id}/decide`,
        { decision, reason: requiresReason ? reason.trim() : undefined },
        idempotencyKey,
      );
      toast.success(decision === "APPROVED" ? "Return request approved." : "Return request rejected.");
      onSuccess();
    } catch (err) {
      const e = toSmsError(err, "Failed to submit decision.");
      if (e.status === 409) {
        setError(`Already decided. ${e.message}`);
      } else {
        setError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Decide return request</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {request.requestNumber} · VIN{" "}
            <span className="font-mono font-medium">{request.unit.vin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Requesting showroom:{" "}
                <span className="font-medium text-foreground">{request.toShowroom.name}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Reason: <span className="text-foreground">{request.reason}</span>
              </p>
              {request.custodyReceivedAt && (
                <p className="mt-1 rounded bg-purple-50 px-2 py-1 text-xs text-purple-700">
                  Motorcycle is already in custody at {request.toShowroom.name}.
                </p>
              )}
            </div>

            {/* Decision tabs */}
            <div>
              <label className="mb-1 block text-sm font-medium">Decision</label>
              <div className="flex overflow-hidden rounded-md border">
                {(["APPROVED", "REJECTED"] as Decision[]).map((d) => (
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
                  placeholder="Why is this return request being rejected?"
                  maxLength={500}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted-foreground">{reason.length}/500</p>
              </div>
            )}

            {decision === "REJECTED" && request.custodyReceivedAt && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                The motorcycle is in custody. After rejection, {request.toShowroom.name} must
                hand it back to the rider or file a new request.
              </div>
            )}

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
              data-tour="sms-return-decide-submit"
              className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                decision === "APPROVED"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }`}
            >
              {submitting ? "Submitting…" : decision === "APPROVED" ? "Approve" : "Reject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
