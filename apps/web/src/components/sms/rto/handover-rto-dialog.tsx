"use client";

/**
 * Hand over a unit as an RTO (Rent-To-Own) contract.
 *
 * When the unit is BOOKED (opened from the order detail page) the customer
 * and sales fields are pre-filled from the order and may be overridden.
 * When the unit is AVAILABLE the fields start blank.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { newIdempotencyKey, smsPost, smsErrorMessage } from "@/lib/sms/client";
import {
  nowDateTimeInputValue,
  wibDateTimeInputToIso,
  todayInputValue,
} from "@/lib/sms/labels";
import type { PersonOption } from "@/lib/sms/orders-types";
import type { CreateRtoContractResult } from "@/lib/sms/rto-types";

export interface HandoverRtoDialogProps {
  unitId: string;
  unitVin: string;
  /** Pre-fill sales when unit is already booked under an order. */
  preFilledSalesUserId?: string;
  preFilledSalesName?: string;
  preFilledCustomerName?: string;
  onClose: () => void;
  onSuccess: (result: CreateRtoContractResult) => void;
}

export function HandoverRtoDialog({
  unitId,
  unitVin,
  preFilledSalesUserId,
  preFilledSalesName,
  preFilledCustomerName,
  onClose,
  onSuccess,
}: HandoverRtoDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  // Contract fields
  const [contractNumber, setContractNumber] = useState("");
  const [customerName, setCustomerName] = useState(preFilledCustomerName ?? "");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [startDate, setStartDate] = useState(todayInputValue());
  const [handoverAt, setHandoverAt] = useState(nowDateTimeInputValue());
  const [notes, setNotes] = useState("");

  // Sales user picker
  const [salesUserId, setSalesUserId] = useState(preFilledSalesUserId ?? "");
  const [salesName, setSalesName] = useState(preFilledSalesName ?? "");
  const [salesSearch, setSalesSearch] = useState("");
  const [salesOptions, setSalesOptions] = useState<PersonOption[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced sales search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (salesSearch.length < 1) {
        setSalesOptions([]);
        return;
      }
      setSalesLoading(true);
      try {
        const data = await apiGet<PersonOption[]>("/api/sms/people", {
          search: salesSearch,
          limit: 10,
        });
        setSalesOptions(data);
      } catch {
        setSalesOptions([]);
      } finally {
        setSalesLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [salesSearch]);

  const selectSales = (person: PersonOption) => {
    setSalesUserId(person.id);
    setSalesName(person.name);
    setSalesSearch("");
    setSalesOptions([]);
  };

  const clearSales = () => {
    setSalesUserId("");
    setSalesName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!salesUserId) {
      setError("Please select a sales person.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPost<CreateRtoContractResult>(
        "/api/sms/rto-contracts",
        {
          unitId,
          contractNumber,
          salesUserId,
          customerName,
          customerPhone: customerPhone.trim() || undefined,
          customerIdNumber: customerIdNumber.trim() || undefined,
          startDate,
          handoverAt: handoverAt ? wibDateTimeInputToIso(handoverAt) : undefined,
          notes: notes.trim() || undefined,
        },
        idempotencyKey,
      );
      toast.success(`RTO contract ${result.contractNumber} created for VIN ${unitVin}.`);
      onSuccess(result);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to create RTO contract."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Hand over as RTO</h2>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{unitVin}</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            {/* Contract number */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Contract number <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                minLength={1}
                maxLength={100}
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="e.g. RTO-2026-00123"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono uppercase"
                autoFocus
              />
              <p className="mt-0.5 text-xs text-muted-foreground">
                Type the contract number exactly as it appears on the document.
              </p>
            </div>

            {/* Customer name */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Customer name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                minLength={1}
                maxLength={255}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Customer phone */}
            <div>
              <label className="mb-1 block text-sm font-medium">Customer phone (optional)</label>
              <input
                type="tel"
                maxLength={50}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="e.g. 08123456789"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Customer ID number */}
            <div>
              <label className="mb-1 block text-sm font-medium">Customer ID number (optional)</label>
              <input
                type="text"
                maxLength={100}
                value={customerIdNumber}
                onChange={(e) => setCustomerIdNumber(e.target.value)}
                placeholder="NIK / KTP number"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Sales person */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Sales person <span className="text-destructive">*</span>
              </label>
              {salesName ? (
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                  <span className="flex-1 font-medium">{salesName}</span>
                  <button
                    type="button"
                    onClick={clearSales}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={salesSearch}
                    onChange={(e) => setSalesSearch(e.target.value)}
                    placeholder="Search by name or employee ID…"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                  {(salesOptions.length > 0 || salesLoading) && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                      {salesLoading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                      ) : (
                        salesOptions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectSales(p)}
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

            {/* Start date */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Contract start date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                required
                max={todayInputValue()}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Handover time */}
            <div>
              <label className="mb-1 block text-sm font-medium">Handover time (WIB)</label>
              <input
                type="datetime-local"
                value={handoverAt}
                max={nowDateTimeInputValue()}
                onChange={(e) => setHandoverAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">
                Defaults to now. Cannot be in the future.
              </p>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
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
              data-tour="sms-rto-handover-submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Hand over as RTO"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
