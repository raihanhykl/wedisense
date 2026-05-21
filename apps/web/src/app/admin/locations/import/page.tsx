"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";

// ── API shapes (mirrors backend ImportResult) ────────────────────────

interface ImportResult {
  created: { rowIndex: number; id: string; name: string; code: string }[];
  skipped: { rowIndex: number; code: string; reason: string }[];
  failed: { rowIndex: number; code: string; reason: string }[];
  parseErrors: { rowIndex: number; field: string; message: string; value?: unknown }[];
}

const TEMPLATE_URL = "/api/locations/import/template";

// Helper — surface the API base URL the same way our axios client does so
// the download link works in any deploy.
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Bulk Location import — single-page flow:
 *
 *   1. Download template (.xlsx) → fill → upload here.
 *   2. We submit the file; backend parses + commits in one request and
 *      returns created / skipped / failed / parseErrors.
 *   3. We render outcome buckets. User can upload another file or go back.
 *
 * Intentionally sync-only — internal AMS location sheets are small. The
 * asset import has an async/BullMQ path; we don't need it here.
 */
export default function LocationImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const { useAuthStore } = await import("@/stores/auth.store");
      const accessToken = useAuthStore.getState().accessToken ?? "";
      const res = await fetch(`${apiBase}${TEMPLATE_URL}`, {
        method: "GET",
        credentials: "include",
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      });
      if (!res.ok) {
        throw new Error(`Template download failed (${res.status})`);
      }
      const blob = await res.blob();
      // Programmatic download — create an object URL and click a hidden
      // anchor so the file goes to the browser's downloads folder.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wedisense-locations-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Template download failed"));
    } finally {
      setDownloading(false);
    }
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    setResult(null);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      // apiPost is JSON-only. We need raw multipart, so we route through
      // fetch directly, pulling the token from the same Zustand store the
      // axios client reads from (single source of truth).
      const { useAuthStore } = await import("@/stores/auth.store");
      const accessToken = useAuthStore.getState().accessToken ?? "";

      const res = await fetch(`${apiBase}/api/locations/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error?.message ?? `Import failed (${res.status})`,
        );
      }
      const body = (await res.json()) as { data: ImportResult };
      setResult(body.data);
      const total = body.data.created.length;
      if (total > 0) toast.success(`Imported ${total} location${total === 1 ? "" : "s"}`);
    } catch (e) {
      setError(getApiErrorMessage(e, "Import failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <Link
        href="/admin/locations"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to locations
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Import Locations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload an .xlsx file with one location per row. Use the template to
          see the expected columns and the Parent Code wiring pattern.
        </p>
      </header>

      {/* Step 1: Template download */}
      <section className="mb-4 rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Step 1 · Download template</p>
              <p className="text-xs text-muted-foreground">
                The .xlsx file has the required columns + an Instructions sheet.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={downloading}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 sm:self-auto"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Downloading…" : "Download template"}
          </button>
        </div>
      </section>

      {/* Step 2: Upload */}
      <section className="mb-4 rounded-lg border bg-card p-4">
        <p className="mb-3 text-sm font-medium">Step 2 · Upload your sheet</p>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center transition-colors hover:border-primary/40 hover:bg-accent/20",
            file && "border-primary/40 bg-accent/20",
          )}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          {file ? (
            <div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB · click to replace
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">
                Drop your .xlsx file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Max 5 MB · up to 500 rows
              </p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="mt-3 flex justify-end gap-2">
          {file && !submitting && (
            <button
              type="button"
              onClick={() => handleFile(null)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!file || submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Importing…" : "Import"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </section>

      {/* Step 3: Result */}
      {result && <ResultSection result={result} />}
    </div>
  );
}

// ── Result section ───────────────────────────────────────────────────

function ResultSection({ result }: { result: ImportResult }) {
  const hasParseErrors = result.parseErrors.length > 0;
  const totals = {
    created: result.created.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-sm font-medium">Result</p>

      {hasParseErrors ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              Sheet was rejected. Fix the {result.parseErrors.length} error
              {result.parseErrors.length === 1 ? "" : "s"} below and re-upload.
              <span className="ml-1 text-destructive/80">
                No rows were committed.
              </span>
            </p>
          </div>
          <ul className="divide-y rounded-md border bg-background">
            {result.parseErrors.map((e, i) => (
              <li key={i} className="px-3 py-2 text-xs">
                <span className="font-medium">Row {e.rowIndex}</span>
                {e.field && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="font-medium text-muted-foreground">
                      {e.field}
                    </span>
                  </>
                )}
                <span className="ml-1 text-muted-foreground">— {e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Bucket
              label="Created"
              count={totals.created}
              color="text-green-700"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <Bucket
              label="Skipped"
              count={totals.skipped}
              color="text-amber-700"
              icon={<AlertCircle className="h-4 w-4" />}
            />
            <Bucket
              label="Failed"
              count={totals.failed}
              color="text-destructive"
              icon={<AlertCircle className="h-4 w-4" />}
            />
          </div>

          {result.created.length > 0 && (
            <details className="mb-2 rounded-md border bg-background">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                Created ({result.created.length})
              </summary>
              <ul className="divide-y border-t text-xs">
                {result.created.slice(0, 50).map((r) => (
                  <li key={r.id} className="px-3 py-2">
                    <Link
                      href={`/admin/locations/${r.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {r.name}
                    </Link>
                    <span className="ml-2 text-muted-foreground">({r.code})</span>
                    <span className="ml-auto text-muted-foreground"> · row {r.rowIndex}</span>
                  </li>
                ))}
                {result.created.length > 50 && (
                  <li className="px-3 py-2 text-muted-foreground">
                    …and {result.created.length - 50} more
                  </li>
                )}
              </ul>
            </details>
          )}

          {result.skipped.length > 0 && (
            <details className="mb-2 rounded-md border bg-background">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                Skipped ({result.skipped.length})
              </summary>
              <ul className="divide-y border-t text-xs">
                {result.skipped.map((r, i) => (
                  <li key={i} className="px-3 py-2">
                    <span className="font-medium">Row {r.rowIndex}</span>
                    <span className="ml-1 text-muted-foreground">
                      ({r.code}) — {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {result.failed.length > 0 && (
            <details open className="rounded-md border border-destructive/30 bg-background">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-destructive">
                Failed ({result.failed.length})
              </summary>
              <ul className="divide-y border-t text-xs">
                {result.failed.map((r, i) => (
                  <li key={i} className="px-3 py-2">
                    <span className="font-medium">Row {r.rowIndex}</span>
                    <span className="ml-1 text-muted-foreground">
                      ({r.code}) — {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="mt-4 flex justify-end">
        <Link
          href="/admin/locations"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Back to locations
        </Link>
      </div>
    </section>
  );
}

function Bucket({
  label,
  count,
  color,
  icon,
}: {
  label: string;
  count: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className={cn("flex items-center gap-1.5", color)}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold">{count}</div>
    </div>
  );
}
