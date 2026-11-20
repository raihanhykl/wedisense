"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import api, { apiGetBlob, apiGet } from "@/lib/api";
import {
  smsPost,
  smsPostForm,
  smsErrorMessage,
  newIdempotencyKey,
  toSmsError,
} from "@/lib/sms/client";
import {
  UNIT_STATUS_STYLE,
  variantLabel,
  formatBusinessDate,
  todayInputValue,
} from "@/lib/sms/labels";
import { useShowroom } from "@/components/sms/showroom-context";
import { OpeningBalanceColumnMapper } from "@/components/sms/opening-balance-column-mapper";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import { cn } from "@/lib/utils";
import type {
  ObInspectResponse,
  ObPreviewResponse,
  ObPreviewRow,
  ObConfirmBody,
  ObConfirmRow,
  ObConfirmResponse,
  ObConfirmRowError,
  ObState,
} from "@/lib/sms/opening-balance-types";
import { isObConfirmRowError } from "@/lib/sms/opening-balance-types";
import type { VehicleVariantRow } from "@/lib/sms/types";

type Step = 1 | 2 | 3 | 4;
type RowFilter = "all" | "errors" | "warnings";

const COLUMN_MAPPING_KEY = "wedisense:import:column-mapping:sms-opening-balance";

// ── LocalStorage helpers ───────────────────────────────────────────────────────

function loadSavedMapping(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLUMN_MAPPING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof v === "string" && v.length > 0) result[k] = v;
      }
      return Object.keys(result).length > 0 ? result : null;
    }
  } catch {
    try {
      window.localStorage.removeItem(COLUMN_MAPPING_KEY);
    } catch {
      /* noop */
    }
  }
  return null;
}

function saveMapping(fieldToHeaderText: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COLUMN_MAPPING_KEY,
      JSON.stringify(fieldToHeaderText),
    );
  } catch {
    /* noop */
  }
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

