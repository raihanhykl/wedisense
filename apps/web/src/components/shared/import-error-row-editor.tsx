"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { AssetImportError, AssetImportRow } from "@/types/admin";

// All fields the user can touch in the inline editor. Grouped for layout.
// Keep keys in sync with apps/api/src/lib/excel.ts IMPORT_COLUMNS and the
// canonical-key list in import-column-mapping.tsx.
const EDITABLE_FIELDS: Array<{
  key: string;
  label: string;
  group: "core" | "metadata" | "new-product";
  inputType: "text" | "number" | "date" | "textarea" | "select";
  options?: string[];
  placeholder?: string;
  required?: boolean;
}> = [
  { key: "productId", label: "Product", group: "core", inputType: "text", placeholder: "Name, EAN, or UUID", required: true },
  { key: "name", label: "Asset Name", group: "core", inputType: "text", required: true },
  { key: "locationId", label: "Location", group: "core", inputType: "text", placeholder: "Name, code, or UUID", required: true },
  { key: "serialNumber", label: "Serial Number", group: "core", inputType: "text" },
  { key: "status", label: "Status", group: "core", inputType: "select", options: ["ACTIVE", "IDLE", "IN_MAINTENANCE", "DISPOSED", "LOST", "BORROWED"] },
  { key: "condition", label: "Condition", group: "core", inputType: "select", options: ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] },
  { key: "assignedToUserId", label: "Assigned To (User UUID)", group: "metadata", inputType: "text" },
  { key: "purchaseDate", label: "Purchase Date", group: "metadata", inputType: "date" },
  { key: "purchasePrice", label: "Purchase Price", group: "metadata", inputType: "number" },
  { key: "currency", label: "Currency", group: "metadata", inputType: "text", placeholder: "IDR" },
  { key: "vendor", label: "Vendor", group: "metadata", inputType: "text" },
  { key: "invoiceNumber", label: "Invoice Number", group: "metadata", inputType: "text" },
  { key: "warrantyStartDate", label: "Warranty Start", group: "metadata", inputType: "date" },
  { key: "warrantyEndDate", label: "Warranty End", group: "metadata", inputType: "date" },
  { key: "usefulLifeMonths", label: "Useful Life (months)", group: "metadata", inputType: "number" },
  { key: "notes", label: "Notes", group: "metadata", inputType: "textarea" },
  { key: "productCategory", label: "Product Category (for new product)", group: "new-product", inputType: "text" },
  { key: "productBrand", label: "Product Brand", group: "new-product", inputType: "text" },
  { key: "productModel", label: "Product Model", group: "new-product", inputType: "text" },
  { key: "productEan", label: "Product EAN", group: "new-product", inputType: "text" },
];

interface ImportErrorRowEditorProps {
  rowIndex: number;
  /** All errors that belong to this row (deduped — multiple errors per row
   *  carry the same rawValues snapshot, the editor only uses one copy). */
  errors: AssetImportError[];
  /**
   * Called with the newly-validated row when the user successfully
   * re-validates. Parent removes the entry from `errorRows` and adds the
   * `row` to `allValidatedRows`. If `null` is passed, the row is dropped
   * entirely (user discarded it).
   */
  onResolved: (row: AssetImportRow) => void;
  /** "Discard this row from the import" — parent removes from errorRows. */
  onDiscard: () => void;
}

