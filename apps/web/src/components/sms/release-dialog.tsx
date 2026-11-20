"use client";

import { useState } from "react";
import { toast } from "sonner";
import { newIdempotencyKey, smsPost, smsErrorMessage } from "@/lib/sms/client";
import { todayInputValue } from "@/lib/sms/labels";

interface ReleaseDialogProps {
  unitId: string;
  releaseBlockers: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function ReleaseDialog({ unitId, releaseBlockers, onClose, onSuccess }: ReleaseDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [notes, setNotes] = useState("");
  const [eventDate, setEventDate] = useState(todayInputValue());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await smsPost(`/api/sms/units/${unitId}/release`, { notes: notes || undefined, eventDate }, idempotencyKey);
      toast.success("Unit released as ready.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to release unit."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Release unit</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Mark this unit as ready to offer.</p>
        </div>

        {releaseBlockers.length > 0 ? (
          <div className="p-5">
            <p className="mb-2 text-sm font-medium text-destructive">Cannot be released yet:</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {releaseBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <div className="space-y-4 p-5">
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
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                data-tour="sms-unit-release"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Releasing…" : "Release unit"}
              </button>
            </div>
          </form>
        )}

        {releaseBlockers.length > 0 && (
          <div className="flex justify-end border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