// ── Step indicator ─────────────────────────────────────────────────────────────

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
          <span
            className={cn(
              "ml-2 whitespace-nowrap text-sm",
              current === s.n ? "font-semibold" : "text-muted-foreground",
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div className="mx-3 h-px w-8 shrink-0 bg-muted" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── State label (readable) ─────────────────────────────────────────────────────

const OB_STATE_LABEL: Record<ObState, string> = {
  AVAILABLE: "Ready",
  BOOKED: "Booked",
  SOLD_PENDING_PICKUP: "Sold · awaiting pickup",
  ACTIVE_RTO: "Active RTO",
  INSPECTION: "Inspection",
  SHOW_UNIT: "Out at event",
  CUSTODY: "In custody",
};

function obStateLabel(state: ObState | null): string {
  if (!state) return "Unknown";
  return OB_STATE_LABEL[state] ?? state;
}

function obStateStyle(state: ObState | null): string {
  if (!state) return "bg-slate-100 text-slate-700";
  // Every opening-balance state is also a unit status.
  return UNIT_STATUS_STYLE[state];
}

// ── Condensed state-specific field display ─────────────────────────────────────

function StateDetails({ row }: { row: ObPreviewRow }) {
  const parts: string[] = [];

  if (row.state === "BOOKED" || row.state === "SOLD_PENDING_PICKUP") {
    if (row.spkNumber) parts.push(`SPK: ${row.spkNumber}`);
    if (row.customerName) parts.push(`Customer: ${row.customerName}`);
    if (row.customerPhone) parts.push(row.customerPhone);
  }

  if (row.state === "ACTIVE_RTO" || row.state === "CUSTODY") {
    if (row.contractNumber) parts.push(`Contract: ${row.contractNumber}`);
    if (row.contractStartDate)
      parts.push(`Start: ${formatBusinessDate(row.contractStartDate)}`);
    if (row.customerName) parts.push(`Customer: ${row.customerName}`);
  }

  if (row.state === "SHOW_UNIT") {
    if (row.eventName) parts.push(row.eventName);
    if (row.eventLocation) parts.push(`@ ${row.eventLocation}`);
    if (row.expectedReturnDate)
      parts.push(`Return: ${formatBusinessDate(row.expectedReturnDate)}`);
  }

  if (row.state === "CUSTODY" && row.heldAtShowroomId) {
    parts.push(`Held at: ${row.heldAtShowroomId}`);
  }

  if (parts.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="text-xs text-muted-foreground">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1 opacity-40">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OpeningBalancePage() {
  const { showroom, showrooms, canAt } = useShowroom();

  const receivingShowrooms = showrooms.filter((s) =>
    canAt(SMS_PERMISSIONS.RECEIVING_MANAGE, s.id),
  );

  // ── Step & source ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [sourceTab, setSourceTab] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [fileError, setFileError] = useState("");

  // ── Form-level context ─────────────────────────────────────────────────
  const [showroomId, setShowroomId] = useState(showroom?.id ?? "");
  const [balanceDate, setBalanceDate] = useState(() => todayInputValue());

  // Keep showroomId in sync when the ShowroomProvider resolves
  useEffect(() => {
    if (showroom && !showroomId) {
      setShowroomId(showroom.id);
    }
  }, [showroom, showroomId]);

  // ── Template download ──────────────────────────────────────────────────
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const blob = await apiGetBlob("/api/sms/opening-balance/template");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "opening-balance-template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setInspectError(
        smsErrorMessage(err, "Failed to download template."),
      );
    } finally {
      setDownloadingTemplate(false);
    }
  }

  // ── Step 1 → 2 ────────────────────────────────────────────────────────
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [inspectResult, setInspectResult] = useState<ObInspectResponse | null>(
    null,
  );
  const [selectedSheet, setSelectedSheet] = useState("");
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [reInspecting, setReInspecting] = useState(false);

  // ── Step 2 → 3 ────────────────────────────────────────────────────────
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewResult, setPreviewResult] =
    useState<ObPreviewResponse | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [variantOverrides, setVariantOverrides] = useState<
    Record<number, string>
  >({});

  // ── Step 3 → 4 ────────────────────────────────────────────────────────
  // Idempotency key: minted when preview loads, re-minted after success or
  // when preview is re-run.
  const [confirmIdKey, setConfirmIdKey] = useState(() => newIdempotencyKey());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [confirmRowErrors, setConfirmRowErrors] = useState<
    ObConfirmRowError[]
  >([]);
  const [confirmResult, setConfirmResult] =
    useState<ObConfirmResponse | null>(null);

  // ── Variant master (loaded on entering step 3) ─────────────────────────
  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);
  useEffect(() => {
    if (step >= 3) {
      apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants")
        .then(setVariants)
        .catch(() => {
          /* non-critical: variant picker still shows id as fallback */
        });
    }
  }, [step]);

  // ── Inspect helpers ────────────────────────────────────────────────────

  async function doInspect(
    sheetName?: string,
  ): Promise<ObInspectResponse | null> {
    if (sourceTab === "file") {
      if (!file) {
        setFileError("Please select a file.");
        return null;
      }
      const fd = new FormData();
      fd.append("file", file);
      const url = sheetName
        ? `/api/sms/opening-balance/inspect?sheetName=${encodeURIComponent(sheetName)}`
        : "/api/sms/opening-balance/inspect";
      return smsPostForm<ObInspectResponse>(url, fd);
    } else {
      if (!pastedText.trim()) {
        setInspectError("Please paste some text.");
        return null;
      }
      const res = await api.post<{ success: boolean; data: ObInspectResponse }>(
        "/api/sms/opening-balance/inspect",
        { text: pastedText, sheetName },
      );
      return res.data.data;
    }
  }

  function step1Valid(): boolean {
    if (sourceTab === "file" && !file) {
      setFileError("Please select a file.");
      return false;
    }
    if (sourceTab === "text" && !pastedText.trim()) {
      setInspectError("Please paste text from Excel.");
      return false;
    }
    if (!showroomId) {
      setInspectError("Please select a showroom.");
      return false;
    }
    if (!balanceDate) {
      setInspectError("Please enter the balance date.");
      return false;
    }
    return true;
  }

  async function handleInspect() {
    setFileError("");
    setInspectError("");
    if (!step1Valid()) return;
    setInspecting(true);
    try {
      const result = await doInspect();
      if (!result) return;
      setInspectResult(result);
      setSelectedSheet(result.sheet.name);
      const m = applyRememberedMapping(
        result.sheet.headers,
        result.sheet.suggestedMapping,
      );
      setMapping(m);
      setStep(2);
    } catch (err) {
      setInspectError(
        smsErrorMessage(
          err,
          "Failed to read the source. Please check the file format.",
        ),
      );
    } finally {
      setInspecting(false);
    }
  }

  async function handleSheetChange(newSheet: string) {
    if (!inspectResult) return;
    setReInspecting(true);
    try {
      const result = await doInspect(newSheet);
      if (!result) return;
      setInspectResult(result);
      setSelectedSheet(newSheet);
      const m = applyRememberedMapping(
        result.sheet.headers,
        result.sheet.suggestedMapping,
      );
      setMapping(m);
    } catch (err) {
      setInspectError(
        smsErrorMessage(err, "Failed to re-inspect with the selected sheet."),
      );
    } finally {
      setReInspecting(false);
    }
  }

  // ── Step 2 → 3 ────────────────────────────────────────────────────────

  async function handlePreview() {
    if (!inspectResult) return;
    setPreviewError("");
    if (mapping["vin"] === undefined || mapping["vin"] === null) {
      setPreviewError("VIN column mapping is required.");
      return;
    }
    if (mapping["state"] === undefined || mapping["state"] === null) {
      setPreviewError("State column mapping is required.");
      return;
    }
    setPreviewing(true);
    try {
      const options = {
        sheetName: selectedSheet,
        headerRowIndex: inspectResult.sheet.headerRowIndex,
        mapping,
        showroomId: showroomId || undefined,
        balanceDate: balanceDate || undefined,
      };

      let result: ObPreviewResponse;
      if (sourceTab === "file" && file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("options", JSON.stringify(options));
        result = await smsPostForm<ObPreviewResponse>(
          "/api/sms/opening-balance/preview",
          fd,
        );
      } else {
        const res = await api.post<{
          success: boolean;
          data: ObPreviewResponse;
        }>("/api/sms/opening-balance/preview", { text: pastedText, options });
        result = res.data.data;
      }

      setPreviewResult(result);
      setVariantOverrides({});
      setConfirmRowErrors([]);

      // Re-mint idempotency key since the reviewed rows changed
      setConfirmIdKey(newIdempotencyKey());

      // Persist mapping (fieldName → header text)
      const toSave: Record<string, string> = {};
      for (const [field, colIdx] of Object.entries(mapping)) {
        if (colIdx !== null && inspectResult.sheet.headers[colIdx]) {
          toSave[field] = inspectResult.sheet.headers[colIdx]!;
        }
      }
      saveMapping(toSave);

      setStep(3);
    } catch (err) {
      setPreviewError(
        smsErrorMessage(err, "Failed to preview the opening balance."),
      );
    } finally {
      setPreviewing(false);
    }
  }

  // ── Build confirm rows ─────────────────────────────────────────────────

  function buildConfirmRows(): ObConfirmRow[] {
    if (!previewResult) return [];
    const rows: ObConfirmRow[] = [];
    for (const r of previewResult.rows) {
      if (r.errors.length > 0) continue;
      if (!r.showroomId || !r.state) continue;
      const resolvedVariantId = variantOverrides[r.row] ?? r.variantId;
      if (!resolvedVariantId) continue;

      const row: ObConfirmRow = {
        row: r.row,
        vin: r.vin,
        variantId: resolvedVariantId,
        showroomId: r.showroomId,
        state: r.state,
      };
      if (r.engineNumber) row.engineNumber = r.engineNumber;
      if (r.licensePlate) row.licensePlate = r.licensePlate;
      if (r.notes) row.notes = r.notes;
      if (r.spkNumber) row.spkNumber = r.spkNumber;
      if (r.customerName) row.customerName = r.customerName;
      if (r.customerPhone) row.customerPhone = r.customerPhone;
      if (r.salesUserId !== undefined) row.salesUserId = r.salesUserId;
      if (r.contractNumber) row.contractNumber = r.contractNumber;
      if (r.contractStartDate) row.contractStartDate = r.contractStartDate;
      if (r.eventName) row.eventName = r.eventName;
      if (r.eventLocation) row.eventLocation = r.eventLocation;
      if (r.expectedReturnDate) row.expectedReturnDate = r.expectedReturnDate;
      if (r.picUserId !== undefined) row.picUserId = r.picUserId;
      if (r.heldAtShowroomId) row.heldAtShowroomId = r.heldAtShowroomId;

      rows.push(row);
    }
    return rows;
  }

  function countMissingVariants(): number {
    if (!previewResult) return 0;
    return previewResult.rows.filter(
      (r) =>
        r.errors.length === 0 &&
        (variantOverrides[r.row] ?? r.variantId) === null,
    ).length;
  }

  // ── Step 3 → 4 ────────────────────────────────────────────────────────

  async function handleConfirm() {
    if (!previewResult) return;
    setConfirmError("");
    setConfirmRowErrors([]);
    const rows = buildConfirmRows();
    if (rows.length === 0) {
      setConfirmError("No rows are ready to import.");
      return;
    }
    setConfirming(true);
    try {
      const body: ObConfirmBody = {
        balanceDate: balanceDate || undefined,
        sourceFileName: file?.name,
        rows,
      };
      const result = await smsPost<ObConfirmResponse>(
        "/api/sms/opening-balance/confirm",
        body,
        confirmIdKey,
      );
      setConfirmResult(result);
      // Re-mint after success so a re-import would get a fresh key
      setConfirmIdKey(newIdempotencyKey());
      setStep(4);
    } catch (err) {
      const smsErr = toSmsError(err, "Failed to import opening balance. Please try again.");
      setConfirmError(smsErr.message);

      // Extract per-row errors from 422 details
      const rowErrs = smsErr.details
        .filter(isObConfirmRowError)
        .map<ObConfirmRowError>((d) => ({
          row: d.row,
          vin: d.vin,
          field: d.field,
          message: d.message,
        }));
      setConfirmRowErrors(rowErrs);
    } finally {
      setConfirming(false);
    }
  }

  // ── Permission gate ────────────────────────────────────────────────────

  if (receivingShowrooms.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <h2 className="text-base font-semibold text-amber-800">
            Permission required
          </h2>
          <p className="mt-2 text-sm text-amber-700">
            You do not have permission to import an opening balance for this
            showroom.
          </p>
          <Link
            href="/admin/sms"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Back to stock
          </Link>
        </div>
      </div>
    );
  }

  // ── Derived display helpers ────────────────────────────────────────────

  const showroomNameById = new Map(showrooms.map((s) => [s.id, s.name]));
  const errorCount = previewResult?.summary.errorCount ?? 0;
  const missingVariants = countMissingVariants();

  const importBlockReason: string | null =
    errorCount > 0
      ? `Fix ${errorCount} row${errorCount === 1 ? "" : "s"} with errors in your file and upload it again`
      : missingVariants > 0
        ? `Choose a variant for ${missingVariants} row${missingVariants === 1 ? "" : "s"}`
        : null;

  const filteredRows: ObPreviewRow[] = previewResult
    ? previewResult.rows.filter((r) => {
        if (rowFilter === "errors") return r.errors.length > 0;
        if (rowFilter === "warnings")
          return r.warnings.length > 0 && r.errors.length === 0;
        return true;
      })
    : [];

  const confirmRowErrorByRow = new Map(
    confirmRowErrors.map((e) => [e.row, e]),
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="p-4 md:p-6"
      data-tour="sms-opening-balance"
    >
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Import opening balance
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Use this to load your existing stock into the system on cutover day.
            Each row needs a state (ready, booked, active RTO, etc.). Units with
            no prior history will be marked <strong>Opening balance</strong>.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            disabled={downloadingTemplate}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {downloadingTemplate ? "Downloading…" : "Download template"}
          </button>
          <Link
            href="/admin/sms"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back
          </Link>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Source ── */}
      {step === 1 && (
        <div className="max-w-xl space-y-5">
          {/* Context fields */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold">Import context</h2>

            {/* Showroom */}
            <div>
              <label className="text-sm font-medium">
                Showroom{" "}
                <span className="text-destructive">*</span>
              </label>
              <select
                value={showroomId}
                onChange={(e) => setShowroomId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— select showroom —</option>
                {receivingShowrooms.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Default showroom for rows that have no showroom column.
              </p>
            </div>

            {/* Balance date */}
            <div>
              <label className="text-sm font-medium">
                Balance date{" "}
                <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={balanceDate}
                max={todayInputValue()}
                onChange={(e) => setBalanceDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The date your stock count was taken. Cannot be in the future.
              </p>
            </div>
          </div>

          {/* Source */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold">File source</h2>
            {/* Tabs */}
            <div className="inline-flex rounded-md border bg-muted p-0.5">
              {(["file", "text"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setSourceTab(t);
                    setFileError("");
                    setInspectError("");
                  }}
                  className={cn(
                    "rounded-sm px-4 py-1.5 text-sm font-medium",
                    sourceTab === t
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
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
                  data-tour="sms-opening-balance-upload"
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:bg-muted/30",
                    file ? "border-primary bg-primary/5" : "border-muted-foreground/30",
                    fileError && "border-destructive",
                  )}
                  onClick={() =>
                    document.getElementById("ob-file-input")?.click()
                  }
                  onDragOver={(e) => e.preventDefault()}
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
                    id="ob-file-input"
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
                      <p className="text-sm font-medium">
                        Drop a file here or click to browse
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        .xlsx · .xls · .csv
                      </p>
                    </>
                  )}
                </div>
                {fileError && (
                  <p className="mt-1 text-xs text-destructive">{fileError}</p>
                )}
              </div>
            )}

            {sourceTab === "text" && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Copy the rows in Excel including the header row, then paste
                  here.
                </p>
                <textarea
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    setInspectError("");
                  }}
                  rows={8}
                  placeholder="Paste your Excel data here…"
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          {inspectError && (
            <p className="text-sm text-destructive">{inspectError}</p>
          )}

          <button
            type="button"
            onClick={() => void handleInspect()}
            disabled={inspecting}
            data-tour="sms-opening-balance-next-columns"
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

          {/* Summary */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">
                {inspectResult.sheet.headers.length}
              </span>{" "}
              columns detected ·{" "}
              <span className="font-medium">
                {inspectResult.sheet.sampleRows.length}
              </span>{" "}
              sample rows
            </p>
          </div>

          <OpeningBalanceColumnMapper
            headers={inspectResult.sheet.headers}
            suggestedMapping={inspectResult.sheet.suggestedMapping}
            currentMapping={mapping}
            sampleRows={inspectResult.sheet.sampleRows}
            onChange={setMapping}
          />

          {previewError && (
            <p className="text-sm text-destructive">{previewError}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setPreviewError("");
              }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={previewing || reInspecting}
              data-tour="sms-opening-balance-next-review"
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {previewing ? "Previewing…" : "Next: review →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === 3 && previewResult && (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Nothing is saved yet — review the rows below, fix any errors in
            your file, then click Import.
          </p>

          {/* Summary strip */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-600">Total rows</p>
              <p className="text-lg font-bold text-slate-800">
                {previewResult.summary.total}
              </p>
            </div>
            {Object.entries(previewResult.summary.byState).map(
              ([state, count]) => (
                <div
                  key={state}
                  className="rounded-md border px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground">
                    {obStateLabel(state as ObState)}
                  </p>
                  <p className="text-lg font-bold">{count}</p>
                </div>
              ),
            )}
            {previewResult.summary.errorCount > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs text-destructive">Errors</p>
                <p className="text-lg font-bold text-destructive">
                  {previewResult.summary.errorCount}
                </p>
              </div>
            )}
            {previewResult.summary.warningCount > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-700">Warnings</p>
                <p className="text-lg font-bold text-amber-700">
                  {previewResult.summary.warningCount}
                </p>
              </div>
            )}
          </div>

          {/* Unmatched variants notice */}
          {previewResult.unmatchedVariants.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">
                {previewResult.unmatchedVariants.length} unmatched variant
                {previewResult.unmatchedVariants.length === 1 ? "" : "s"} in
                the file
              </p>
              <p className="mt-1 text-xs text-amber-700">
                These model/variant/colour combinations are not in the product
                master. Select the correct variant in the row below before
                importing.
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                {previewResult.unmatchedVariants.map((v, i) => (
                  <li key={i}>
                    {[v.rawModel, v.rawVariant, v.rawColor]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    — {v.count} unit{v.count === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Confirm-422 per-row errors */}
          {confirmRowErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="mb-2 text-sm font-medium text-destructive">
                Import failed — fix the following rows and try again:
              </p>
              <ul className="space-y-1 text-xs text-destructive">
                {confirmRowErrors.map((e, i) => (
                  <li key={i}>
                    Row {e.row} ·{" "}
                    <span className="font-mono">{e.vin}</span>
                     — {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Row filter */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Show:</span>
            {(["all", "errors", "warnings"] as RowFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setRowFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium",
                  rowFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "border hover:bg-accent",
                )}
              >
                {f === "all"
                  ? "All"
                  : f === "errors"
                    ? "With errors"
                    : "With warnings"}
              </button>
            ))}
          </div>

          {/* Row table */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">VIN</th>
                  <th className="px-3 py-2 text-left font-medium">State</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Variant
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Showroom
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Details</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Errors / warnings
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No rows match the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const hasError = row.errors.length > 0;
                    const confirmErr = confirmRowErrorByRow.get(row.row);
                    const resolvedVariantId =
                      variantOverrides[row.row] ?? row.variantId;
                    const matchedVariant = variants.find(
                      (v) => v.id === resolvedVariantId,
                    );
                    return (
                      <tr
                        key={row.row}
                        className={cn(
                          hasError || confirmErr
                            ? "bg-destructive/5"
                            : row.warnings.length > 0
                              ? "bg-amber-50/40"
                              : undefined,
                        )}
                      >
                        {/* Row number */}
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.row}
                        </td>

                        {/* VIN */}
                        <td className="px-3 py-2">
                          <span className="font-mono font-medium">
                            {row.vin || (
                              <span className="text-muted-foreground italic">
                                empty
                              </span>
                            )}
                          </span>
                        </td>

                        {/* State */}
                        <td className="px-3 py-2">
                          {row.state ? (
                            <span
                              className={cn(
                                "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                                obStateStyle(row.state),
                              )}
                            >
                              {obStateLabel(row.state)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              —
                            </span>
                          )}
                        </td>

                        {/* Variant */}
                        <td className="px-3 py-2 min-w-[180px]">
                          {matchedVariant ? (
                            <span>{variantLabel(matchedVariant)}</span>
                          ) : (
                            <select
                              value={resolvedVariantId ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val) {
                                  setVariantOverrides((prev) => ({
                                    ...prev,
                                    [row.row]: val,
                                  }));
                                } else {
                                  setVariantOverrides((prev) => {
                                    const next = { ...prev };
                                    delete next[row.row];
                                    return next;
                                  });
                                }
                              }}
                              className={cn(
                                "h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring",
                                !resolvedVariantId && row.errors.length === 0
                                  ? "border-amber-400"
                                  : "",
                              )}
                            >
                              <option value="">
                                — select variant —
                              </option>
                              {variants.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.model.name} · {v.name} · {v.color}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        {/* Showroom */}
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {row.showroomId
                            ? (showroomNameById.get(row.showroomId) ??
                              row.showroomId.slice(0, 8) + "…")
                            : "—"}
                        </td>

                        {/* State-specific details */}
                        <td className="px-3 py-2 max-w-[260px]">
                          <StateDetails row={row} />
                        </td>

                        {/* Errors / warnings */}
                        <td className="px-3 py-2 max-w-[260px] space-y-1">
                          {confirmErr && (
                            <p className="text-destructive">
                              <span className="font-medium">
                                Server:{" "}
                              </span>
                              {confirmErr.message}
                            </p>
                          )}
                          {row.errors.map((e, i) => (
                            <p key={i} className="text-destructive">
                              {e.message}
                            </p>
                          ))}
                          {row.warnings.map((w, i) => (
                            <p key={i} className="text-amber-700">
                              {w.message}
                            </p>
                          ))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Confirm-level error (non-row) */}
          {confirmError && confirmRowErrors.length === 0 && (
            <p className="text-sm text-destructive">{confirmError}</p>
          )}

          {/* Import button */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setStep(2);
                setConfirmError("");
                setConfirmRowErrors([]);
              }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              ← Back
            </button>
            <button
              type="button"
              data-tour="sms-opening-balance-confirm"
              onClick={() => void handleConfirm()}
              disabled={confirming || importBlockReason !== null}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {confirming
                ? "Importing…"
                : `Import ${buildConfirmRows().length} unit${buildConfirmRows().length === 1 ? "" : "s"}`}
            </button>
            {importBlockReason && (
              <p className="text-xs text-muted-foreground">
                {importBlockReason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === 4 && confirmResult && (
        <div className="max-w-lg space-y-5">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-3 text-base font-semibold">
              Opening balance imported
            </h2>
            <p className="text-2xl font-bold text-emerald-600">
              {confirmResult.createdCount} unit
              {confirmResult.createdCount === 1 ? "" : "s"} added as opening
              balance
            </p>

            {/* Per-state breakdown */}
            {Object.keys(confirmResult.byState).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {Object.entries(confirmResult.byState).map(([state, n]) => (
                  <div
                    key={state}
                    className="rounded-md border px-3 py-1.5"
                  >
                    <p className="text-xs text-muted-foreground">
                      {obStateLabel(state as ObState)}
                    </p>
                    <p className="font-semibold">{n}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Orders / contracts */}
            {(confirmResult.ordersCreated > 0 ||
              confirmResult.contractsCreated > 0) && (
              <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                {confirmResult.ordersCreated > 0 && (
                  <p>
                    {confirmResult.ordersCreated} order
                    {confirmResult.ordersCreated === 1 ? "" : "s"} created
                    (bookings / sales)
                  </p>
                )}
                {confirmResult.contractsCreated > 0 && (
                  <p>
                    {confirmResult.contractsCreated} contract
                    {confirmResult.contractsCreated === 1 ? "" : "s"} created
                    (RTO / custody)
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/sms"
              data-tour="sms-opening-balance-view-stock"
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              View stock →
            </Link>
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setFile(null);
                setPastedText("");
                setInspectResult(null);
                setPreviewResult(null);
                setConfirmResult(null);
                setConfirmRowErrors([]);
                setVariantOverrides({});
                setConfirmError("");
                setInspectError("");
                setFileError("");
                setPreviewError("");
              }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
