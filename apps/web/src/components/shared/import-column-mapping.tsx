"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetImportDetectedMapping } from "@/types/admin";

// ── Canonical field catalog ─────────────────────────────────────────
// Order is fixed: required first, then frequently-used asset fields,
// then product-creation fields. This matches the visual order in the
// downloaded template so users mapping a file feel oriented.
//
// Keep this list in sync with IMPORT_COLUMNS in apps/api/src/lib/excel.ts —
// they enumerate the same canonical keys.
export const CANONICAL_IMPORT_FIELDS: Array<{
  key: string;
  label: string;
  required: boolean;
  group: "core" | "metadata" | "new-product";
}> = [
  { key: "productId", label: "Product", required: true, group: "core" },
  { key: "name", label: "Name", required: true, group: "core" },
  { key: "locationId", label: "Location", required: true, group: "core" },
  { key: "serialNumber", label: "Serial Number", required: false, group: "core" },
  { key: "status", label: "Status", required: false, group: "metadata" },
  { key: "condition", label: "Condition", required: false, group: "metadata" },
  { key: "assignedToUserId", label: "Assigned To (User ID)", required: false, group: "metadata" },
  { key: "purchaseDate", label: "Purchase Date", required: false, group: "metadata" },
  { key: "purchasePrice", label: "Purchase Price", required: false, group: "metadata" },
  { key: "currency", label: "Currency", required: false, group: "metadata" },
  { key: "vendor", label: "Vendor", required: false, group: "metadata" },
  { key: "invoiceNumber", label: "Invoice Number", required: false, group: "metadata" },
  { key: "warrantyStartDate", label: "Warranty Start Date", required: false, group: "metadata" },
  { key: "warrantyEndDate", label: "Warranty End Date", required: false, group: "metadata" },
  { key: "usefulLifeMonths", label: "Useful Life (months)", required: false, group: "metadata" },
  { key: "notes", label: "Notes", required: false, group: "metadata" },
  { key: "productCategory", label: "Product Category", required: false, group: "new-product" },
  { key: "productBrand", label: "Product Brand", required: false, group: "new-product" },
  { key: "productModel", label: "Product Model", required: false, group: "new-product" },
  { key: "productEan", label: "Product EAN", required: false, group: "new-product" },
];

interface ColumnMappingPanelProps {
  /** Detected mapping from the backend. */
  detected: AssetImportDetectedMapping;
  /** Whether re-apply is currently running (disables interactions). */
  busy: boolean;
  /**
   * Called when the user clicks "Apply mapping". Value is a partial map of
   * canonical key → selected header text (omits unmapped fields). The
   * caller is responsible for re-uploading the file with this override.
   */
  onApply: (override: Record<string, string>) => void;
  /** Reset to backend's automatic detection (re-upload with no override). */
  onReset: () => void;
}

function sourceLabel(source: "exact" | "synonym" | "manual"): string {
  if (source === "exact") return "Exact match";
  if (source === "synonym") return "Auto-matched";
  return "Manual";
}

function sourceBadgeClass(source: "exact" | "synonym" | "manual"): string {
  if (source === "exact") return "bg-green-100 text-green-700";
  if (source === "synonym") return "bg-blue-100 text-blue-700";
  return "bg-purple-100 text-purple-700";
}

