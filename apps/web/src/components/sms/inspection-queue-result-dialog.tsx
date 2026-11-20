"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPut, smsErrorMessage, isConflict } from "@/lib/sms/client";
import { todayInputValue, VEHICLE_CONDITION_LABEL, INSPECTION_REASON_LABEL } from "@/lib/sms/labels";
import { apiGet } from "@/lib/api";
import type { InspectionRow } from "@/lib/sms/shipments-types";
import type { UserOption } from "@/lib/sms/types";

interface InspectionQueueResultDialogProps {
  inspection: InspectionRow;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Record the result of a pending inspection from the inspection queue.
 * After a pass the unit still needs to be released from its unit card.
 */
export function InspectionQueueResultDialog({
  inspection,
  onClose,
  onSuccess,
}: InspectionQueueResultDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<"PASSED" | "FAILED" | "">("");
  const [condition, setCondition] = useState("");
  const [odometer, setOdometer] = useState("");
  const [findings, setFindings] = useState("");
  const [notes, setNotes] = useState("");
  const [inspectorUserId, setInspectorUserId] = useState("");
  const [inspectedAt, setInspectedAt] = useState(todayInputValue() + "T09:00");

  const [userOptions, setUserOptions] = useState<UserOption[]>([]);

  useEffect(() => {
    apiGet<UserOption[]>("/api/users/options")
      .then(setUserOptions)
      .catch(() => {/* non-critical */});
  }, []);

  const canSubmit =
    result !== "" &&
    (result !== "FAILED" || findings.trim().length > 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await smsPut(
        `/api/sms/inspections/${inspection.id}/result`,
        {
          result,
          condition: condition || undefined,
          odometer: odometer ? parseInt(odometer, 10) : undefined,
          findings: findings.trim() || null,
          notes: notes.trim() || null,
          inspectorUserId: inspectorUserId || undefined,
          inspectedAt: inspectedAt ? new Date(inspectedAt).toISOString() : undefined,
        },
        idempotencyKey,
      );
      toast.success(
        result === "PASSED"
          ? "Inspection passed. Release the unit from its unit card when ready."
          : "Inspection failed. The unit remains held.",
      );
      onSuccess();
    } catch (err) {
      if (isConflict(err)) {
        onSuccess();
        return;
      }
      setError(smsErrorMessage(err, "Failed to record inspection result. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const { unit } = inspection;
  const variantLabel = `${unit.variant.modelName} · ${unit.variant.variantName} · ${unit.variant.color}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Record inspection result</h2>
          <div className="mt-1 space-y-0.5">
            <p className="font-mono text-sm break-all">{unit.vin}</p>
            <p className="text-sm text-muted-foreground">{variantLabel}</p>
            <p className="text-xs text-muted-foreground">
              Reason: {INSPECTION_REASON_LABEL[inspection.reason] ?? inspection.reason}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-4">
          {/* Result */}
          <div>
            <p className="mb-2 text-sm font-medium">
              Result <span className="text-destructive">*</span>
            </p>
            <div className="flex gap-3">
              {(["PASSED", "FAILED"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={
                    result === r
                      ? r === "PASSED"
                        ? "flex-1 rounded-md border-2 border-emerald-500 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700"
                        : "flex-1 rounded-md border-2 border-red-500 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700"
                      : "flex-1 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
                  }
                >
                  {r === "PASSED" ? "Passed" : "Failed"}
                </button>
              ))}
            </div>
          </div>

          {/* Condition */}
          <div>
            <label className="text-sm font-medium">Condition after inspection</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— not specified —</option>
              {Object.entries(VEHICLE_CONDITION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Odometer */}
          <div>
            <label className="text-sm font-medium">Odometer (km)</label>
            <input
              type="number"
              min={0}
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              placeholder="e.g. 12500"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Findings — required when Failed */}
          <div>
            <label className="text-sm font-medium">
              Findings
              {result === "FAILED" && <span className="ml-1 text-destructive">*</span>}
            </label>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              rows={3}
              placeholder={
                result === "FAILED"
                  ? "Describe the issues found (required)"
                  : "Any observations from the inspection"
              }
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium">Additional notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Inspector */}
          <div>
            <label className="text-sm font-medium">Inspector (optional)</label>
            <select
              value={inspectorUserId}
              onChange={(e) => setInspectorUserId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— not specified —</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.employeeId ? ` (${u.employeeId})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Inspected at */}
          <div>
            <label className="text-sm font-medium">Inspected at</label>
            <input
              type="datetime-local"
              value={inspectedAt}
              max={new Date().toISOString().slice(0, 16)}
              onChange={(e) => setInspectedAt(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {result === "PASSED" && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              After saving, the unit still needs to be released from its unit card before it can be offered.
            </p>
          )}

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
            data-tour="sms-inspection-record-result"
            onClick={() => void handleSubmit()}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save result"}
          </button>
        </div>
      </div>
    </div>
  );
}
