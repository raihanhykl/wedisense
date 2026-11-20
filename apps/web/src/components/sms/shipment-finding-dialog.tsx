"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, smsErrorMessage, isConflict } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";
import { apiGet } from "@/lib/api";
import type { ShipmentLineDetail, FindingsResponse } from "@/lib/sms/shipments-types";
import type { VehicleVariantRow } from "@/lib/sms/types";

interface ShipmentFindingDialogProps {
  shipmentId: string;
  /** Pre-filled from the manifest line when opened from a specific pending line. */
  line?: ShipmentLineDetail | null;
  onClose: () => void;
  onSuccess: (result: FindingsResponse) => void;
}

/**
 * Record a motorcycle that arrived with an identity that differs from the manifest.
 * The unit will be held until the discrepancy is reconciled.
 */
export function ShipmentFindingDialog({
  shipmentId,
  line,
  onClose,
  onSuccess,
}: ShipmentFindingDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vin, setVin] = useState(line?.vin ?? "");
  const [engineNumber, setEngineNumber] = useState(line?.engineNumber ?? "");
  const [variantId, setVariantId] = useState(line?.variantId ?? "");
  const [notes, setNotes] = useState("");
  const [eventDate, setEventDate] = useState(todayInputValue());

  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(true);

  useEffect(() => {
    apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants")
      .then((data) => { setVariants(data); })
      .catch(() => {/* non-critical */})
      .finally(() => setVariantsLoading(false));
  }, []);

  const canSubmit =
    vin.trim().length > 0 &&
    variantId.length > 0 &&
    notes.trim().length > 0 &&
    eventDate.length === 10;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPost<FindingsResponse>(
        `/api/sms/shipments/${shipmentId}/findings`,
        {
          vin: vin.trim().toUpperCase(),
          engineNumber: engineNumber.trim() || undefined,
          variantId,
          lineId: line?.id,
          notes: notes.trim(),
          eventDate,
        },
        idempotencyKey,
      );
      toast.success("Finding recorded. The unit will be held until reconciled.");
      onSuccess(result);
    } catch (err) {
      if (isConflict(err)) {
        onSuccess({ unit: { id: "", vin: "", status: "" }, line: { id: "", receiptStatus: "" }, isNewLine: false });
        return;
      }
      setError(smsErrorMessage(err, "Failed to record finding. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Record a finding</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Use this when a motorcycle arrived with an identity that differs from the manifest.
            It will be held until the discrepancy is reconciled.
          </p>
        </div>

        <div className="space-y-4 px-6 py-4">
          {/* Actual VIN */}
          <div>
            <label className="text-sm font-medium">
              Actual VIN on the unit <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              placeholder="17-character chassis number"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              spellCheck={false}
              autoCapitalize="characters"
            />
          </div>

          {/* Engine number */}
          <div>
            <label className="text-sm font-medium">Engine number (optional)</label>
            <input
              type="text"
              value={engineNumber}
              onChange={(e) => setEngineNumber(e.target.value.toUpperCase())}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              spellCheck={false}
            />
          </div>

          {/* Variant */}
          <div>
            <label className="text-sm font-medium">
              Variant <span className="text-destructive">*</span>
            </label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              disabled={variantsLoading}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">— select variant —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.model.name} · {v.name} · {v.color}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium">
              Notes <span className="text-destructive">*</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Describe how the actual identity differs from the manifest"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Event date */}
          <div>
            <label className="text-sm font-medium">
              Date found
              <input
                type="date"
                value={eventDate}
                max={todayInputValue()}
                onChange={(e) => setEventDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-tour="sms-record-finding"
            onClick={() => void handleSubmit()}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Recording…" : "Record finding"}
          </button>
        </div>
      </div>
    </div>
  );
}
