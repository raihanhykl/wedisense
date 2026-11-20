"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, smsErrorMessage, isConflict } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";
import { apiGet } from "@/lib/api";
import type { ShipmentLineDetail, ReceiveResponse } from "@/lib/sms/shipments-types";
import type { VehicleVariantRow } from "@/lib/sms/types";

interface ShipmentDamageDialogProps {
  shipmentId: string;
  line: ShipmentLineDetail;
  onClose: () => void;
  onSuccess: (result: ReceiveResponse) => void;
}

/**
 * Record a single line as received with damage.
 * Damage notes are required; a variant must be chosen if the line has none.
 * The unit will be held for inspection.
 */
export function ShipmentDamageDialog({
  shipmentId,
  line,
  onClose,
  onSuccess,
}: ShipmentDamageDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [damageNotes, setDamageNotes] = useState("");
  const [eventDate, setEventDate] = useState(todayInputValue());
  const [variantId, setVariantId] = useState(line.variantId ?? "");
  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);

  useEffect(() => {
    if (line.variantId) return;
    apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants")
      .then(setVariants)
      .catch(() => {/* non-critical */});
  }, [line.variantId]);

  const canSubmit =
    damageNotes.trim().length > 0 &&
    eventDate.length === 10 &&
    (!!line.variantId || !!variantId);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPost<ReceiveResponse>(
        `/api/sms/shipments/${shipmentId}/receive`,
        {
          eventDate,
          items: [
            {
              lineId: line.id,
              condition: "DAMAGED",
              damageNotes: damageNotes.trim(),
              variantId: (line.variantId ?? variantId) || undefined,
            },
          ],
        },
        idempotencyKey,
      );
      toast.success("Unit received. It will be held for inspection.");
      onSuccess(result);
    } catch (err) {
      if (isConflict(err)) {
        onSuccess({ received: [], alreadyReceived: [], counts: { expected: 0, receivedOk: 0, receivedDamaged: 0, discrepancy: 0, pending: 0 } });
        return;
      }
      setError(smsErrorMessage(err, "Failed to record damage. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Unit arrived damaged</h2>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground break-all">{line.vin}</p>
        </div>

        <div className="space-y-4 px-6 py-4">
          {/* Variant picker if needed */}
          {!line.variantId && (
            <div>
              <label className="text-sm font-medium">
                Variant <span className="text-destructive">*</span>
              </label>
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
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
          )}

          {/* Damage notes */}
          <div>
            <label className="text-sm font-medium">
              Damage description <span className="text-destructive">*</span>
            </label>
            <textarea
              value={damageNotes}
              onChange={(e) => setDamageNotes(e.target.value)}
              rows={3}
              placeholder="Describe the damage observed on the unit"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

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

          <p className="text-xs text-muted-foreground">
            The unit will be held for inspection before it can be offered.
          </p>

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
            data-tour="sms-receive-damaged"
            onClick={() => void handleSubmit()}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {submitting ? "Recording…" : "Mark as damaged"}
          </button>
        </div>
      </div>
    </div>
  );
}
