"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type {
  AssetImportRow,
  AssetImportError,
  AssetImportPreviewResponse,
  AssetImportAsyncResponse,
  AssetImportConfirmResponse,
} from "@/types/admin";

// ── Step type ───────────────────────────────────────────────────────
type Step = 1 | 2 | 3;

// ── Helper: is async response ───────────────────────────────────────
function isAsyncResponse(
  r: AssetImportPreviewResponse | AssetImportAsyncResponse,
): r is AssetImportAsyncResponse {
  return r.mode === "async";
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
  const canImport = usePermission("assets:import");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [templateDownloading, setTemplateDownloading] = useState(false);

  // Step 2 state (sync path)
  const [validRows, setValidRows] = useState<AssetImportRow[]>([]);
  const [errorRows, setErrorRows] = useState<AssetImportError[]>([]);
  const [allValidatedRows, setAllValidatedRows] = useState<AssetImportRow[]>([]);
  const [showAllValid, setShowAllValid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [importValidOnly, setImportValidOnly] = useState(false);

  // Async path state
  const [asyncJobId, setAsyncJobId] = useState<string | null>(null);

  // Step 3 state
  const [importResult, setImportResult] = useState<AssetImportConfirmResponse | null>(null);

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

  // ── File selection ────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setUploadError("");
  };

  // ── Upload & validate ─────────────────────────────────────────────
  const handleUpload = async () => {
    if (!file) {
      setUploadError("Please select a file to upload.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File must be smaller than 10 MB.");
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await api.post<{
        success: boolean;
        data: AssetImportPreviewResponse | AssetImportAsyncResponse;
      }>("/api/assets/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const result = response.data.data;

      if (isAsyncResponse(result)) {
        setAsyncJobId(result.importId);
        setStep(2);
      } else {
        const errorRowIndices = new Set(result.parseErrors.map((e) => e.rowIndex));
        setValidRows(result.preview.filter((r) => !errorRowIndices.has(r.rowIndex)));
        setErrorRows(result.parseErrors);
        setAllValidatedRows(result.validatedRows);
        setStep(2);
      }
    } catch (err: unknown) {
      setUploadError(getApiErrorMessage(err, "Upload failed. Please try again."));
    } finally {
      setUploading(false);
    }
  };

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
      }>("/api/assets/import/confirm", { validatedRows: rowsToImport });

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
    setAllValidatedRows([]);
    setShowAllValid(false);
    setConfirmError("");
    setImportResult(null);
    setAsyncJobId(null);
    setImportValidOnly(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
              Accepted formats: .xlsx, .xls — Max size: 10 MB.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              data-tour="import-file-input"
              className="mb-3 block w-full text-sm file:mr-4 file:rounded-md file:border file:px-4 file:py-2 file:text-sm file:font-medium file:hover:bg-accent"
            />
            {file && (
              <p className="mb-3 text-xs text-muted-foreground">
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
            {uploadError && (
              <p className="mb-3 text-sm text-destructive">{uploadError}</p>
            )}
            <button
              type="button"
              onClick={() => void handleUpload()}
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
        <div className="max-w-lg rounded-lg border bg-blue-50 p-6">
          <h2 className="mb-2 text-base font-semibold text-blue-900">
            Processing in background
          </h2>
          <p className="mb-4 text-sm text-blue-800">
            Your file contains many rows and is being processed in the background.
            You will be notified when the import is complete.
          </p>
          <p className="mb-4 text-xs text-muted-foreground">
            Job ID: {asyncJobId}
          </p>
          <div className="flex gap-3">
            <Link
              href="/admin/notifications"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              View Notifications
            </Link>
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

      {/* ── Step 2: Review (sync path) ── */}
      {step === 2 && !asyncJobId && (
        <div className="space-y-6">
          {/* Summary bar */}
          <div className="flex flex-wrap gap-4">
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Valid rows</p>
              <p className="text-xl font-bold text-green-700">{validRows.length}</p>
            </div>
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Error rows</p>
              <p className="text-xl font-bold text-red-700">{errorRows.length}</p>
            </div>
          </div>

          {/* Valid rows table */}
          {validRows.length > 0 && (
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
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.locationId || "-"}
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

          {/* Error rows table */}
          {errorRows.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-red-700">
                Error Rows
              </h2>
              <div className="overflow-x-auto rounded-lg border border-red-200 bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-red-50">
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Column</th>
                      <th className="px-3 py-2 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorRows.map((e, i) => (
                      <tr key={`${e.rowIndex}-${e.field}-${i}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-muted-foreground">{e.rowIndex}</td>
                        <td className="px-3 py-2 text-muted-foreground">{e.field || "-"}</td>
                        <td className="px-3 py-2 text-red-700">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {confirmError && (
            <p className="text-sm text-destructive">{confirmError}</p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleReset()}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            {errorRows.length > 0 && validRows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setImportValidOnly(true);
                  void handleConfirm(true);
                }}
                disabled={confirming}
                className="rounded-md border border-yellow-400 px-4 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
              >
                {confirming && importValidOnly
                  ? "Importing..."
                  : `Import valid rows only (${validRows.length})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setImportValidOnly(false);
                void handleConfirm(false);
              }}
              disabled={confirming || validRows.length === 0}
              data-tour="confirm-import-btn"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {confirming && !importValidOnly
                ? "Importing..."
                : `Confirm Import (${validRows.length} rows)`}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Result ── */}
      {step === 3 && importResult && (
        <div className="max-w-lg space-y-6">
          {/* Summary */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-4 text-base font-semibold">Import Complete</h2>
            <div className="flex gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-2xl font-bold text-green-600">
                  {importResult.created}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-600">
                  {importResult.failed.length}
                </p>
              </div>
            </div>
          </div>

          {/* Failures */}
          {importResult.failed.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-card">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-red-700">
                  Failed Rows
                </h3>
              </div>
              <ul className="divide-y text-xs">
                {importResult.failed.map((e, i) => (
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
