"use client";

/**
 * Record the transfer of ownership to the customer — the RTO ends with the
 * customer keeping the motorcycle rather than returning it.
 *
 * After ownership transfer the unit moves to PICKED_UP status and the
 * contract is closed with outcome OWNERSHIP_TRANSFERRED.
 */

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";
import type { OwnershipTransferResult } from "@/lib/sms/rto-types";

export interface OwnershipTransferDialogProps {
  contractId: string;
  contractNumber: string;
  unitVin: string;
  customerName: string;
  onClose: () => void;
  onSuccess: (result: OwnershipTransferResult) => void;
}

export function OwnershipTransferDialog({
  contractId,
  contractNumber,
  unitVin,
  customerName,
  onClose,
  onSuccess,
}: OwnershipTransferDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const [transferredOn, setTransferredOn] = useState(todayInputValue());
  const [legalReference, setLegalReference] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPut<OwnershipTransferResult>(
        `/api/sms/rto-contracts/${contractId}/ownership-transfer`,
        {
          transferredOn: transferredOn || undefined,
          legalReference: legalReference.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      if (result.alreadyDone) {
        toast.info("Ownership transfer was already recorded.");
      } else {
        toast.success(
          `Ownership of VIN ${unitVin} transferred to ${customerName}. Contract closed.`,
        );
      }
      onSuccess(result);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record ownership transfer."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Transfer ownership to customer</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Contract <span className="font-mono font-medium">{contractNumber}</span> · VIN{" "}
            <span className="font-mono font-medium">{unitVin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div className="rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-800">
              <strong>Warning:</strong> after ownership transfer, the motorcycle stays with{" "}
              <strong>{customerName}</strong> — this cannot be undone. The unit will be recorded
              as &quot;With customer&quot; and the contract will be closed. Use this only when the customer
              has completed all RTO payments and legal documents are signed.
            </div>

            {/* Transferred on */}
            <div>
              <label className="mb-1 block text-sm font-medium">Transfer date</label>
              <input
                type="date"
                max={todayInputValue()}
                value={transferredOn}
                onChange={(e) => setTransferredOn(e.target.value)}
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
                placeholder="e.g. Deed No. 456/2026"
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
              data-tour="sms-rto-ownership-transfer-submit"
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {submitting ? "Transferring…" : "Transfer ownership"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
