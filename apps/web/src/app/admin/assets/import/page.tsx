"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import FileDropzone from "@/components/shared/file-dropzone";
import ColumnMappingPanel from "@/components/shared/import-column-mapping";
import NewProductsReview from "@/components/shared/import-new-products-review";
import ImportErrorRowEditor from "@/components/shared/import-error-row-editor";
import type {
  AssetImportRow,
  AssetImportError,
  AssetImportSkipped,
  AssetImportPreviewResponse,
  AssetImportAsyncResponse,
  AssetImportConfirmResponse,
  AssetImportStatus,
  AssetImportDetectedMapping,
} from "@/types/admin";
import { apiGet } from "@/lib/api";

// localStorage slot for the most-recent successful column mapping. Stored as
// `{ canonicalKey: actualHeaderText }` so it survives across files with
// different column orderings. Cleared via "Reset to auto-detected" in the
// mapping UI.
const COLUMN_MAPPING_STORAGE_KEY = "wedisense:import:column-mapping:assets";

function loadSavedMapping(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLUMN_MAPPING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Shallow validation: every value must be a non-empty string.
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v.length > 0) result[k] = v;
      }
      return Object.keys(result).length > 0 ? result : null;
    }
  } catch {
    // Corrupt JSON — wipe it so future loads aren't poisoned.
    try {
      window.localStorage.removeItem(COLUMN_MAPPING_STORAGE_KEY);
    } catch {
      // Quota / privacy mode — nothing we can do.
    }
  }
  return null;
}

function saveMappingFromDetected(detected: AssetImportDetectedMapping): void {
  if (typeof window === "undefined") return;
  const toSave: Record<string, string> = {};
  for (const [key, item] of Object.entries(detected.mapping)) {
    if (item) toSave[key] = item.actualHeader;
  }
  try {
    window.localStorage.setItem(
      COLUMN_MAPPING_STORAGE_KEY,
      JSON.stringify(toSave),
    );
  } catch {
    // Storage failures are non-fatal.
  }
}

function clearSavedMapping(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COLUMN_MAPPING_STORAGE_KEY);
  } catch {
    // Same as above.
  }
}

// ── Step type ───────────────────────────────────────────────────────
type Step = 1 | 2 | 3;

// ── ETA formatting ──────────────────────────────────────────────────
// Turns a duration in seconds into a short human-friendly string. We bias
// toward whole units (minutes, hours) past the first minute because the
// underlying rate calculation isn't precise enough to justify "1m 37s".
function formatEtaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "almost done";
  if (seconds < 5) return "a few seconds";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `~${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `~${hours}h ${minutes}m` : `~${hours}h`;
}

// ── Error report download ────────────────────────────────────────────
// Shared helper used by both AsyncProgressPanel and the Step 3 result view.
// Posts the current error list to the backend, receives an XLSX blob, and
// triggers a download. Errors are caught and surfaced as a window.alert —
// good enough for a fallback path where the primary feedback (the result
// page itself) is already shown.
async function downloadErrorReport(errors: AssetImportError[]): Promise<void> {
  if (errors.length === 0) return;
  try {
    const response = await api.post<Blob>(
      "/api/assets/import/errors-report.xlsx",
      { errors },
      { responseType: "blob" },
    );
    const blobUrl = URL.createObjectURL(response.data);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `wedisense-import-errors-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    window.alert(getApiErrorMessage(err, "Failed to download error report"));
  }
}

// ── Helper: is async response ───────────────────────────────────────
function isAsyncResponse(
  r: AssetImportPreviewResponse | AssetImportAsyncResponse,
): r is AssetImportAsyncResponse {
  return r.mode === "async";
}