export default function ColumnMappingPanel({
  detected,
  busy,
  onApply,
  onReset,
}: ColumnMappingPanelProps) {
  // Local working copy keyed by canonical → header text. Empty string means
  // "(none — skip this field)". Initialised from the backend's detection
  // so the panel can be tweaked without immediately mutating parent state.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [key, item] of Object.entries(detected.mapping)) {
      if (item) initial[key] = item.actualHeader;
    }
    return initial;
  });

  // Auto-expand whenever the backend flagged anything non-trivial (a
  // synonym match, a manual override, or a missing required field) — those
  // are exactly the situations where the user needs to glance at the table
  // and confirm. Pure-exact files get a collapsed panel by default.
  const hasNonExact = useMemo(() => {
    if (detected.requiredMissing.length > 0) return true;
    return Object.values(detected.mapping).some((m) => m && m.source !== "exact");
  }, [detected]);

  const [expanded, setExpanded] = useState(hasNonExact);

  // Counters drive the collapsed-header summary so the user knows whether
  // they should expand.
  const counts = useMemo(() => {
    let exact = 0;
    let synonym = 0;
    let manual = 0;
    for (const item of Object.values(detected.mapping)) {
      if (!item) continue;
      if (item.source === "exact") exact++;
      else if (item.source === "synonym") synonym++;
      else manual++;
    }
    return { exact, synonym, manual, missing: detected.requiredMissing.length };
  }, [detected]);

  const dirty = useMemo(() => {
    // Build a normalised representation of the backend's mapping so we can
    // compare against the local draft.
    const backendNormalised: Record<string, string> = {};
    for (const [key, item] of Object.entries(detected.mapping)) {
      if (item) backendNormalised[key] = item.actualHeader;
    }
    const draftKeys = Object.keys(draft).filter((k) => draft[k]);
    const backendKeys = Object.keys(backendNormalised);
    if (draftKeys.length !== backendKeys.length) return true;
    return draftKeys.some((k) => draft[k] !== backendNormalised[k]);
  }, [draft, detected]);

  const stillMissing = useMemo(() => {
    return CANONICAL_IMPORT_FIELDS
      .filter((f) => f.required)
      .filter((f) => !draft[f.key] || draft[f.key]!.length === 0);
  }, [draft]);

  const applyDraft = () => {
    // Strip empty selections — the backend treats "absent" the same way.
    const cleaned: Record<string, string> = {};
    for (const [key, header] of Object.entries(draft)) {
      if (header) cleaned[key] = header;
    }
    onApply(cleaned);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* ── Header / summary ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/40"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              counts.missing > 0
                ? "bg-red-100 text-red-600"
                : counts.synonym > 0 || counts.manual > 0
                  ? "bg-blue-100 text-blue-600"
                  : "bg-green-100 text-green-700",
            )}
          >
            {counts.missing > 0 ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold">Column Mapping</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {counts.missing > 0 ? (
                <>
                  <span className="font-medium text-red-600">
                    {counts.missing} required column{counts.missing === 1 ? "" : "s"} missing
                  </span>
                  {" — review below to pick the right column"}
                </>
              ) : counts.synonym > 0 || counts.manual > 0 ? (
                <>
                  {counts.exact} exact, {counts.synonym} auto-matched
                  {counts.manual > 0 ? `, ${counts.manual} manual` : ""}
                  {" — review to confirm"}
                </>
              ) : (
                <>All {counts.exact} columns matched the template exactly</>
              )}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t">
          {/* ── Mapping table ─────────────────────────────────────── */}
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium">System Field</th>
                  <th className="px-4 py-2 text-left font-medium">Source</th>
                  <th className="px-4 py-2 text-left font-medium">Your Column</th>
                </tr>
              </thead>
              <tbody>
                {CANONICAL_IMPORT_FIELDS.map((field) => {
                  const detectedItem = detected.mapping[field.key];
                  const currentValue = draft[field.key] ?? "";
                  const isMissing = field.required && !currentValue;
                  const isManual =
                    detectedItem && currentValue !== detectedItem.actualHeader;
                  const source = isManual ? "manual" : detectedItem?.source;
                  return (
                    <tr
                      key={field.key}
                      className={cn(
                        "border-b last:border-b-0",
                        isMissing && "bg-red-50",
                      )}
                    >
                      <td className="px-4 py-2">
                        <span className="font-medium">{field.label}</span>
                        {field.required && (
                          <span className="ml-1 text-red-500" aria-label="required">
                            *
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {source ? (
                          <span
                            className={cn(
                              "inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                              sourceBadgeClass(source),
                            )}
                          >
                            {sourceLabel(source)}
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {isMissing ? "Missing" : "Not mapped"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={currentValue}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          disabled={busy}
                          className={cn(
                            "w-full rounded-md border bg-background px-2 py-1 text-xs",
                            isMissing && "border-red-300",
                          )}
                        >
                          <option value="">— Not in file —</option>
                          {detected.headers.map((h) => (
                            <option key={h.columnNumber} value={h.text}>
                              {h.text}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Actions ──────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {stillMissing.length > 0 ? (
                <span className="text-red-600">
                  Required missing:{" "}
                  {stillMissing.map((f) => f.label).join(", ")}
                </span>
              ) : (
                <span>{Object.keys(draft).filter((k) => draft[k]).length} fields mapped</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onReset}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to auto-detected
              </button>
              <button
                type="button"
                onClick={applyDraft}
                disabled={busy || !dirty || stillMissing.length > 0}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Re-validating..." : "Apply & re-validate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
