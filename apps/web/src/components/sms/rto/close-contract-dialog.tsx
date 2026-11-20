"use client";

/**
 * Close an RTO contract once the motorcycle is physically back and the
 * administrative / legal closure has been confirmed outside the system.
 *
 * The unit is released only AFTER both: (1) the contract is closed AND
 * (2) the inspection passes. Either can happen in either order.
 */

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";
import type { CloseRtoContractResult } from "@/lib/sms/rto-types";

export interface CloseContractDialogProps {
  contractId: string;
  contractNumber: string;
  unitVin: string;
  onClose: () => void;
  onSuccess: (result: CloseRtoContractResult) => void;
}

export function CloseContractDialog({
  contractId,
  contractNumber,
  unitVin,
  onClose,
  onSuccess,
}: CloseContractDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const [closedOn, setClosedOn] = useState(todayInputValue());
  const [legalReference, setLegalReference] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPut<CloseRtoContractResult>(
        `/api/sms/rto-contracts/${contractId}/close`,
        {
          closedOn: closedOn || undefined,
          legalReference: legalReference.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      if (result.alreadyDone) {
        toast.info("This contract was already closed.");
      } else {
        toast.success(`Contract ${contractNumber} closed. The unit will be released after the inspection passes.`);
      }
      onSuccess(result);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to close contract."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Close RTO contract</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Contract <span className="font-mono font-medium">{contractNumber}</span> · VIN{" "}
            <span className="font-mono font-medium">{unitVin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Closing records that legal has confirmed the contract termination outside this
              system. The motorcycle must already be back at the showroom. The unit is released
              only after closure <strong>and</strong> a passed inspection — both are required.
            </div>

            {/* Closed on date */}
            <div>
              <label className="mb-1 block text-sm font-medium">Closure date</label>
              <input
                type="date"
                max={todayInputValue()}
                value={closedOn}
                onChange={(e) => setClosedOn(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Legal reference */}
            <div>
              <label className="mb-1 block text-sm font-medium">Legal reference (optional)</label>
              <input
                type="text"
                maxLength={255}
                value={legalReference}
                onChange={(e) => setLegalReference(e.target.value)}
                placeholder="e.g. Deed No. 123/2026"
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
              data-tour="sms-rto-close-submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Closing…" : "Close contract"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
