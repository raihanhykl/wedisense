"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { newIdempotencyKey, smsPost, toSmsError } from "@/lib/sms/client";
import { variantLabel } from "@/lib/sms/labels";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import { describeBookingConflict, type BookingConflictDetail, type CreateOrderResult, type PersonOption, type UnitPickerResult } from "@/lib/sms/orders-types";

// ── People picker ──────────────────────────────────────────────────────

interface PeoplePickerProps {
  value: PersonOption | null;
  onSelect: (p: PersonOption | null) => void;
  error?: string | null;
}

function PeoplePicker({ value, onSelect, error }: PeoplePickerProps) {
  const [search, setSearch] = useState(value ? value.name : "");
  const [results, setResults] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPeople = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const data = await apiGet<PersonOption[]>("/api/sms/people", {
        search: q || undefined,
        limit: 20,
      });
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchPeople(search);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchPeople]);

  // Load initial results
  useEffect(() => {
    void fetchPeople("");
  }, [fetchPeople]);

  const handleSelect = (p: PersonOption) => {
    setSearch(p.name);
    setOpen(false);
    onSelect(p);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search by name or employee ID"
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${error ? "border-destructive" : ""}`}
      />
      {value && (
        <p className="mt-1 text-xs text-muted-foreground">
          {value.employeeId ? `ID: ${value.employeeId}` : "No employee ID"}
        </p>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => handleSelect(p)}
              className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-medium">{p.name}</span>
              {p.employeeId && (
                <span className="text-xs text-muted-foreground">ID: {p.employeeId}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── VIN picker row ─────────────────────────────────────────────────────

interface UnitRowData {
  rowId: string;
  unit: UnitPickerResult | null;
  conflict: BookingConflictDetail | null;
}

interface VinRowPickerProps {
  showroomId: string;
  value: UnitPickerResult | null;
  excludeIds: string[];
  conflict: BookingConflictDetail | null;
  onSelect: (unit: UnitPickerResult | null) => void;
}

function VinRowPicker({ showroomId, value, excludeIds, conflict, onSelect }: VinRowPickerProps) {
  const [search, setSearch] = useState(value?.vin ?? "");
  const [results, setResults] = useState<UnitPickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUnits = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const data = await apiGet<UnitPickerResult[]>("/api/sms/units", {
          showroomId,
          view: "ready",
          search: q,
          limit: 10,
        });
        setResults(data.filter((u) => !excludeIds.includes(u.id)));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [showroomId, excludeIds],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchUnits(search);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchUnits]);

  const handleSelect = (unit: UnitPickerResult) => {
    setSearch(unit.vin);
    setOpen(false);
    onSelect(unit);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          if (!e.target.value) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search VIN (last 4+ chars)"
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm font-mono ${conflict ? "border-destructive" : ""}`}
      />
      {value && !conflict && (
        <p className="mt-1 text-xs text-muted-foreground">{variantLabel(value.variant)}</p>
      )}
      {conflict && (
        <div className="mt-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <p className="font-medium">
            {describeBookingConflict(conflict)}
          </p>
          {conflict.alternatives.length > 0 && (
            <div className="mt-1">
              <span className="text-muted-foreground">Alternatives: </span>
              {conflict.alternatives.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => {
                    setSearch(alt.vin);
                    onSelect({
                      id: alt.id,
                      vin: alt.vin,
                      variant: { id: "", name: alt.variantName, color: alt.color, model: { id: "", code: "", name: alt.modelName } },
                      physicalLocation: null,
                      status: "AVAILABLE",
                    });
                  }}
                  className="ml-1 font-mono underline hover:no-underline"
                >
                  {alt.vin}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={() => handleSelect(u)}
              className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-mono font-semibold">{u.vin}</span>
              <span className="text-xs text-muted-foreground">{variantLabel(u.variant)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main form ──────────────────────────────────────────────────────────

function NewOrderInner() {
  const { showroom, can } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillUnitId = searchParams.get("unitId");

  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  // Header fields
  const [spkNumber, setSpkNumber] = useState("");
  const [salesPerson, setSalesPerson] = useState<PersonOption | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [notes, setNotes] = useState("");

  // Unit rows
  const [unitRows, setUnitRows] = useState<UnitRowData[]>([
    { rowId: crypto.randomUUID(), unit: null, conflict: null },
  ]);

  // Prefill first unit row if unitId is in the URL
  const [prefillLoaded, setPrefillLoaded] = useState(false);
  useEffect(() => {
    if (!prefillUnitId || prefillLoaded || !showroom) return;
    setPrefillLoaded(true);
    void (async () => {
      try {
        const unit = await apiGet<UnitPickerResult>(`/api/sms/units/${prefillUnitId}`);
        if (unit.physicalLocation?.id === showroom.id) {
          setUnitRows([{ rowId: crypto.randomUUID(), unit, conflict: null }]);
        }
      } catch {
        // Ignore prefill failures — form still works
      }
    })();
  }, [prefillUnitId, prefillLoaded, showroom]);

  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!showroom || !can("sms-orders:manage")) return null;

  const selectedIds = unitRows.map((r) => r.unit?.id).filter((id): id is string => !!id);
  const hasConflicts = unitRows.some((r) => r.conflict !== null);

  const addUnitRow = () => {
    if (unitRows.length < 20) {
      setUnitRows((prev) => [...prev, { rowId: crypto.randomUUID(), unit: null, conflict: null }]);
    }
  };

  const removeUnitRow = (rowId: string) => {
    setUnitRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const updateUnitRow = (rowId: string, unit: UnitPickerResult | null) => {
    setUnitRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, unit, conflict: null } : r)),
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!spkNumber.trim()) errors.spkNumber = "SPK number is required.";
    if (!salesPerson) errors.salesPerson = "Sales person is required.";
    if (!customerName.trim()) errors.customerName = "Customer name is required.";
    if (selectedIds.length === 0) errors.units = "At least one unit is required.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setGlobalError(null);
    try {
      const result = await smsPost<CreateOrderResult>(
        "/api/sms/orders",
        {
          showroomId: showroom.id,
          spkNumber: spkNumber.trim(),
          salesUserId: salesPerson!.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || undefined,
          customerIdNumber: customerIdNumber.trim() || undefined,
          notes: notes.trim() || undefined,
          unitIds: selectedIds,
        },
        idempotencyKey,
      );
      toast.success(`SPK ${result.spkNumber} created with ${result.bookedCount} unit${result.bookedCount !== 1 ? "s" : ""}.`);
      router.push(`/admin/sms/orders/${result.orderId}`);
    } catch (err) {
      const smsErr = toSmsError(err, "Failed to create order.");

      if (smsErr.code === "SMS_BOOKING_CONFLICT") {
        // Mint a new key — the payload changes when conflicts are fixed
        setIdempotencyKey(newIdempotencyKey());
        const conflicts = smsErr.details as unknown as Array<BookingConflictDetail>;
        setUnitRows((prev) =>
          prev.map((row) => {
            const conflict = conflicts.find((c) => c.unitId === row.unit?.id) ?? null;
            return { ...row, conflict };
          }),
        );
        setGlobalError("One or more units cannot be booked. Fix the highlighted rows and try again.");
      } else if (smsErr.code === "SMS_SPK_ALREADY_EXISTS") {
        const existingId = (smsErr.details[0] as { orderId?: string } | undefined)?.orderId;
        setFieldErrors((prev) => ({
          ...prev,
          spkNumber: existingId
            ? `SPK number already exists. `
            : "SPK number already exists at this showroom.",
        }));
        if (existingId) {
          setGlobalError(`SPK already exists. Add units to the existing SPK instead.`);
        }
      } else if (smsErr.code === "SMS_SALES_USER_NOT_FOUND") {
        setFieldErrors((prev) => ({ ...prev, salesPerson: "Selected user not found or inactive." }));
      } else {
        setGlobalError(smsErr.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/admin/sms" className="hover:text-foreground">Stock</Link>
        {" / "}
        <Link href="/admin/sms/orders" className="hover:text-foreground">Orders</Link>
        {" / "}
        <span className="text-foreground">New SPK</span>
      </nav>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">New SPK</h1>
        <ShowroomSwitcher />
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="mx-auto max-w-2xl space-y-6">
        {/* Header fields */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Order details
          </h2>
          <div className="space-y-4">
            {/* SPK number */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                SPK number <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={spkNumber}
                onChange={(e) => setSpkNumber(e.target.value)}
                placeholder="e.g. SPK-2026-001"
                maxLength={100}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm font-mono ${fieldErrors.spkNumber ? "border-destructive" : ""}`}
              />
              {fieldErrors.spkNumber && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.spkNumber}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Will be normalised to uppercase.
              </p>
            </div>

            {/* Sales person */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Sales person <span className="text-destructive">*</span>
              </label>
              <PeoplePicker
                value={salesPerson}
                onSelect={setSalesPerson}
                error={fieldErrors.salesPerson}
              />
              {fieldErrors.salesPerson && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.salesPerson}</p>
              )}
            </div>

            {/* Customer name */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Customer name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                maxLength={255}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${fieldErrors.customerName ? "border-destructive" : ""}`}
              />
              {fieldErrors.customerName && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.customerName}</p>
              )}
            </div>

            {/* Customer phone */}
            <div>
              <label className="mb-1 block text-sm font-medium">Customer phone (optional)</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="e.g. 081234567890"
                maxLength={50}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Customer ID number */}
            <div>
              <label className="mb-1 block text-sm font-medium">Customer ID number (optional)</label>
              <input
                type="text"
                value={customerIdNumber}
                onChange={(e) => setCustomerIdNumber(e.target.value)}
                placeholder="KTP / identity number"
                maxLength={100}
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
                maxLength={2000}
                placeholder="Any additional notes"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Unit rows */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Units to book
          </h2>
          <div className="space-y-3">
            {unitRows.map((row, idx) => (
              <div key={row.rowId} className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Unit {idx + 1}
                  </div>
                  <VinRowPicker
                    showroomId={showroom.id}
                    value={row.unit}
                    excludeIds={selectedIds.filter((id) => id !== row.unit?.id)}
                    conflict={row.conflict}
                    onSelect={(unit) => updateUnitRow(row.rowId, unit)}
                  />
                </div>
                {unitRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeUnitRow(row.rowId)}
                    className="mt-6 rounded-md border px-2 py-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {fieldErrors.units && (
            <p className="mt-2 text-sm text-destructive">{fieldErrors.units}</p>
          )}
          {unitRows.length < 20 && (
            <button
              type="button"
              onClick={addUnitRow}
              className="mt-3 text-sm text-primary hover:underline"
              data-tour="sms-order-add-unit"
            >
              + Add another unit
            </button>
          )}
        </div>

        {globalError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {globalError}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-3">
          <Link
            href="/admin/sms/orders"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || hasConflicts}
            data-tour="sms-orders-new"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Creating SPK…" : "Create SPK"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 md:p-6">
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="mx-auto max-w-2xl space-y-4">
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        </div>
      }
    >
      <NewOrderInner />
    </Suspense>
  );
}
