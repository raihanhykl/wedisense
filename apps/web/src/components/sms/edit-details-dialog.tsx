"use client";

import { useState } from "react";
import { toast } from "sonner";
import { smsErrorMessage } from "@/lib/sms/client";
import { apiPut } from "@/lib/api";

interface EditDetailsDialogProps {
  unitId: string;
  currentLicensePlate: string | null;
  currentEngineNumber: string | null;
  currentNotes: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditDetailsDialog({
  unitId,
  currentLicensePlate,
  currentEngineNumber,
  currentNotes,
  onClose,
  onSuccess,
}: EditDetailsDialogProps) {
  const [licensePlate, setLicensePlate] = useState(currentLicensePlate ?? "");
  const [engineNumber, setEngineNumber] = useState(currentEngineNumber ?? "");
  const [notes, setNotes] = useState(currentNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // No idempotency key needed for details update per spec
      await apiPut(`/api/sms/units/${unitId}/details`, {
        licensePlate: licensePlate.trim() || null,
        engineNumber: engineNumber.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success("Unit details updated.");
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to update details."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Edit unit details</h2>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">License plate (optional)</label>
              <input
                type="text"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                placeholder="e.g. B 1234 ABC"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
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
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-tour="sms-edit-details"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
