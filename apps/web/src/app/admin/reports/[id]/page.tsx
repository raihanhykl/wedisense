"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { apiPost, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { ReportItem, ReportStatus } from "@/types/admin";

// ── Status badge ────────────────────────────────────────────────────
const STATUS_COLORS: Record<ReportStatus, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  GENERATING: "bg-yellow-100 text-yellow-800",
  READY: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700",
      )}
    >
      {status}
    </span>
  );
}

// ── Constants ────────────────────────────────────────────────────────
const MAX_POLLS = 30;
const POLL_INTERVAL_MS = 3000;

// ── Page ────────────────────────────────────────────────────────────
export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reportId = params.id;

  const canGenerate = usePermission("reports:generate");

  const [report, setReport] = useState<ReportItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      const response = await api.get<{ success: boolean; data: ReportItem }>(
        `/api/reports/${reportId}`,
      );
      setReport(response.data.data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Failed to load report."));
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void fetchReport();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [fetchReport]);

  // ── Poll until status is terminal ─────────────────────────────────
  const pollStatus = useCallback(() => {
    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLLS) {
      setGenerating(false);
      setGenerateError("Timeout: generation is taking too long. Refresh to check status.");
      return;
    }

    pollTimerRef.current = setTimeout(async () => {
      try {
        const response = await api.get<{ success: boolean; data: ReportItem }>(
          `/api/reports/${reportId}`,
        );
        const updated = response.data.data;
        setReport(updated);

        if (updated.status === "READY" || updated.status === "FAILED") {
          setGenerating(false);
          if (updated.status === "FAILED") {
            setGenerateError("Report generation failed.");
          }
        } else {
          pollStatus();
        }
      } catch {
        pollStatus();
      }
    }, POLL_INTERVAL_MS);
  }, [reportId]);

  // ── Generate ──────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError("");
    pollCountRef.current = 0;

    try {
      await apiPost<ReportItem>(`/api/reports/${reportId}/generate`);
      setReport((prev) => (prev ? { ...prev, status: "GENERATING" } : prev));
      pollStatus();
    } catch (err: unknown) {
      setGenerating(false);
      setGenerateError(getApiErrorMessage(err, "Failed to start generation."));
    }
  };

  // ── Download ──────────────────────────────────────────────────────
  const handleDownload = async () => {
    setDownloading(true);
    setGenerateError("");
    try {
      const response = await api.get<Blob>(`/api/reports/${reportId}/download`, {
        responseType: "blob",
      });
      // Derive extension from server's Content-Type, not from a UI guess.
      const contentType = response.headers["content-type"] as string | undefined;
      const ext = contentType?.includes("pdf") ? "pdf" : "xlsx";
      const blobUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${report?.name ?? "report"}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setGenerateError(getApiErrorMessage(err, "Download failed."));
    } finally {
      setDownloading(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirm("Delete this report? This action cannot be undone.")) return;
    setDeleting(true);
    try {
      await apiDelete<ReportItem>(`/api/reports/${reportId}`);
      router.push("/admin/reports");
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Failed to delete report."));
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-center text-muted-foreground">Loading report...</div>
    );
  }

  if (error && !report) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
        <Link
          href="/admin/reports"
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          Back to Reports
        </Link>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="p-6" data-tour="report-detail">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/admin/reports"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Reports
          </Link>
          <span className="mx-2 text-muted-foreground">/</span>
          <span className="text-sm font-medium">{report.name}</span>
        </div>
        <div className="flex gap-2">
          {canGenerate && (
            <Link
              href={`/admin/reports/new?edit=${report.id}`}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Edit
            </Link>
          )}
          {canGenerate && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      </div>

      {/* Report card */}
      <div className="mb-6 rounded-lg border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{report.name}</h1>
            <p className="text-sm text-muted-foreground">
              Created by {report.createdBy?.name ?? "—"} on{" "}
              {new Date(report.createdAt).toLocaleDateString("id-ID")}
            </p>
          </div>
          <StatusBadge status={report.status} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="font-medium">{report.type.replace(/_/g, " ")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Schedule</p>
            <p className="font-medium">{report.schedule ?? "None"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last Generated</p>
            <p className="font-medium">
              {report.lastGeneratedAt
                ? new Date(report.lastGeneratedAt).toLocaleString("id-ID")
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Format</p>
            <p className="font-medium">
              {(report.parameters?.format as string | undefined) ?? "-"}
            </p>
          </div>
        </div>

        {/* Parameters */}
        {report.parameters && Object.keys(report.parameters).length > 0 && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Parameters</p>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
              {JSON.stringify(report.parameters, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Error banner */}
      {(error || generateError) && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || generateError}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {canGenerate && (
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            data-tour="report-detail-generate-btn"
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {generating && (
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {generating ? "Generating..." : "Generate Report"}
          </button>
        )}

        {report.status === "READY" && (
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            data-tour="report-detail-download-btn"
            className="rounded-md border px-4 py-2 text-sm font-medium text-primary hover:bg-accent disabled:opacity-50"
          >
            {downloading ? "Downloading..." : "Download"}
          </button>
        )}
      </div>

      {/* Generating notice */}
      {generating && (
        <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Report generation is in progress. This page will update automatically
          when the report is ready.
        </div>
      )}
    </div>
  );
}
