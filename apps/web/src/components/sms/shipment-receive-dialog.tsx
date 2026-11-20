"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, smsErrorMessage, isConflict } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";
import { apiGet } from "@/lib/api";
import type { ShipmentLineDetail, ReceiveResponse } from "@/lib/sms/shipments-types";
import type { VehicleVariantRow } from "@/lib/sms/types";

interface ShipmentReceiveDialogProps {
  shipmentId: string;
  lines: ShipmentLineDetail[];
  onClose: () => void;
  onSuccess: (result: ReceiveResponse) => void;
}

/**
 * Confirm receipt of multiple pending lines (condition OK).
 * Lines without a matched variant require the user to select one first.
 */
export function ShipmentReceiveDialog({
  shipmentId,
  lines,
  onClose,
  onSuccess,
}: ShipmentReceiveDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState(todayInputValue());
  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);
  // Per-line variant overrides for lines missing a variantId
  const [variantOverrides, setVariantOverrides] = useState<Record<string, string>>({});

  const linesNeedingVariant = lines.filter((l) => !l.variantId);

  useEffect(() => {
    if (linesNeedingVariant.length === 0) return;
    apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants")
      .then(setVariants)
      .catch(() => {/* variants are optional */});
  }, [linesNeedingVariant.length]);

  const canSubmit =
    linesNeedingVariant.every((l) => variantOverrides[l.id]) &&
    eventDate.length === 10;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const items = lines.map((l) => ({
        lineId: l.id,
        condition: "OK" as const,
        variantId: variantOverrides[l.id] ?? l.variantId ?? undefined,
      }));
      const result = await smsPost<ReceiveResponse>(
        `/api/sms/shipments/${shipmentId}/receive`,
        { eventDate, items },
        idempotencyKey,
      );
      toast.success(`${result.received.length} unit${result.received.length === 1 ? "" : "s"} received.`);
      onSuccess(result);
    } catch (err) {
      if (isConflict(err)) {
        onSuccess({ received: [], alreadyReceived: [], counts: { expected: 0, receivedOk: 0, receivedDamaged: 0, discrepancy: 0, pending: 0 } });
        return;
      }
      setError(smsErrorMessage(err, "Failed to receive units. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Confirm receipt — {lines.length} unit{lines.length === 1 ? "" : "s"}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            All selected units will be marked as received in good condition.
          </p>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
          {/* VIN list */}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              VINs to receive
            </p>
            <ul className="space-y-1">
              {lines.map((l) => (
                <li key={l.id} className="font-mono text-sm break-all">
                  {l.vin}
                  {!l.variantId && !variantOverrides[l.id] && (
                    <span className="ml-2 text-xs text-amber-600">(variant required)</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Variant pickers for lines missing a variant */}
          {linesNeedingVariant.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Select variant for unmatched units
              </p>
              {linesNeedingVariant.map((l) => (
                <div key={l.id}>
                  <label className="text-xs text-muted-foreground">
                    <span className="font-mono">{l.vin}</span>
                  </label>
                  <select
                    value={variantOverrides[l.id] ?? ""}
                    onChange={(e) =>
                      setVariantOverrides((prev) => ({ ...prev, [l.id]: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">— select variant —</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.model.name} · {v.name} · {v.color}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Event date */}
          <div>
            <label className="text-sm font-medium">
              Date received
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

        {/* Footer */}
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
            data-tour="sms-receive-selected"
            onClick={() => void handleSubmit()}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Receiving…" : `Receive ${lines.length} unit${lines.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
