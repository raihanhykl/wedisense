"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, smsErrorMessage } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";
import { apiGet } from "@/lib/api";
import type { VehicleVariantRow } from "@/lib/sms/types";

interface ResolveIdentityDialogProps {
  unitId: string;
  currentVin: string;
  currentEngineNumber: string | null;
  currentVariantId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResolveIdentityDialog({
  unitId,
  currentVin,
  currentEngineNumber,
  currentVariantId,
  onClose,
  onSuccess,
}: ResolveIdentityDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vin, setVin] = useState(currentVin);
  const [engineNumber, setEngineNumber] = useState(currentEngineNumber ?? "");
  const [variantId, setVariantId] = useState(currentVariantId);
  const [outcome, setOutcome] = useState<"AVAILABLE" | "INSPECTION">("AVAILABLE");
  const [notes, setNotes] = useState("");
  const [eventDate, setEventDate] = useState(todayInputValue());

  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const v = await apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants");
        setVariants(v);
      } catch {
        // stays empty
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) {
      setError("Notes are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await smsPost(
        `/api/sms/units/${unitId}/resolve-identity`,
        {
          vin: vin !== currentVin ? vin : undefined,
          engineNumber: engineNumber !== (currentEngineNumber ?? "") ? (engineNumber || null) : undefined,
          variantId: variantId !== currentVariantId ? variantId : undefined,
          outcome,
          notes,
          eventDate,
        },
        idempotencyKey,
      );
      toast.success("Identity resolved.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to resolve identity."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Resolve identity mismatch</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Correct the VIN, engine number or variant to match the physical unit.
          </p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">VIN (corrected)</label>
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Engine number (optional)</label>
              <input
                type="text"
                value={engineNumber}
                onChange={(e) => setEngineNumber(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Variant</label>
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.model.name} · {v.name} · {v.color}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Outcome</label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as "AVAILABLE" | "INSPECTION")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="AVAILABLE">Ready to offer</option>
                <option value="INSPECTION">Needs inspection</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Notes <span className="text-destructive">*</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                required
                placeholder="Describe the discrepancy and how it was resolved"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Event date</label>
              <input
                type="date"
                value={eventDate}
                max={todayInputValue()}
                onChange={(e) => setEventDate(e.target.value)}
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
              data-tour="sms-resolve-identity"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Resolve identity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
