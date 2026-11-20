"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { smsPost, smsPostForm, smsErrorMessage, newIdempotencyKey } from "@/lib/sms/client";
import { variantLabel, unitStatusLabel } from "@/lib/sms/labels";
import { useShowroom } from "@/components/sms/showroom-context";
import { ImportManifestColumnMapper } from "@/components/sms/import-manifest-column-mapper";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";
import type {
  InspectResponse,
  PreviewResponse,
  ConfirmResponse,
  ClassifiedCandidate,
  AmbiguousRow,
} from "@/lib/sms/shipments-types";
import type { VehicleVariantRow } from "@/lib/sms/types";

type Step = 1 | 2 | 3 | 4;

const COLUMN_MAPPING_STORAGE_KEY = "wedisense:import:column-mapping:sms-manifest";

function loadSavedMapping(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLUMN_MAPPING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v.length > 0) result[k] = v;
      }
      return Object.keys(result).length > 0 ? result : null;
    }
  } catch {
    try { window.localStorage.removeItem(COLUMN_MAPPING_STORAGE_KEY); } catch { /* noop */ }
  }
  return null;
}

function saveMapping(fieldToHeaderText: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(COLUMN_MAPPING_STORAGE_KEY, JSON.stringify(fieldToHeaderText)); }
  catch { /* noop */ }
}

function applyRememberedMapping(
  headers: string[],
  suggestedMapping: Record<string, number | null>,
): Record<string, number | null> {
  const saved = loadSavedMapping();
  if (!saved) return { ...suggestedMapping };
  const result: Record<string, number | null> = { ...suggestedMapping };
  for (const [field, headerText] of Object.entries(saved)) {
    const idx = headers.findIndex((h) => h === headerText);
    if (idx >= 0) result[field] = idx;
  }
  return result;
}

function StepIndicator({ current }: { current: Step }) {
  const steps: Array<{ n: Step; label: string }> = [
    { n: 1, label: "Source" },
    { n: 2, label: "Columns" },
    { n: 3, label: "Review" },
    { n: 4, label: "Done" },
  ];
  return (
    <div className="mb-6 flex items-center gap-0 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={s.n} className="flex shrink-0 items-center">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
              current === s.n
                ? "bg-primary text-primary-foreground"
                : current > s.n
                  ? "bg-emerald-500 text-white"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {current > s.n ? "✓" : s.n}
          </div>
          <span className={cn("ml-2 text-sm whitespace-nowrap", current === s.n ? "font-semibold" : "text-muted-foreground")}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="mx-3 h-px w-8 shrink-0 bg-muted" />}
        </div>
      ))}
    </div>
  );
}

