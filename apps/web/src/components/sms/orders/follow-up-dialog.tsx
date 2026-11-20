"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiPut } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";

interface FollowUpDialogProps {
  orderId: string;
  lineId: string;
  vin: string;
  currentFollowUpAt: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function FollowUpDialog({
  orderId,
  lineId,
  vin,
  currentFollowUpAt,
  onClose,
  onSuccess,
}: FollowUpDialogProps) {
  const today = todayInputValue();
  const maxDate = addDays(today, 30);

  const [nextFollowUpDate, setNextFollowUpDate] = useState(
    currentFollowUpAt ? currentFollowUpAt.slice(0, 10) : today,
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiPut(
        `/api/sms/orders/${orderId}/lines/${lineId}/follow-up`,
        { nextFollowUpDate, note: note.trim() || undefined },
      );
      toast.success("Follow-up date updated.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to update follow-up date."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Still active / follow up</h2>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{vin}</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Next follow-up date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={nextFollowUpDate}
                min={today}
                max={maxDate}
                onChange={(e) => setNextFollowUpDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Up to 30 days from today.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Note (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="e.g. Called, customer wants to visit this weekend"
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
              disabled={submitting || !nextFollowUpDate}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Update follow-up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
