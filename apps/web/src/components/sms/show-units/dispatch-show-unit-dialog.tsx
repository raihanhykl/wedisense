"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { newIdempotencyKey, smsPost, smsErrorMessage } from "@/lib/sms/client";
import { nowDateTimeInputValue, wibDateTimeInputToIso } from "@/lib/sms/labels";
import type { ShowLoanRow, PersonOption } from "@/lib/sms/show-loans-types";

interface DispatchShowUnitDialogProps {
  unitId: string;
  unitVin: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function DispatchShowUnitDialog({
  unitId,
  unitVin,
  onClose,
  onSuccess,
}: DispatchShowUnitDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  // Form fields
  const [eventName, setEventName] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [picUserId, setPicUserId] = useState("");
  const [dispatchedAt, setDispatchedAt] = useState(nowDateTimeInputValue);
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [notes, setNotes] = useState("");

  // PIC search
  const [picSearch, setPicSearch] = useState("");
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [picName, setPicName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced PIC search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (picSearch.length < 1) {
        setPeople([]);
        return;
      }
      setPeopleLoading(true);
      try {
        const data = await apiGet<PersonOption[]>("/api/sms/people", { search: picSearch, limit: 10 });
        setPeople(data);
      } catch {
        setPeople([]);
      } finally {
        setPeopleLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [picSearch]);

  const selectPic = (person: PersonOption) => {
    setPicUserId(person.id);
    setPicName(person.name);
    setPicSearch("");
    setPeople([]);
  };

  const clearPic = () => {
    setPicUserId("");
    setPicName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picUserId) {
      setError("Please select a person in charge.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await smsPost<ShowLoanRow>(
        "/api/sms/show-loans",
        {
          unitId,
          eventName,
          eventLocation,
          picUserId,
          dispatchedAt: dispatchedAt ? wibDateTimeInputToIso(dispatchedAt) : undefined,
          expectedReturnDate,
          notes: notes || undefined,
        },
        idempotencyKey,
      );
      toast.success(`${unitVin} dispatched to event.`);
      onSuccess();
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to dispatch unit."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Send to show event</h2>
          <p className="mt-0.5 text-sm text-muted-foreground font-mono">{unitVin}</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            {/* Event name */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Event name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={120}
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. Jakarta Motor Show 2026"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Event location */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Event location <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={200}
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                placeholder="e.g. JIExpo Kemayoran, Jakarta"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* PIC */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Person in charge (PIC) <span className="text-destructive">*</span>
              </label>
              {picName ? (
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                  <span className="flex-1 font-medium">{picName}</span>
                  <button
                    type="button"
                    onClick={clearPic}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={picSearch}
                    onChange={(e) => setPicSearch(e.target.value)}
                    placeholder="Search by name or employee ID…"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                  {(people.length > 0 || peopleLoading) && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                      {peopleLoading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                      ) : (
                        people.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectPic(p)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="font-medium">{p.name}</span>
                            {p.employeeId && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.employeeId}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Dispatched at */}
            <div>
              <label className="mb-1 block text-sm font-medium">Dispatched at (WIB)</label>
              <input
                type="datetime-local"
                value={dispatchedAt}
                max={nowDateTimeInputValue()}
                onChange={(e) => setDispatchedAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">Defaults to now. Cannot be in the future.</p>
            </div>

            {/* Expected return date */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Planned return date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                required
                min={dispatchedAt.slice(0, 10)}
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
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
              disabled={submitting}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-tour="sms-unit-send-to-show"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Dispatching…" : "Confirm dispatch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