// ── Async progress panel ────────────────────────────────────────────
// Renders a live progress bar fed by /api/assets/import/:importId/status.
// Statuses:
//   - queued: bar shown indeterminate
//   - processing: bar reflects processed/total ratio
//   - completed: the parent flips to Step 3 (this panel unmounts)
//   - failed: red error state with the backend message
//
// The "Import another file" reset is always available so a user who walked
// away can clear state without waiting for completion.
function AsyncProgressPanel({
  status,
  onReset,
}: {
  status: AssetImportStatus | null;
  onReset: () => void;
}) {
  const isQueued = !status || status.status === "queued";
  const isFailed = status?.status === "failed";
  const processed = status?.progress?.processed ?? 0;
  const total = status?.progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  // ── ETA tracking ──────────────────────────────────────────────────
  // Record (processed, timestamp) samples between status updates and
  // compute the average rate over the rolling window. Anchors on `useRef`
  // (mutating wouldn't trigger a re-render anyway — the parent re-renders
  // us when the polled status changes). The component is mounted fresh
  // for each import, so the buffer naturally starts empty.
  const samplesRef = useRef<Array<{ processed: number; timestamp: number }>>([]);
  useEffect(() => {
    if (!status || total === 0) return;
    const samples = samplesRef.current;
    const latest = samples[samples.length - 1];
    if (!latest || latest.processed !== processed) {
      samples.push({ processed, timestamp: Date.now() });
      // Cap the window — older samples become inaccurate as the import
      // load varies (DB contention, etc.). 5 ≈ 10s of history at 2s poll.
      if (samples.length > 5) samples.shift();
    }
  }, [processed, total, status]);

  let eta: string | null = null;
  const samples = samplesRef.current;
  if (
    !isFailed &&
    !isQueued &&
    total > 0 &&
    processed < total &&
    samples.length >= 2
  ) {
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const dRows = last.processed - first.processed;
    const dTime = (last.timestamp - first.timestamp) / 1000;
    if (dRows > 0 && dTime > 0) {
      const rate = dRows / dTime;
      eta = formatEtaSeconds((total - processed) / rate);
    }
  }

  return (
    <div
      className={cn(
        "max-w-lg rounded-lg border p-6",
        isFailed ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50",
      )}
    >
      <h2
        className={cn(
          "mb-2 text-base font-semibold",
          isFailed ? "text-red-900" : "text-blue-900",
        )}
      >
        {isFailed
          ? "Import failed"
          : isQueued
            ? "Queued for processing"
            : "Processing your file"}
      </h2>
      {isFailed ? (
        <p className="mb-4 text-sm text-red-800">
          {status?.error ?? "An unexpected error occurred."}
        </p>
      ) : (
        <p className="mb-4 text-sm text-blue-800">
          {isQueued ? (
            "Your file is waiting in the queue. This usually takes a few seconds."
          ) : (
            <>
              Processing {processed.toLocaleString()} of {total.toLocaleString()} rows
              {eta && (
                <span className="ml-2 text-blue-600">· {eta} remaining</span>
              )}
            </>
          )}
        </p>
      )}

      {!isFailed && (
        <>
          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
            {isQueued || total === 0 ? (
              // Indeterminate: subtle pulse so the user knows we're alive.
              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" />
            ) : (
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <div className="mb-4 flex justify-between text-xs text-blue-700">
            <span>
              Created: {status?.created ?? 0} · Skipped: {status?.skipped ?? 0} · Failed:{" "}
              {status?.failed ?? 0}
            </span>
            {total > 0 && <span>{pct}%</span>}
          </div>
        </>
      )}

      <div className="flex gap-3">
        <Link
          href="/admin/notifications"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          View Notifications
        </Link>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Import Another File
        </button>
      </div>
    </div>
  );
}

// ── Helper: confirm-button label ────────────────────────────────────
// The button has to communicate three numbers in one short phrase.
// We pick the shortest accurate label per case so the button doesn't
// get unwieldy.
function buildConfirmLabel(newCount: number, skipCount: number, errorCount: number): string {
  if (newCount === 0 && skipCount > 0 && errorCount === 0) {
    // Re-running the same file end-to-end: nothing to create, all already exist.
    return `Confirm — ${skipCount} already exist`;
  }
  if (newCount === 0 && skipCount > 0 && errorCount > 0) {
    return `Confirm (skip ${skipCount}, ${errorCount} errors)`;
  }
  // 1+ rows will be created.
  const parts: string[] = [`Import ${newCount} new`];
  if (skipCount > 0) parts.push(`skip ${skipCount}`);
  if (errorCount > 0) parts.push(`${errorCount} errors`);
  return parts[0]! + (parts.length > 1 ? ` (${parts.slice(1).join(", ")})` : "");
}

// ── Step indicator ──────────────────────────────────────────────────
function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1 as Step, label: "Upload" },
    { n: 2 as Step, label: "Review" },
    { n: 3 as Step, label: "Result" },
  ];
  return (
    <div className="mb-8 flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
              current === s.n
                ? "bg-primary text-primary-foreground"
                : current > s.n
                  ? "bg-green-500 text-white"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {current > s.n ? "✓" : s.n}
          </div>
          <span
            className={cn(
              "ml-2 text-sm",
              current === s.n ? "font-semibold" : "text-muted-foreground",
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div className="mx-4 h-px w-12 bg-muted" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────
export default function AssetImportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canImport = usePermission("assets:import");

  // Phase 17: optional procurement batch context. When the user arrives
  // from /admin/procurement/[id] via "Import assets", the batchId query
  // param is set. Every asset created by this import will be linked to
  // that batch (validated server-side; locked batches reject with a
  // clear error code). We don't fetch the batch's metadata here — the
  // ID is sufficient and the backend re-validates anyway.
  const batchId = searchParams?.get("batchId") ?? null;

  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [templateDownloading, setTemplateDownloading] = useState(false);

  // Step 2 state (sync path)
  const [validRows, setValidRows] = useState<AssetImportRow[]>([]);
  const [errorRows, setErrorRows] = useState<AssetImportError[]>([]);
  // Rows the backend flagged as duplicate-serial — counted as "skip" not
  // "error" so the user understands re-runs are idempotent.
  const [skipRows, setSkipRows] = useState<AssetImportSkipped[]>([]);
  const [allValidatedRows, setAllValidatedRows] = useState<AssetImportRow[]>([]);
  const [showAllValid, setShowAllValid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  // Column-mapping context for the upload — used by the mapping panel and
  // persisted to localStorage on successful import so future uploads with
  // similar headers come pre-mapped.
  const [detectedMapping, setDetectedMapping] =
    useState<AssetImportDetectedMapping | null>(null);
  // The override actively applied at upload time (so re-uploads of the same
  // file can be triggered without re-deriving it). Empty object means "no
  // override was sent" — distinct from null which means "no upload yet".
  const [activeMappingOverride, setActiveMappingOverride] =
    useState<Record<string, string> | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false);
  // Step 2 view toggle. "all" shows the full breakdown (mapping panel,
  // new-products review, valid + skip + error sections). "errors" hides
  // the non-actionable sections so the user can focus on triaging issues.
  // Defaults to "all" — switching to "errors" is the user's explicit choice.
  const [viewMode, setViewMode] = useState<"all" | "errors">("all");
  // Idempotency policy. Default ON: rows whose serial matches an existing
  // live asset are silently skipped on confirm (re-uploading the same file
  // is safe). OFF flips this into strict mode — duplicates become a blocking
  // condition the user must remove from the file before importing. Backend
  // is always idempotent at the DB layer; the toggle's "OFF" is enforced
  // purely client-side by refusing to send the conflicting rows.
  const [idempotentMode, setIdempotentMode] = useState(true);

  // Async path state. `asyncJobId` is the importId returned at upload time;
  // `asyncStatus` is the latest polled snapshot. When status flips to
  // `completed` we synthesise a Result-like view from the snapshot so the
  // user lands on the same Step 3 UI as the sync path.
  const [asyncJobId, setAsyncJobId] = useState<string | null>(null);
  const [asyncStatus, setAsyncStatus] = useState<AssetImportStatus | null>(null);

  // Step 3 state
  const [importResult, setImportResult] = useState<AssetImportConfirmResponse | null>(null);

  // ── Async status polling ──────────────────────────────────────────
  // Every 2s while we have an asyncJobId AND the latest status isn't yet
  // terminal. Polling stops automatically when terminal state is reached
  // or the job ID is cleared (handleReset). 2s feels live without thrashing
  // the API; per-row progress writes to Redis happen faster than this
  // anyway so the bar still updates smoothly.
  useEffect(() => {
    if (!asyncJobId) return;
    if (
      asyncStatus &&
      (asyncStatus.status === "completed" || asyncStatus.status === "failed")
    ) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await apiGet<AssetImportStatus>(
          `/api/assets/import/${asyncJobId}/status`,
        );
        if (!cancelled) setAsyncStatus(status);
        // When the job finishes, hop to Step 3 with a synthesised
        // confirm-response shape so the same Result UI handles both
        // sync and async paths.
        if (
          !cancelled &&
          status.status === "completed" &&
          asyncJobId
        ) {
          setImportResult({
            created: status.created ?? 0,
            skipped: status.skipped ?? 0,
            failed: status.failed ?? 0,
            errors: status.result?.errors ?? [],
            skippedRows: [],
            assets: [],
          });
          setStep(3);
        }
      } catch {
        // Transient network error — keep polling, the next tick will retry.
      }
    };
    // Run once immediately so the UI doesn't sit empty for 2s, then on a
    // fixed cadence.
    void tick();
    const handle = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [asyncJobId, asyncStatus]);

  // ── Template download ─────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    setTemplateDownloading(true);
    try {
      const response = await api.get<Blob>("/api/assets/import/template", {
        responseType: "blob",
      });
      const blobUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = "wedisense-asset-import-template.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setUploadError(getApiErrorMessage(err, "Failed to download template."));
    } finally {
      setTemplateDownloading(false);
    }
  };

  // ── Upload & validate ─────────────────────────────────────────────
  // Size + extension validation runs inside FileDropzone at selection time,
  // so by the time we get here `file` is already known-good.
  //
  // `mappingOverride` is the (optional) user-confirmed column mapping. On
  // the very first upload we pass any mapping previously saved in
  // localStorage; subsequent re-uploads from the mapping panel pass the
  // panel's selections. `null` means "no override" (let backend auto-detect).
  const handleUpload = async (
    mappingOverride: Record<string, string> | null = activeMappingOverride,
  ) => {
    if (!file) {
      setUploadError("Please select a file to upload.");
      return;
    }

    const isReapply = mappingBusy; // set by handleApplyMapping before calling us
    if (!isReapply) {
      setUploading(true);
    }
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (mappingOverride && Object.keys(mappingOverride).length > 0) {
        formData.append("columnMapping", JSON.stringify(mappingOverride));
      }
      // Phase 17: propagate batch link with the upload. Async path needs
      // it baked into the job payload since the worker has no
      // preview/confirm step. Sync path also gets it here so /confirm
      // doesn't have to re-attach it (though /confirm still accepts it
      // as a convenience).
      if (batchId) {
        formData.append("procurementBatchId", batchId);
      }

      const response = await api.post<{
        success: boolean;
        data: AssetImportPreviewResponse | AssetImportAsyncResponse;
      }>("/api/assets/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const result = response.data.data;

      // Whatever the path, remember the mapping the backend used so we can
      // show it in the panel and persist it on success.
      if (result.detectedMapping) {
        setDetectedMapping(result.detectedMapping);
      }
      setActiveMappingOverride(mappingOverride);

      if (isAsyncResponse(result)) {
        setAsyncJobId(result.importId);
        setStep(2);
      } else {
        // Backend already filters error rows out of validatedRows. We then
        // split validatedRows into "valid (will create)" and "willSkip
        // (already exists)" so the Review step shows the same 3-bucket
        // breakdown the user will see at Result.
        const skipRowIndices = new Set(result.willSkip.map((s) => s.rowIndex));
        setValidRows(
          result.validatedRows.filter((r) => !skipRowIndices.has(r.rowIndex)),
        );
        setSkipRows(result.willSkip);
        setErrorRows(result.parseErrors);
        setAllValidatedRows(result.validatedRows);
        setStep(2);
      }
    } catch (err: unknown) {
      setUploadError(getApiErrorMessage(err, "Upload failed. Please try again."));
    } finally {
      setUploading(false);
      setMappingBusy(false);
    }
  };

  // ── Column-mapping handlers ────────────────────────────────────────
  // Both delegate to handleUpload with a different override. mappingBusy
  // suppresses the main "Uploading..." flag so the dropzone doesn't flicker
  // — instead the panel shows its own "Re-validating..." state.
  const handleApplyMapping = async (override: Record<string, string>) => {
    setMappingBusy(true);
    await handleUpload(override);
  };

  const handleResetMapping = async () => {
    setMappingBusy(true);
    clearSavedMapping();
    await handleUpload(null);
  };

  // ── Apply local edits to validated rows (e.g. user tweaked a new-product
  //    spec in the review panel). Updates both the canonical
  //    `allValidatedRows` (used by confirm) and the derived `validRows`
  //    (used for the preview table) so the two stay in sync without a
  //    separate effect.
  const applyRowEdits = (
    transform: (rows: AssetImportRow[]) => AssetImportRow[],
  ) => {
    setAllValidatedRows((prev) => {
      const next = transform(prev);
      const skipRowIndices = new Set(skipRows.map((s) => s.rowIndex));
      setValidRows(next.filter((r) => !skipRowIndices.has(r.rowIndex)));
      return next;
    });
  };

  // ── Inline error-row repair ────────────────────────────────────────
  // The user edits an errored row in <ImportErrorRowEditor> and hits
  // re-validate; if the row now validates, the editor calls back here.
  // We promote it into `allValidatedRows` (so confirm includes it) and
  // remove every entry in `errorRows` that referenced its rowIndex.
  const handleErrorRowResolved = (resolved: AssetImportRow) => {
    const idx = resolved.rowIndex;
    setErrorRows((prev) => prev.filter((e) => e.rowIndex !== idx));
    setAllValidatedRows((prev) => {
      // Replace if we already had a stub for this rowIndex (shouldn't
      // happen — validated rows aren't error rows by construction — but
      // belt-and-suspenders), otherwise append.
      const without = prev.filter((r) => r.rowIndex !== idx);
      const next = [...without, resolved].sort((a, b) => a.rowIndex - b.rowIndex);
      const skipRowIndices = new Set(skipRows.map((s) => s.rowIndex));
      setValidRows(next.filter((r) => !skipRowIndices.has(r.rowIndex)));
      return next;
    });
  };

  // User decided to drop this row entirely. Remove every error tied to it.
  // The row never enters allValidatedRows, so it won't be imported.
  const handleErrorRowDiscarded = (rowIndex: number) => {
    setErrorRows((prev) => prev.filter((e) => e.rowIndex !== rowIndex));
  };

  // Group errors by rowIndex for the editor list. Memo isn't required for
  // correctness (it's pure), but it does avoid rebuilding the map on every
  // unrelated state change.
  const errorsByRow = useMemo(() => {
    const map = new Map<number, AssetImportError[]>();
    for (const e of errorRows) {
      const list = map.get(e.rowIndex);
      if (list) list.push(e);
      else map.set(e.rowIndex, [e]);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([rowIndex, errors]) => ({ rowIndex, errors }));
  }, [errorRows]);

  // If the user is in "Errors only" mode and finishes triaging everything
  // (errorRows empty), automatically flip back to "All" so they're not
  // staring at a blank screen. The toggle itself disappears with the
  // condition above, but viewMode state would otherwise stay stuck.
  useEffect(() => {
    if (viewMode === "errors" && errorRows.length === 0) {
      setViewMode("all");
    }
  }, [viewMode, errorRows.length]);

  // ── Confirm import ────────────────────────────────────────────────
  const handleConfirm = async (validOnly: boolean) => {
    setConfirming(true);
    setConfirmError("");

    try {
      const rowsToImport = validOnly
        ? allValidatedRows.filter((r) => !errorRows.some((e) => e.rowIndex === r.rowIndex))
        : allValidatedRows;

      const response = await api.post<{
        success: boolean;
        data: AssetImportConfirmResponse;
      }>("/api/assets/import/confirm", {
        validatedRows: rowsToImport,
        // Phase 17: ride the batch link through /confirm too so the
        // bulkImport path picks it up. Backend ignores when null.
        ...(batchId && { procurementBatchId: batchId }),
      });

      // Persist the column mapping that produced this successful import so
      // the next file with similar headers comes pre-mapped. Only save on
      // success — failed imports might mean the mapping was wrong.
      if (detectedMapping) {
        saveMappingFromDetected(detectedMapping);
      }

      setImportResult(response.data.data);
      setStep(3);
    } catch (err: unknown) {
      setConfirmError(getApiErrorMessage(err, "Import failed. Please try again."));
    } finally {
      setConfirming(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep(1);
    setFile(null);
    setUploadError("");
    setValidRows([]);
    setErrorRows([]);
    setSkipRows([]);
    setAllValidatedRows([]);
    setShowAllValid(false);
    setConfirmError("");
    setImportResult(null);
    setAsyncJobId(null);
    // Must clear async status too — otherwise the polling effect's guard
    // (which exits when status is in a terminal state) prevents a fresh
    // second import from being polled at all.
    setAsyncStatus(null);
    setDetectedMapping(null);
    setActiveMappingOverride(null);
    setMappingBusy(false);
  };

  if (!canImport) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="mb-2 text-lg font-semibold text-red-800">
            403 — Permission required
          </h2>
          <p className="text-sm text-red-700">
            You need the <code>assets:import</code> permission to import assets.
          </p>
          <Link
            href="/admin/assets"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Back to Assets
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6" data-tour="asset-import">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bulk import assets from an Excel file.
          </p>
        </div>
        <Link
          href="/admin/assets"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to Assets
        </Link>
      </div>

      {/* Phase 17: batch context banner. Shows up when this wizard was
          entered via /admin/procurement/[id] "Import assets" — gives the
          user a clear "you're importing into batch X" cue and a one-click
          escape if they meant a free-form import. */}
      {batchId && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <div className="flex items-center gap-2">
            <span className="font-medium">Linking to procurement batch.</span>
            <Link
              href={`/admin/procurement/${batchId}`}
              className="underline hover:no-underline"
            >
              View batch
            </Link>
            <span className="text-blue-700">
              · Every imported asset will be attached to this batch.
            </span>
          </div>
          <Link
            href="/admin/assets/import"
            className="ml-3 rounded border border-blue-300 px-2 py-0.5 text-xs hover:bg-white"
          >
            Remove link
          </Link>
        </div>
      )}

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* ── Step 1: Upload ── */}
      {step === 1 && (
        <div className="max-w-lg space-y-6">
          {/* Download template */}
          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-1 text-sm font-semibold">Step 1: Get the template</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Download the Excel template, fill in your asset data, then upload it below.
            </p>
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              disabled={templateDownloading}
              data-tour="download-import-template-btn"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {templateDownloading ? "Downloading..." : "Download Template"}
            </button>
          </div>

          {/* File upload */}
          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-1 text-sm font-semibold">Step 2: Upload your file</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Drag your filled-in template here, or click to browse.
            </p>
            <div className="mb-3">
              <FileDropzone
                file={file}
                onChange={(f) => {
                  setFile(f);
                  setUploadError("");
                }}
                onError={(message) => setUploadError(message)}
                maxSizeMb={10}
                disabled={uploading}
                data-tour="import-file-input"
              />
            </div>
            {uploadError && (
              <p className="mb-3 text-sm text-destructive">{uploadError}</p>
            )}
            <button
              type="button"
              onClick={() => {
                // First upload: apply any mapping saved from a previous
                // successful import so files with the same header style
                // come pre-mapped. The panel will still appear so the
                // user can confirm / adjust.
                const saved = loadSavedMapping();
                void handleUpload(saved);
              }}
              disabled={!file || uploading}
              data-tour="upload-validate-btn"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {uploading ? "Uploading & Validating..." : "Upload & Validate"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Review (async path) ── */}
      {step === 2 && asyncJobId && (
        <AsyncProgressPanel
          status={asyncStatus}
          onReset={handleReset}
        />
      )}

      {/* ── Step 2: Review (sync path) ── */}
      {step === 2 && !asyncJobId && (
        <div className="space-y-6">
          {/* Column mapping panel — collapsible. Auto-expands on synonym
              matches or missing required columns. */}
          {detectedMapping && (
            <ColumnMappingPanel
              detected={detectedMapping}
              busy={mappingBusy}
              onApply={(override) => void handleApplyMapping(override)}
              onReset={() => void handleResetMapping()}
            />
          )}

          {/* Summary bar — three buckets. The view toggle on the right
              lets the user focus on errors when triaging large imports. */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap gap-4">
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-xs text-muted-foreground">New (will create)</p>
                <p className="text-xl font-bold text-green-700">{validRows.length}</p>
              </div>
              <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3">
                <p className="text-xs text-muted-foreground">Already exists (skip)</p>
                <p className="text-xl font-bold text-yellow-700">{skipRows.length}</p>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs text-muted-foreground">Error rows</p>
                <p className="text-xl font-bold text-red-700">{errorRows.length}</p>
              </div>
            </div>

            {/* View toggle — only meaningful when there are both error and
                non-error rows. If everything is valid (or everything is
                errored) the toggle becomes redundant; hide it. */}
            {errorRows.length > 0 && (validRows.length > 0 || skipRows.length > 0) && (
              <div
                role="tablist"
                aria-label="Filter view"
                className="inline-flex shrink-0 self-center rounded-md border bg-card p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === "all"}
                  onClick={() => setViewMode("all")}
                  className={cn(
                    "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                    viewMode === "all"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  All ({allValidatedRows.length + errorRows.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === "errors"}
                  onClick={() => setViewMode("errors")}
                  className={cn(
                    "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                    viewMode === "errors"
                      ? "bg-red-600 text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Errors only ({errorsByRow.length})
                </button>
              </div>
            )}
          </div>

          {/* Idempotency policy — shown only when there are skip-candidate
              rows, since that's the only situation where the toggle has any
              effect. Helps users explain to themselves what happens to
              already-existing serials. */}
          {skipRows.length > 0 && (
            <div
              className={cn(
                "rounded-lg border p-4",
                idempotentMode
                  ? "border-blue-200 bg-blue-50/40"
                  : "border-orange-200 bg-orange-50/40",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {idempotentMode
                      ? "Re-import safe — duplicates by serial will be skipped"
                      : "Strict mode — duplicates by serial will block the import"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {idempotentMode ? (
                      <>
                        <span className="font-semibold">{skipRows.length}</span> row
                        {skipRows.length === 1 ? "" : "s"} match an asset already in
                        the system. Confirming will silently skip them.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">{skipRows.length}</span> conflict
                        {skipRows.length === 1 ? "" : "s"} detected. Confirm is
                        blocked until you either turn idempotent mode back on or
                        remove these rows from your file.
                      </>
                    )}
                  </p>
                </div>
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Idempotent
                  </span>
                  <span className="relative inline-block h-5 w-9">
                    <input
                      type="checkbox"
                      checked={idempotentMode}
                      onChange={(e) => setIdempotentMode(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        "absolute inset-0 rounded-full transition-colors",
                        "bg-muted peer-checked:bg-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                      )}
                    />
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                        idempotentMode && "translate-x-4",
                      )}
                    />
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* New-entities review: aggregated list of products that will be
              created on confirm, with inline editing. Only renders when at
              least one row carries a newProductSpec. Hidden in "errors only"
              mode since new products are valid-row context. */}
          {viewMode === "all" && (
            <NewProductsReview
              rows={allValidatedRows}
              onRowsChange={applyRowEdits}
            />
          )}

          {/* Valid rows table */}
          {viewMode === "all" && validRows.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-green-700">
                Valid Rows (preview)
              </h2>
              <div className="overflow-x-auto rounded-lg border border-green-200 bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-green-50">
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Product</th>
                      <th className="px-3 py-2 text-left font-medium">Location</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllValid ? validRows : validRows.slice(0, 10)).map(
                      (r) => (
                        <tr key={r.rowIndex} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-muted-foreground">{r.rowIndex}</td>
                          <td className="px-3 py-2">{r.name || "-"}</td>
                          <td className="px-3 py-2">
                            {r.productLabel ?? r.productId ?? "-"}
                            {r.newProductSpec && (
                              <span className="ml-2 rounded-sm bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                                new
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.locationLabel ?? r.locationId ?? "-"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.status}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              {validRows.length > 10 && !showAllValid && (
                <button
                  type="button"
                  onClick={() => setShowAllValid(true)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Show {validRows.length - 10} more valid rows
                </button>
              )}
            </div>
          )}

          {/* Already-existing rows — label adapts to idempotency mode. */}
          {viewMode === "all" && skipRows.length > 0 && (
            <div>
              <h2
                className={cn(
                  "mb-2 text-sm font-semibold",
                  idempotentMode ? "text-yellow-700" : "text-orange-700",
                )}
              >
                {idempotentMode
                  ? "Already exists — will be skipped"
                  : "Already exists — blocking import (strict mode)"}
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">
                These rows have a serial number that already matches a live asset. They will not be re-imported.
              </p>
              <div className="overflow-x-auto rounded-lg border border-yellow-200 bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-yellow-50">
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Serial</th>
                      <th className="px-3 py-2 text-left font-medium">Existing asset</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {skipRows.map((s) => (
                      <tr
                        key={`${s.rowIndex}-${s.existing.id}`}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-2 text-muted-foreground">{s.rowIndex}</td>
                        <td className="px-3 py-2 font-mono">{s.existing.serialNumber}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{s.existing.assetNumber}</span>
                          <span className="text-muted-foreground"> — {s.existing.name}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/admin/assets/${s.existing.id}`}
                            className="text-primary hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error rows — inline editor per row. The list scrolls if there
              are many; each card carries its own state so editing one
              doesn't touch another. */}
          {errorsByRow.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-red-700">
                  Rows needing repair ({errorsByRow.length})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Edit fields below and click <span className="font-medium">Save & re-validate</span>.
                </p>
              </div>
              <div className="space-y-3">
                {errorsByRow.map(({ rowIndex, errors }) => (
                  <ImportErrorRowEditor
                    key={rowIndex}
                    rowIndex={rowIndex}
                    errors={errors}
                    onResolved={handleErrorRowResolved}
                    onDiscard={() => handleErrorRowDiscarded(rowIndex)}
                  />
                ))}
              </div>
            </div>
          )}

          {confirmError && (
            <p className="text-sm text-destructive">{confirmError}</p>
          )}

          {/* Actions */}
          {/*
           * Two scenarios:
           *  - No errors: a single primary "Import N rows" button.
           *  - Some errors: only the "Import N valid rows (skip M)" button is
           *    shown. The previous "Confirm Import" path silently included
           *    error rows and would 422 on the server — we removed it.
           *  - All errors: only "Cancel" is enabled. Force the user back to
           *    fix the file.
           */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleReset()}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            {(validRows.length > 0 || skipRows.length > 0) && (
              <button
                type="button"
                onClick={() => void handleConfirm(errorRows.length > 0)}
                // Strict mode blocks confirm whenever there are skip-candidate
                // rows — the user must turn idempotency back on or remove
                // them from the file. The label below reflects this state.
                disabled={
                  confirming ||
                  (validRows.length === 0 && skipRows.length === 0) ||
                  (!idempotentMode && skipRows.length > 0)
                }
                data-tour="confirm-import-btn"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {confirming
                  ? "Importing..."
                  : !idempotentMode && skipRows.length > 0
                    ? `Blocked — ${skipRows.length} duplicate${skipRows.length === 1 ? "" : "s"} in strict mode`
                    : buildConfirmLabel(validRows.length, skipRows.length, errorRows.length)}
              </button>
            )}
            {validRows.length === 0 && skipRows.length === 0 && errorRows.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Fix the errors in your file and re-upload to continue.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Result ── */}
      {step === 3 && importResult && (
        <div className="max-w-2xl space-y-6">
          {/* Summary — three buckets: created (new), skipped (already
              existed), failed (validation/insert errors). */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-4 text-base font-semibold">Import Complete</h2>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-2xl font-bold text-green-600">
                  {importResult.created}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Skipped (already existed)</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {importResult.skipped}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-600">
                  {importResult.failed}
                </p>
              </div>
            </div>
          </div>

          {/* Skipped rows — informational, not an error. */}
          {importResult.skippedRows.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-card">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-yellow-700">
                  Skipped rows ({importResult.skippedRows.length})
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  These rows match an existing asset&apos;s serial number and were not re-imported.
                </p>
              </div>
              <ul className="divide-y text-xs">
                {importResult.skippedRows.map((s) => (
                  <li
                    key={`${s.rowIndex}-${s.existing.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span>
                      <span className="text-muted-foreground">Row {s.rowIndex}: </span>
                      Serial <span className="font-mono">{s.existing.serialNumber}</span>{" "}
                      already linked to{" "}
                      <span className="font-medium">{s.existing.assetNumber}</span>
                      {" — "}
                      {s.existing.name}
                    </span>
                    <Link
                      href={`/admin/assets/${s.existing.id}`}
                      className="shrink-0 text-primary hover:underline"
                    >
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Failures */}
          {importResult.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-red-700">
                  Failed rows ({importResult.errors.length})
                </h3>
                {/* Quick offline-fix path: download the failed rows as an
                    XLSX, fix them in Excel, re-upload. The full row's
                    rawValues are included so the user doesn't have to
                    cross-reference their original file. */}
                <button
                  type="button"
                  onClick={() => void downloadErrorReport(importResult.errors)}
                  className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Download error report (.xlsx)
                </button>
              </div>
              <ul className="divide-y text-xs">
                {importResult.errors.map((e, i) => (
                  <li key={i} className="px-4 py-2">
                    <span className="text-muted-foreground">Row {e.rowIndex}: </span>
                    <span className="text-red-700">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.push("/admin/assets")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              View Imported Assets
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