export default function ImportManifestPage() {
  const { showroom, showrooms, canAt } = useShowroom();

  const receivingShowrooms = showrooms.filter((s) =>
    canAt(SMS_PERMISSIONS.RECEIVING_MANAGE, s.id),
  );

  // ── Step & source ───────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [sourceTab, setSourceTab] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [fileError, setFileError] = useState("");

  // ── Shipment meta (entered once, carried through wizard) ────────────
  const [destinationId, setDestinationId] = useState(showroom?.id ?? "");
  const [batchNumber, setBatchNumber] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");

  // ── Step 1 → 2 ──────────────────────────────────────────────────────
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [inspectResult, setInspectResult] = useState<InspectResponse | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [reInspecting, setReInspecting] = useState(false);

  // ── Step 2 → 3 ──────────────────────────────────────────────────────
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null);

  // Per-new-candidate: variantId override (optional)
  const [variantOverrides, setVariantOverrides] = useState<Record<string, string | null>>({});
  // Per-new-candidate: conflict resolution { [vin]: { [field]: chosenValue } }
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, Record<string, string>>
  >({});
  // Per-ambiguous-row: { skip: boolean; vin: string }
  const [ambiguousDecisions, setAmbiguousDecisions] = useState<
    Record<number, { skip: boolean; vin: string }>
  >({});

  // ── Step 3 → 4 ──────────────────────────────────────────────────────
  const [confirmIdKey] = useState(() => newIdempotencyKey());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null);

  // ── Variant master (for pickers in Step 3) ───────────────────────────
  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);
  useEffect(() => {
    if (step >= 3) {
      apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants")
        .then(setVariants)
        .catch(() => {/* non-critical */});
    }
  }, [step]);

  // ── Inspect helpers ──────────────────────────────────────────────────
  async function doInspect(sheetName?: string): Promise<InspectResponse | null> {
    if (sourceTab === "file") {
      if (!file) { setFileError("Please select a file."); return null; }
      const fd = new FormData();
      fd.append("file", file);
      const url = sheetName
        ? `/api/sms/shipments/import/inspect?sheetName=${encodeURIComponent(sheetName)}`
        : "/api/sms/shipments/import/inspect";
      return smsPostForm<InspectResponse>(url, fd);
    } else {
      if (!pastedText.trim()) { setInspectError("Please paste some text."); return null; }
      const res = await api.post<{ success: boolean; data: InspectResponse }>(
        "/api/sms/shipments/import/inspect",
        { text: pastedText, sheetName },
      );
      return res.data.data;
    }
  }

  // ── Validate step 1 fields ───────────────────────────────────────────
  function step1Valid(): boolean {
    if (sourceTab === "file" && !file) { setFileError("Please select a file."); return false; }
    if (sourceTab === "text" && !pastedText.trim()) { setInspectError("Please paste text from Excel."); return false; }
    if (!destinationId) { setInspectError("Please select a destination showroom."); return false; }
    if (!batchNumber.trim()) { setInspectError("Batch number is required."); return false; }
    return true;
  }

  // ── Handle Step 1 → Step 2 ───────────────────────────────────────────
  const handleInspect = async () => {
    setFileError(""); setInspectError("");
    if (!step1Valid()) return;
    setInspecting(true);
    try {
      const result = await doInspect();
      if (!result) return;
      setInspectResult(result);
      setSelectedSheet(result.sheet.name);
      const m = applyRememberedMapping(result.sheet.headers, result.sheet.suggestedMapping);
      setMapping(m);
      setStep(2);
    } catch (err) {
      setInspectError(smsErrorMessage(err, "Failed to read the source. Please check the file format."));
    } finally {
      setInspecting(false);
    }
  };

  // ── Handle sheet change (re-inspect) ────────────────────────────────
  const handleSheetChange = async (newSheet: string) => {
    if (!inspectResult) return;
    setReInspecting(true);
    try {
      const result = await doInspect(newSheet);
      if (!result) return;
      setInspectResult(result);
      setSelectedSheet(newSheet);
      const m = applyRememberedMapping(result.sheet.headers, result.sheet.suggestedMapping);
      setMapping(m);
    } catch (err) {
      setInspectError(smsErrorMessage(err, "Failed to re-inspect with the selected sheet."));
    } finally {
      setReInspecting(false);
    }
  };

  // ── Handle Step 2 → Step 3 ───────────────────────────────────────────
  const handlePreview = async () => {
    if (!inspectResult) return;
    setPreviewError("");
    if (mapping["vin"] === undefined || mapping["vin"] === null) {
      setPreviewError("VIN column mapping is required.");
      return;
    }
    setPreviewing(true);
    try {
      const options = {
        sheetName: selectedSheet,
        headerRowIndex: inspectResult.sheet.headerRowIndex,
        mapping,
        destinationLocationId: destinationId,
        batchNumber: batchNumber.trim(),
        deliveryNoteNumber: deliveryNote.trim() || undefined,
      };
      let result: PreviewResponse;
      if (sourceTab === "file" && file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("options", JSON.stringify(options));
        result = await smsPostForm<PreviewResponse>("/api/sms/shipments/import/preview", fd);
      } else {
        const res = await api.post<{ success: boolean; data: PreviewResponse }>(
          "/api/sms/shipments/import/preview",
          { text: pastedText, options },
        );
        result = res.data.data;
      }
      setPreviewResult(result);
      // Save mapping to localStorage (fieldName → headerText)
      const toSave: Record<string, string> = {};
      for (const [field, colIdx] of Object.entries(mapping)) {
        if (colIdx !== null && inspectResult.sheet.headers[colIdx]) {
          toSave[field] = inspectResult.sheet.headers[colIdx]!;
        }
      }
      saveMapping(toSave);
      // Initialize ambiguous decisions (all skip by default)
      const decisions: Record<number, { skip: boolean; vin: string }> = {};
      for (const r of result.ambiguousRows) {
        decisions[r.row] = {
          skip: true,
          vin: r.rawValues["vin"] ?? r.rawValues["nomor rangka"] ?? "",
        };
      }
      setAmbiguousDecisions(decisions);
      setConflictResolutions({});
      setVariantOverrides({});
      setStep(3);
    } catch (err) {
      setPreviewError(smsErrorMessage(err, "Failed to preview the manifest."));
    } finally {
      setPreviewing(false);
    }
  };

  // ── Build confirm lines ──────────────────────────────────────────────
  function buildLines() {
    if (!previewResult) return [];
    const lines = [];
    // New candidates
    for (const c of previewResult.candidates) {
      if (c.classification !== "NEW") continue;
      const resolved = conflictResolutions[c.vin] ?? {};
      lines.push({
        vin: c.vin,
        engineNumber: (resolved["engineNumber"] ?? c.engineNumber) ?? undefined,
        variantId: (variantOverrides[c.vin] ?? c.variantId) ?? undefined,
        rawModel: (resolved["model"] ?? c.model) ?? undefined,
        rawVariant: (resolved["variant"] ?? c.variant) ?? undefined,
        rawColor: (resolved["color"] ?? c.color) ?? undefined,
        sourceRows: c.sourceRows,
      });
    }
    // Ambiguous rows the admin chose to include
    for (const r of previewResult.ambiguousRows) {
      const dec = ambiguousDecisions[r.row];
      if (!dec || dec.skip) continue;
      if (!dec.vin.trim()) continue;
      lines.push({
        vin: dec.vin.trim().toUpperCase(),
        sourceRows: [{ row: r.row, values: r.rawValues }],
      });
    }
    return lines;
  }

  // ── Handle Step 3 → Step 4 ───────────────────────────────────────────
  const handleConfirm = async () => {
    if (!previewResult) return;
    setConfirmError("");
    const lines = buildLines();
    if (lines.length === 0) {
      setConfirmError("There are no VINs to add. Add at least one new VIN to continue.");
      return;
    }
    setConfirming(true);
    try {
      const result = await smsPost<ConfirmResponse>(
        "/api/sms/shipments/import/confirm",
        {
          destinationLocationId: destinationId,
          batchNumber: batchNumber.trim(),
          deliveryNoteNumber: deliveryNote.trim() || undefined,
          dispatchDate: dispatchDate || undefined,
          sourceFileName: file?.name,
          lines,
        },
        confirmIdKey,
      );
      setConfirmResult(result);
      setStep(4);
    } catch (err) {
      setConfirmError(smsErrorMessage(err, "Failed to confirm the manifest. Please try again."));
    } finally {
      setConfirming(false);
    }
  };

  if (receivingShowrooms.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <h2 className="text-base font-semibold text-amber-800">Permission required</h2>
          <p className="mt-2 text-sm text-amber-700">
            You need the Receiving Manage permission at a showroom to import a manifest.
          </p>
          <Link href="/admin/sms/shipments" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to shipments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6" data-tour="sms-import-manifest-page">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Import manifest</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload a factory manifest or paste from Excel to build the expected list for a batch.
          </p>
        </div>
        <Link href="/admin/sms/shipments" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">
          Back
        </Link>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Source ── */}
      {step === 1 && (
        <div className="max-w-xl space-y-5">
          {/* Shipment fields */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold">Shipment details</h2>
            {/* Destination */}
            <div>
              <label className="text-sm font-medium">
                Destination showroom <span className="text-destructive">*</span>
              </label>
              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— select showroom —</option>
                {receivingShowrooms.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {/* Batch number */}
            <div>
              <label className="text-sm font-medium">
                Batch number <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. BATCH-2026-001"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {/* Delivery note */}
            <div>
              <label className="text-sm font-medium">Delivery note number (optional)</label>
              <input
                type="text"
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {/* Dispatch date */}
            <div>
              <label className="text-sm font-medium">Dispatch date (optional)</label>
              <input
                type="date"
                value={dispatchDate}
                onChange={(e) => setDispatchDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Source */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold">Manifest source</h2>
            {/* Tabs */}
            <div className="inline-flex rounded-md border bg-muted p-0.5">
              {(["file", "text"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setSourceTab(t); setFileError(""); setInspectError(""); }}
                  className={cn(
                    "rounded-sm px-4 py-1.5 text-sm font-medium",
                    sourceTab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "file" ? "Upload file" : "Paste from Excel"}
                </button>
              ))}
            </div>

            {sourceTab === "file" && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Accepts .xlsx, .xls, or .csv files up to 10 MB.
                </p>
                <div
                  data-tour="sms-import-upload"
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors",
                    file ? "border-primary bg-primary/5" : "border-muted-foreground/30",
                    fileError && "border-destructive",
                  )}
                  onClick={() => document.getElementById("manifest-file-input")?.click()}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dropped = e.dataTransfer.files[0];
                    if (dropped) {
                      setFile(dropped);
                      setFileError("");
                    }
                  }}
                >
                  <input
                    id="manifest-file-input"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      setFileError("");
                    }}
                  />
                  {file ? (
                    <>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB · Click to change
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Drop a file here or click to browse</p>
                      <p className="mt-1 text-xs text-muted-foreground">.xlsx · .xls · .csv</p>
                    </>
                  )}
                </div>
                {fileError && <p className="mt-1 text-xs text-destructive">{fileError}</p>}
              </div>
            )}

            {sourceTab === "text" && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Copy the rows in Excel including the header row, then paste here.
                </p>
                <textarea
                  value={pastedText}
                  onChange={(e) => { setPastedText(e.target.value); setInspectError(""); }}
                  rows={8}
                  placeholder="Paste your Excel data here…"
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          {inspectError && <p className="text-sm text-destructive">{inspectError}</p>}

          <button
            type="button"
            onClick={() => void handleInspect()}
            disabled={inspecting}
            data-tour="sms-import-next-columns"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {inspecting ? "Reading…" : "Next: map columns →"}
          </button>
        </div>
      )}

      {/* ── Step 2: Sheet & column mapping ── */}
      {step === 2 && inspectResult && (
        <div className="max-w-2xl space-y-5">
          {/* Sheet picker */}
          {inspectResult.sheets.length > 1 && (
            <div>
              <label className="text-sm font-medium">Sheet</label>
              <select
                value={selectedSheet}
                onChange={(e) => void handleSheetChange(e.target.value)}
                disabled={reInspecting}
                className="mt-1 block w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {inspectResult.sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.rowCount} rows)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Summary of detected headers */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{inspectResult.sheet.headers.length}</span> columns detected ·{" "}
              <span className="font-medium">{inspectResult.sheet.sampleRows.length}</span> sample rows
            </p>
          </div>

          <ImportManifestColumnMapper
            headers={inspectResult.sheet.headers}
            suggestedMapping={inspectResult.sheet.suggestedMapping}
            currentMapping={mapping}
            sampleRows={inspectResult.sheet.sampleRows}
            onChange={setMapping}
          />

          {previewError && <p className="text-sm text-destructive">{previewError}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setStep(1); setPreviewError(""); }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={previewing || reInspecting}
              data-tour="sms-import-next-review"
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {previewing ? "Previewing…" : "Next: review →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === 3 && previewResult && (
        <div className="max-w-3xl space-y-6">
          <p className="text-xs text-muted-foreground">
            Nothing is saved yet — review the manifest below, then click Confirm to create the expected list.
          </p>

          {/* Summary strip */}
          <div className="flex flex-wrap gap-3">
            {[
              { label: "New", value: previewResult.summary.newCount, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
              { label: "Already in this batch", value: previewResult.summary.alreadyInShipment, color: "text-blue-700 bg-blue-50 border-blue-200" },
              { label: "In another batch", value: previewResult.summary.inOtherShipment, color: "text-amber-700 bg-amber-50 border-amber-200" },
              { label: "Already received", value: previewResult.summary.alreadyReceived, color: "text-slate-700 bg-slate-50 border-slate-200" },
              { label: "Ambiguous", value: previewResult.summary.ambiguous, color: "text-orange-700 bg-orange-50 border-orange-200" },
              { label: "Components skipped", value: previewResult.summary.skippedComponents, color: "text-slate-600 bg-slate-50 border-slate-200" },
            ].map((s) => (
              <div key={s.label} className={cn("rounded-md border px-3 py-2", s.color)}>
                <p className="text-xs">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Existing shipment notice */}
          {previewResult.existingShipment && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Batch <span className="font-medium">{previewResult.existingShipment.batchNumber}</span> already
              exists with {previewResult.existingShipment.counts.expected} units.
              New VINs will be added to it.
            </div>
          )}

          {/* New VINs */}
          {previewResult.candidates.filter((c) => c.classification === "NEW").length > 0 && (
            <NewCandidatesSection
              candidates={previewResult.candidates.filter((c) => c.classification === "NEW")}
              variants={variants}
              variantOverrides={variantOverrides}
              conflictResolutions={conflictResolutions}
              onVariantChange={(vin, vid) =>
                setVariantOverrides((prev) => ({ ...prev, [vin]: vid }))
              }
              onConflictResolve={(vin, field, value) =>
                setConflictResolutions((prev) => ({
                  ...prev,
                  [vin]: { ...(prev[vin] ?? {}), [field]: value },
                }))
              }
            />
          )}

          {/* Conflicts */}
          {previewResult.candidates.some((c) => c.classification === "NEW" && (c.conflicts?.length ?? 0) > 0) && null /* handled inside NewCandidatesSection */}

          {/* Ambiguous rows */}
          {previewResult.ambiguousRows.length > 0 && (
            <AmbiguousRowsSection
              rows={previewResult.ambiguousRows}
              decisions={ambiguousDecisions}
              onChange={(row, dec) =>
                setAmbiguousDecisions((prev) => ({ ...prev, [row]: dec }))
              }
            />
          )}

          {/* Already-listed / in other shipment / already received */}
          {previewResult.candidates.some(
            (c) =>
              c.classification === "ALREADY_IN_THIS_SHIPMENT" ||
              c.classification === "IN_OTHER_SHIPMENT" ||
              c.classification === "ALREADY_RECEIVED",
          ) && (
            <AlreadyListedSection
              candidates={previewResult.candidates.filter(
                (c) => c.classification !== "NEW",
              )}
            />
          )}

          {/* Unmatched variants */}
          {previewResult.unmatchedVariants.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">
                {previewResult.unmatchedVariants.length} unmatched variant
                {previewResult.unmatchedVariants.length === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs text-amber-700">
                These model/variant/colour combinations are not in the product master. You can
                assign the correct variant at receiving time. The product master is maintained
                by central operations.
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                {previewResult.unmatchedVariants.map((v, i) => (
                  <li key={i}>
                    {[v.rawModel, v.rawVariant, v.rawColor].filter(Boolean).join(" · ")} —{" "}
                    {v.count} unit{v.count === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => { setStep(2); setConfirmError(""); }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              ← Back
            </button>
            <button
              type="button"
              data-tour="sms-import-confirm"
              onClick={() => void handleConfirm()}
              disabled={confirming || buildLines().length === 0}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {confirming
                ? "Confirming…"
                : `Confirm — add ${buildLines().length} VIN${buildLines().length === 1 ? "" : "s"} to batch`}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === 4 && confirmResult && (
        <div className="max-w-lg space-y-5">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-3 text-base font-semibold">Manifest imported</h2>
            <p className="text-2xl font-bold text-emerald-600">
              {confirmResult.createdCount} VIN{confirmResult.createdCount === 1 ? "" : "s"} added
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Batch: <span className="font-medium">{confirmResult.shipment.batchNumber}</span>
              {confirmResult.shipment.deliveryNoteNumber && ` · DN: ${confirmResult.shipment.deliveryNoteNumber}`}
            </p>
          </div>

          {confirmResult.skipped.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-card p-4">
              <p className="mb-2 text-sm font-medium text-muted-foreground">
                Skipped ({confirmResult.skipped.length})
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {confirmResult.skipped.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono">{s.vin}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Link
              href={`/admin/sms/shipments/${confirmResult.shipment.id}`}
              data-tour="sms-import-go-receiving"
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Go to receiving →
            </Link>
            <Link
              href="/admin/sms/shipments"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              All shipments
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components for Step 3 ──────────────────────────────────────────────

function NewCandidatesSection({
  candidates,
  variants,
  variantOverrides,
  conflictResolutions,
  onVariantChange,
  onConflictResolve,
}: {
  candidates: ClassifiedCandidate[];
  variants: VehicleVariantRow[];
  variantOverrides: Record<string, string | null>;
  conflictResolutions: Record<string, Record<string, string>>;
  onVariantChange: (vin: string, variantId: string | null) => void;
  onConflictResolve: (vin: string, field: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? candidates : candidates.slice(0, 10);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-emerald-700">
        New VINs to add ({candidates.length})
      </h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-emerald-50">
              <th className="px-3 py-2 text-left font-medium">VIN</th>
              <th className="px-3 py-2 text-left font-medium">Engine</th>
              <th className="px-3 py-2 text-left font-medium">Model / Variant / Colour</th>
              <th className="px-3 py-2 text-left font-medium">Matched variant</th>
              <th className="px-3 py-2 text-left font-medium">Rows</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((c) => (
              <CandidateRow
                key={c.vin}
                candidate={c}
                variants={variants}
                variantOverride={variantOverrides[c.vin] ?? null}
                conflictResolution={conflictResolutions[c.vin] ?? {}}
                onVariantChange={(vid) => onVariantChange(c.vin, vid)}
                onConflictResolve={(field, val) => onConflictResolve(c.vin, field, val)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {candidates.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-xs text-primary hover:underline"
        >
          {expanded ? "Show fewer" : `Show ${candidates.length - 10} more`}
        </button>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  variants,
  variantOverride,
  conflictResolution,
  onVariantChange,
  onConflictResolve,
}: {
  candidate: ClassifiedCandidate;
  variants: VehicleVariantRow[];
  variantOverride: string | null;
  conflictResolution: Record<string, string>;
  onVariantChange: (variantId: string | null) => void;
  onConflictResolve: (field: string, value: string) => void;
}) {
  const [showSourceRows, setShowSourceRows] = useState(false);
  const hasConflicts = (candidate.conflicts?.length ?? 0) > 0;
  const resolvedVariantId = variantOverride ?? candidate.variantId;

  return (
    <>
      <tr className={hasConflicts ? "bg-amber-50/40" : undefined}>
        <td className="px-3 py-2 font-mono break-all min-w-[180px]">{candidate.vin}</td>
        <td className="px-3 py-2 font-mono text-muted-foreground">{candidate.engineNumber ?? "—"}</td>
        <td className="px-3 py-2 text-muted-foreground">
          {[candidate.model, candidate.variant, candidate.color].filter(Boolean).join(" · ") || "—"}
        </td>
        <td className="px-3 py-2 min-w-[180px]">
          {candidate.variantId && !variantOverride ? (
            <span className="text-xs">{variants.find((v) => v.id === candidate.variantId) ? variantLabel(variants.find((v) => v.id === candidate.variantId)!) : candidate.variantId}</span>
          ) : (
            <select
              value={resolvedVariantId ?? ""}
              onChange={(e) => onVariantChange(e.target.value || null)}
              className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— optional —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.model.name} · {v.name} · {v.color}
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setShowSourceRows((x) => !x)}
            className="text-xs text-primary hover:underline"
          >
            {candidate.sourceRows.length} row{candidate.sourceRows.length === 1 ? "" : "s"}
          </button>
        </td>
      </tr>

      {/* Conflict resolution */}
      {hasConflicts && (
        <tr className="bg-amber-50/60">
          <td colSpan={5} className="px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-amber-800">
              Conflicting values — select which to use:
            </p>
            <div className="space-y-1.5">
              {candidate.conflicts!.map((conflict) => (
                <div key={conflict.field} className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-medium text-amber-700 w-20">{conflict.field}:</span>
                  {conflict.values.map((val) => (
                    <label key={val} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name={`${candidate.vin}-${conflict.field}`}
                        value={val}
                        checked={(conflictResolution[conflict.field] ?? conflict.values[0]) === val}
                        onChange={() => onConflictResolve(conflict.field, val)}
                        className="h-3 w-3"
                      />
                      <span className="text-xs font-mono">{val}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}

      {/* Source rows */}
      {showSourceRows && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-3 py-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Source rows:</p>
            <div className="space-y-1">
              {candidate.sourceRows.map((sr) => (
                <p key={sr.row} className="text-xs font-mono text-muted-foreground">
                  Row {sr.row}: {Object.entries(sr.values).map(([k, v]) => `${k}=${v}`).join(", ")}
                </p>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AmbiguousRowsSection({
  rows,
  decisions,
  onChange,
}: {
  rows: AmbiguousRow[];
  decisions: Record<number, { skip: boolean; vin: string }>;
  onChange: (row: number, dec: { skip: boolean; vin: string }) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-orange-700">
        Ambiguous rows ({rows.length})
      </h3>
      <div className="space-y-3">
        {rows.map((r) => {
          const dec = decisions[r.row] ?? { skip: true, vin: "" };
          return (
            <div key={r.row} className="rounded-lg border border-orange-200 bg-orange-50/40 p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-orange-800">Row {r.row}: {r.reason}</p>
                  <p className="mt-0.5 font-mono text-muted-foreground">
                    {Object.entries(r.rawValues)
                      .slice(0, 5)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`ambig-${r.row}`}
                      checked={dec.skip}
                      onChange={() => onChange(r.row, { ...dec, skip: true })}
                      className="h-3 w-3"
                    />
                    <span>Skip</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`ambig-${r.row}`}
                      checked={!dec.skip}
                      onChange={() => onChange(r.row, { ...dec, skip: false })}
                      className="h-3 w-3"
                    />
                    <span>Add as motorcycle</span>
                  </label>
                </div>
              </div>
              {!dec.skip && (
                <div className="mt-2">
                  <label className="text-xs text-muted-foreground">VIN to use:</label>
                  <input
                    type="text"
                    value={dec.vin}
                    onChange={(e) => onChange(r.row, { ...dec, vin: e.target.value.toUpperCase() })}
                    placeholder="Enter or confirm the VIN"
                    className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlreadyListedSection({ candidates }: { candidates: ClassifiedCandidate[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? candidates : candidates.slice(0, 5);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
        Already listed / received ({candidates.length})
      </h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2 text-left font-medium">VIN</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Where</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((c) => (
              <tr key={c.vin}>
                <td className="px-3 py-2 font-mono break-all">{c.vin}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {c.classification === "ALREADY_IN_THIS_SHIPMENT" && "In this batch"}
                  {c.classification === "IN_OTHER_SHIPMENT" && "In another batch"}
                  {c.classification === "ALREADY_RECEIVED" && "Already received"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {c.otherShipment
                    ? `${c.otherShipment.batchNumber} → ${c.otherShipment.destinationName}`
                    : c.existingUnit
                      ? unitStatusLabel(c.existingUnit.status)
                      : "At a showroom you cannot see"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {candidates.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-xs text-primary hover:underline"
        >
          {expanded ? "Show fewer" : `Show ${candidates.length - 5} more`}
        </button>
      )}
    </div>
  );
}
