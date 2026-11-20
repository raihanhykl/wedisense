"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { nowDateTimeInputValue, wibDateTimeInputToIso, VEHICLE_CONDITION_LABEL, type VehicleCondition } from "@/lib/sms/labels";
import type { ReturnRequestRow } from "@/lib/sms/returns-types";

interface OfficialReceiptDialogProps {
  request: ReturnRequestRow;
  onClose: () => void;
  onSuccess: () => void;
}


export function OfficialReceiptDialog({ request, onClose, onSuccess }: OfficialReceiptDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [officialReceivedAt, setOfficialReceivedAt] = useState(nowDateTimeInputValue());
  const [condition, setCondition] = useState<VehicleCondition>("GOOD");
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await smsPut(
        `/api/sms/return-requests/${request.id}/official-receipt`,
        {
          officialReceivedAt: wibDateTimeInputToIso(officialReceivedAt),
          condition,
          odometer: odometer ? Number(odometer) : undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      toast.success("Official receipt recorded. Motorcycle enters inspection here.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record official receipt."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Official receipt</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {request.requestNumber} · VIN{" "}
            <span className="font-mono font-medium">{request.unit.vin}</span>
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            {/* Important notice */}
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <p className="font-medium">What happens after you confirm:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>
                  The motorcycle enters <strong>Inspection</strong> at this showroom.
                </li>
                <li>
                  This showroom becomes the <strong>responsible showroom</strong> for this unit.
                </li>
                <li>
                  The RTO contract from {request.fromShowroom.name} is marked as returned here but
                  stays open. Close it once legal confirms; the unit can be released only after the
                  contract is closed and an inspection has passed.
                </li>
              </ul>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Officially received at <span className="text-destructive">*</span>
              </label>
              <input
                type="datetime-local"
                value={officialReceivedAt}
                onChange={(e) => setOfficialReceivedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Condition <span className="text-destructive">*</span>
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as VehicleCondition)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                required
              >
                {Object.entries(VEHICLE_CONDITION_LABEL).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Odometer (km)</label>
              <input
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="Leave blank if not recorded"
                min={0}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Inspection findings, remarks, etc."
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
              data-tour="sms-return-official-receipt-submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Confirming…" : "Confirm official receipt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
