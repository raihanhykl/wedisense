"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { todayInputValue, INSPECTION_REASON_LABEL, INSPECTION_RESULT_LABEL, VEHICLE_CONDITION_LABEL } from "@/lib/sms/labels";
import { apiGet } from "@/lib/api";
import type { UnitInspectionSummary, UserOption } from "@/lib/sms/types";

interface StartInspectionProps {
  mode: "start";
  unitId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface RecordResultProps {
  mode: "result";
  inspection: UnitInspectionSummary;
  onClose: () => void;
  onSuccess: () => void;
}

type InspectionDialogProps = StartInspectionProps | RecordResultProps;

export function InspectionDialog(props: InspectionDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start inspection state
  const [reason, setReason] = useState("OTHER");
  const [notes, setNotes] = useState("");
  const [eventDate, setEventDate] = useState(todayInputValue());

  // Record result state
  const [result, setResult] = useState<"PASSED" | "FAILED">("PASSED");
  const [condition, setCondition] = useState("GOOD");
  const [odometer, setOdometer] = useState("");
  const [findings, setFindings] = useState("");
  const [resultNotes, setResultNotes] = useState("");
  const [inspectorUserId, setInspectorUserId] = useState("");
  const [inspectedAt, setInspectedAt] = useState(() => {
    // `datetime-local` works in the browser's LOCAL time, so build the
    // default from local parts — `toISOString()` would show UTC, which is
    // seven hours behind the wall clock in WIB.
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [resultEventDate, setResultEventDate] = useState(todayInputValue());

  // User options for inspector picker
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  useEffect(() => {
    if (props.mode !== "result") return;
    void (async () => {
      try {
        const opts = await apiGet<UserOption[]>("/api/users/options");
        setUserOptions(opts);
      } catch {
        // picker stays empty
      }
    })();
  }, [props.mode]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (props.mode !== "start") return;
    setSubmitting(true);
    setError(null);
    try {
      await smsPost(
        "/api/sms/inspections",
        { unitId: props.unitId, reason, notes: notes || null, eventDate },
        idempotencyKey,
      );
      toast.success("Inspection started.");
      props.onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to start inspection."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (props.mode !== "result") return;
    setSubmitting(true);
    setError(null);
    try {
      await smsPut(
        `/api/sms/inspections/${props.inspection.id}/result`,
        {
          result,
          condition: condition || undefined,
          odometer: odometer ? Number(odometer) : undefined,
          findings: findings || null,
          notes: resultNotes || null,
          inspectorUserId: inspectorUserId || undefined,
          inspectedAt: inspectedAt ? new Date(inspectedAt).toISOString() : undefined,
          eventDate: resultEventDate,
        },
        idempotencyKey,
      );
      toast.success("Inspection result recorded.");
      props.onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to record inspection result."));
    } finally {
      setSubmitting(false);
    }
  };

  if (props.mode === "start") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
        <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Start inspection</h2>
          </div>
          <form onSubmit={(e) => void handleStart(e)}>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-sm font-medium">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(INSPECTION_REASON_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
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
              <div>
                <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t px-5 py-4">
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                data-tour="sms-inspection-start"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Starting…" : "Start inspection"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Record result
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Record inspection result</h2>
          <p className="mt-0.5 text-xs text-muted-foreground capitalize">
            {INSPECTION_REASON_LABEL[props.inspection.reason] ?? props.inspection.reason}
          </p>
        </div>
        <form onSubmit={(e) => void handleRecord(e)}>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Result</label>
                <select
                  value={result}
                  onChange={(e) => setResult(e.target.value as "PASSED" | "FAILED")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(INSPECTION_RESULT_LABEL)
                    .filter(([k]) => k !== "PENDING")
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Condition</label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(VEHICLE_CONDITION_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Odometer (km, optional)</label>
              <input
                type="number"
                min={0}
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="e.g. 12500"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Findings {result === "FAILED" && <span className="text-destructive">*</span>}
              </label>
              <textarea
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                rows={3}
                required={result === "FAILED"}
                placeholder={result === "FAILED" ? "Required when failed" : "Optional"}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <textarea
                value={resultNotes}
                onChange={(e) => setResultNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Inspector (optional)</label>
              <select
                value={inspectorUserId}
                onChange={(e) => setInspectorUserId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— not specified —</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.employeeId ? ` (${u.employeeId})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Inspected at</label>
              <input
                type="datetime-local"
                value={inspectedAt}
                onChange={(e) => setInspectedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Event date</label>
              <input
                type="date"
                value={resultEventDate}
                max={todayInputValue()}
                onChange={(e) => setResultEventDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-tour="sms-inspection-record"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save result"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
