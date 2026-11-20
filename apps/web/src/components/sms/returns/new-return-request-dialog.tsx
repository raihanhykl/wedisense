"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import {
  newIdempotencyKey,
  smsPost,
  smsErrorMessage,
} from "@/lib/sms/client";
import {
  nowDateTimeInputValue,
  wibDateTimeInputToIso,
  VEHICLE_CONDITION_LABEL,
  unitStatusLabel,
  type VehicleCondition,
} from "@/lib/sms/labels";
import type { ReturnRequestLookupHit, ReturnRequestRow } from "@/lib/sms/returns-types";
import type { SmsShowroom } from "@/components/sms/showroom-context";

interface NewReturnRequestDialogProps {
  /** The showroom that is requesting (toShowroom). */
  toShowroom: SmsShowroom;
  onClose: () => void;
  onSuccess: (requestNumber: string) => void;
}


type Step = "lookup" | "form";

export function NewReturnRequestDialog({
  toShowroom,
  onClose,
  onSuccess,
}: NewReturnRequestDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [step, setStep] = useState<Step>("lookup");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ReturnRequestLookupHit[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [selected, setSelected] = useState<ReturnRequestLookupHit | null>(null);

  // Form fields
  const [reason, setReason] = useState("");
  const [hasCustody, setHasCustody] = useState(false);
  const [custodyReceivedAt, setCustodyReceivedAt] = useState(nowDateTimeInputValue());
  const [condition, setCondition] = useState<VehicleCondition | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 5) {
      setHits(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLookupLoading(true);
      try {
        const results = await apiGet<ReturnRequestLookupHit[]>(
          "/api/sms/return-requests/lookup",
          { q: query },
        );
        setHits(results);
      } catch {
        setHits([]);
      } finally {
        setLookupLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (hit: ReturnRequestLookupHit) => {
    setSelected(hit);
    setStep("form");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPost<ReturnRequestRow>(
        "/api/sms/return-requests",
        {
          unitId: selected.unitId,
          toShowroomId: toShowroom.id,
          reason: reason.trim(),
          custodyReceivedAt: hasCustody ? wibDateTimeInputToIso(custodyReceivedAt) : undefined,
          condition: hasCustody && condition ? condition : undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      toast.success(`Return request ${result.requestNumber} created.`);
      onSuccess(result.requestNumber);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to create return request."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">New return request</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Requesting showroom: {toShowroom.name}</p>
        </div>

        {step === "lookup" ? (
          <div className="p-5">
            <label htmlFor="return-lookup-query" className="mb-1 block text-sm font-medium">
              Search by VIN, VIN suffix (≥ 5 characters), or RTO contract number
            </label>
            <input
              id="return-lookup-query"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. MHFBG3... or last 5 digits"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              autoFocus
            />
            <p className="mt-1 text-xs text-muted-foreground">Only units in Active RTO at another showroom are shown.</p>

            {/* Results */}
            <div className="mt-3">
              {lookupLoading && (
                <p className="py-4 text-center text-sm text-muted-foreground">Searching…</p>
              )}
              {!lookupLoading && hits !== null && hits.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No matching units found.
                </p>
              )}
              {!lookupLoading && hits && hits.length > 0 && (
                <div className="space-y-1">
                  {hits.map((hit) => (
                    <button
                      key={hit.unitId}
                      type="button"
                      onClick={() => handleSelect(hit)}
                      disabled={!!hit.openReturnRequest}
                      className="flex w-full flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left text-sm hover:border-primary/50 hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-medium">{hit.vin}</span>
                        <span className="text-xs text-muted-foreground">
                          {unitStatusLabel(hit.status)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {hit.variant.modelName} · {hit.variant.variantName} · {hit.variant.color}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Responsible: {hit.responsibleShowroom.name}
                      </span>
                      {hit.rtoContractNumber && (
                        <span className="text-xs text-muted-foreground">
                          Contract: {hit.rtoContractNumber}
                        </span>
                      )}
                      {hit.customerName !== "[Hidden]" && (
                        <span className="text-xs text-muted-foreground">
                          Customer: {hit.customerName}
                        </span>
                      )}
                      {hit.openReturnRequest && (
                        <span className="mt-0.5 text-xs font-medium text-amber-700">
                          Already has an open return request ({hit.openReturnRequest.requestNumber})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <div className="space-y-4 p-5">
              {/* Selected unit summary */}
              {selected && (
                <div className="flex items-start justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <div>
                    <span className="font-mono font-medium">{selected.vin}</span>
                    <span className="ml-2 text-muted-foreground">
                      {selected.variant.modelName} · {selected.variant.variantName}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      Responsible: {selected.responsibleShowroom.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setStep("lookup"); setSelected(null); }}
                    className="ml-2 shrink-0 text-xs text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Reason for return <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this motorcycle being returned? (3–500 characters)"
                  minLength={3}
                  maxLength={500}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  autoFocus
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">{reason.length}/500</p>
              </div>

              {/* Custody toggle */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="has-custody"
                  checked={hasCustody}
                  onChange={(e) => setHasCustody(e.target.checked)}
                  className="h-4 w-4 rounded border"
                />
                <label htmlFor="has-custody" className="text-sm">
                  The motorcycle is already physically here (custody)
                </label>
              </div>

              {hasCustody && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Arrived at</label>
                    <input
                      type="datetime-local"
                      value={custodyReceivedAt}
                      onChange={(e) => setCustodyReceivedAt(e.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Condition on arrival</label>
                    <select
                      value={condition}
                      onChange={(e) => setCondition(e.target.value as VehicleCondition | "")}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Not specified</option>
                      {Object.entries(VEHICLE_CONDITION_LABEL).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Optional additional notes"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <div className="flex justify-end gap-3 border-t px-5 py-4">
              <button
                type="button"
                onClick={() => setStep("lookup")}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || reason.trim().length < 3}
                data-tour="sms-return-request-submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