export default function ImportErrorRowEditor({
  rowIndex,
  errors,
  onResolved,
  onDiscard,
}: ImportErrorRowEditorProps) {
  // All errors on the same row share rawValues; take the first non-empty
  // snapshot. Fallback to empty so the form still renders if the backend
  // didn't include rawValues for some reason (defensive — older API
  // versions, or errors with field='headers').
  const initialValues = useMemo<Record<string, string>>(() => {
    for (const e of errors) {
      if (e.rawValues) return e.rawValues;
    }
    return {};
  }, [errors]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [liveErrors, setLiveErrors] = useState<AssetImportError[]>(errors);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Quick lookup: field → error message (we surface inline next to inputs).
  const errorByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of liveErrors) {
      if (e.field && !map.has(e.field)) map.set(e.field, e.message);
    }
    return map;
  }, [liveErrors]);

  const setField = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    // Clear the inline error for this field eagerly so the user gets
    // immediate feedback that their edit is being acknowledged.
    setLiveErrors((prev) => prev.filter((e) => e.field !== key));
  };

  const handleRevalidate = async () => {
    setSubmitting(true);
    setPageError(null);
    try {
      const response = await apiPost<{ valid: true; row: AssetImportRow } | { valid: false; errors: AssetImportError[] }>(
        "/api/assets/import/revalidate-row",
        { rowIndex, values },
      );
      if (response.valid) {
        onResolved(response.row);
      } else {
        // Re-attach the row's current values so the live errors carry
        // rawValues for any follow-up edits.
        const enriched = response.errors.map((e) => ({ ...e, rawValues: values }));
        setLiveErrors(enriched);
      }
    } catch (err) {
      setPageError(getApiErrorMessage(err, "Re-validation failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const stillErrored = liveErrors.length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        stillErrored ? "border-red-200" : "border-green-200",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b p-3",
          stillErrored ? "border-red-200 bg-red-50/60" : "border-green-200 bg-green-50/60",
        )}
      >
        <div className="flex items-center gap-2">
          {stillErrored ? (
            <AlertCircle className="h-4 w-4 text-red-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          )}
          <span className="text-sm font-medium">
            Row {rowIndex}
          </span>
          {stillErrored && (
            <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700">
              {liveErrors.length} error{liveErrors.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          disabled={submitting}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Skip this row
        </button>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {EDITABLE_FIELDS.map((f) => {
          const value = values[f.key] ?? "";
          const fieldError = errorByField.get(f.key);
          const isErrored = !!fieldError;
          const isRequired = !!f.required;

          // For date inputs, ISO YYYY-MM-DD is the canonical native value.
          // Whatever the user typed in Excel might be a freeform string —
          // we preserve it verbatim, the backend handles parsing.
          return (
            <div
              key={f.key}
              className={cn(
                f.inputType === "textarea" && "sm:col-span-2",
              )}
            >
              <label
                htmlFor={`row-${rowIndex}-${f.key}`}
                className="mb-1 block text-xs font-medium"
              >
                {f.label}
                {isRequired && <span className="ml-1 text-red-500">*</span>}
              </label>

              {f.inputType === "textarea" ? (
                <textarea
                  id={`row-${rowIndex}-${f.key}`}
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  rows={2}
                  placeholder={f.placeholder}
                  className={cn(
                    "w-full rounded-md border bg-background px-2 py-1.5 text-xs",
                    isErrored && "border-red-300 bg-red-50/40",
                  )}
                />
              ) : f.inputType === "select" ? (
                <select
                  id={`row-${rowIndex}-${f.key}`}
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  className={cn(
                    "w-full rounded-md border bg-background px-2 py-1.5 text-xs",
                    isErrored && "border-red-300 bg-red-50/40",
                  )}
                >
                  <option value="">— Default —</option>
                  {f.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`row-${rowIndex}-${f.key}`}
                  type={f.inputType}
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={submitting}
                  placeholder={f.placeholder}
                  className={cn(
                    "w-full rounded-md border bg-background px-2 py-1.5 text-xs",
                    isErrored && "border-red-300 bg-red-50/40",
                  )}
                />
              )}

              {fieldError && (
                <p className="mt-1 text-xs text-red-600">{fieldError}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {pageError && (
            <span className="text-red-600">{pageError}</span>
          )}
          {!pageError && liveErrors.some((e) => !e.field || !EDITABLE_FIELDS.some((f) => f.key === e.field)) && (
            <span>
              Some errors aren&apos;t tied to a single column — re-validating
              applies your edits and re-runs all checks.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleRevalidate()}
          disabled={submitting}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Re-validating..." : "Save & re-validate"}
        </button>
      </div>
    </div>
  );
}
