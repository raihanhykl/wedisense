"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { apiGetPaginated, apiPost, apiDelete } from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { ReportItem, ReportStatus, ReportType } from "@/types/admin";

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
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700",
      )}
    >
      {status}
    </span>
  );
}

// ── Type badge ──────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  ASSET_LIST: "bg-blue-100 text-blue-800",
  MOVEMENT: "bg-purple-100 text-purple-800",
  MAINTENANCE: "bg-orange-100 text-orange-800",
  DEPRECIATION: "bg-yellow-100 text-yellow-800",
  AUDIT: "bg-red-100 text-red-800",
  CUSTOM: "bg-gray-100 text-gray-800",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        TYPE_COLORS[type] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

// ── Report type filter options ──────────────────────────────────────
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All Types" },
  { value: "ASSET_LIST", label: "Asset List" },
  { value: "MOVEMENT", label: "Movement" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "DEPRECIATION", label: "Depreciation" },
  { value: "AUDIT", label: "Audit" },
  { value: "CUSTOM", label: "Custom" },
];

// ── Polling logic ───────────────────────────────────────────────────
const MAX_POLLS = 30;
const POLL_INTERVAL_MS = 3000;

// ── Page ────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const canGenerate = usePermission("reports:generate");

  const [reports, setReports] = useState<ReportItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");

  // Per-report generate state: reportId -> { loading, error }
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [generateErrors, setGenerateErrors] = useState<Record<string, string>>({});

  // Per-report download state
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // Polling refs: map of reportId -> pollCount
  const pollCountRef = useRef<Record<string, number>>({});
  const pollTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, unknown> = { page, limit: 10 };
      if (typeFilter) params.type = typeFilter as ReportType;

      const result = await apiGetPaginated<ReportItem[]>("/api/reports", params);
      setReports(result.data);
      setMeta(result.meta);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Failed to load reports."));
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  // Cleanup poll timers on unmount
  useEffect(() => {
    const timers = pollTimerRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const updateReportInList = (id: string, patch: Partial<ReportItem>) => {
    setReports((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  // ── Poll a single report until READY/FAILED or max polls ───────────
  const pollReport = useCallback((id: string) => {
    const count = (pollCountRef.current[id] ?? 0) + 1;
    pollCountRef.current[id] = count;

    if (count > MAX_POLLS) {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setGenerateErrors((prev) => ({
        ...prev,
        [id]: "Timeout: report generation took too long. Please refresh.",
      }));
      return;
    }

    pollTimerRef.current[id] = setTimeout(async () => {
      try {
        const response = await api.get<{
          success: boolean;
          data: ReportItem;
        }>(`/api/reports/${id}`);
        const updated = response.data.data;
        updateReportInList(id, updated);

        if (updated.status === "READY" || updated.status === "FAILED") {
          setGeneratingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          if (updated.status === "FAILED") {
            setGenerateErrors((prev) => ({
              ...prev,
              [id]: "Report generation failed.",
            }));
          }
        } else {
          pollReport(id);
        }
      } catch {
        pollReport(id);
      }
    }, POLL_INTERVAL_MS);
  }, []);

  // ── Generate a report ─────────────────────────────────────────────
  const handleGenerate = async (id: string) => {
    setGeneratingIds((prev) => new Set(prev).add(id));
    setGenerateErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    pollCountRef.current[id] = 0;

    try {
      await apiPost<ReportItem>(`/api/reports/${id}/generate`);
      updateReportInList(id, { status: "GENERATING" });
      pollReport(id);
    } catch (err: unknown) {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setGenerateErrors((prev) => ({
        ...prev,
        [id]: getApiErrorMessage(err, "Failed to start generation."),
      }));
    }
  };

  // ── Download a report ─────────────────────────────────────────────
  const handleDownload = async (id: string) => {
    setDownloadingIds((prev) => new Set(prev).add(id));
    try {
      const response = await api.get<Blob>(`/api/reports/${id}/download`, {
        responseType: "blob",
      });
      const report = reports.find((r) => r.id === id);
      // Derive extension from the response Content-Type — server is
      // authoritative on format, not the client.
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
      setGenerateErrors((prev) => ({
        ...prev,
        [id]: getApiErrorMessage(err, "Download failed."),
      }));
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // ── Delete a report ───────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this report?")) return;
    try {
      await apiDelete<ReportItem>(`/api/reports/${id}`);
      void fetchReports();
    } catch (err: unknown) {
      setGenerateErrors((prev) => ({
        ...prev,
        [id]: getApiErrorMessage(err, "Delete failed."),
      }));
    }
  };

  const handleTypeChange = (value: string) => {
    setTypeFilter(value);
    setPage(1);
  };

  return (
    <div className="p-6" data-tour="reports-list">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        {canGenerate && (
          <Link
            href="/admin/reports/new"
            data-tour="create-report-btn"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create Report
          </Link>
        )}
      </div>

      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="report-type-filter"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Last Generated</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading reports...
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No reports found.
                </td>
              </tr>
            ) : (
              reports.map((report) => {
                const isGenerating =
                  generatingIds.has(report.id) || report.status === "GENERATING";
                const genError = generateErrors[report.id];
                const isDownloading = downloadingIds.has(report.id);

                return (
                  <tr key={report.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/reports/${report.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {report.name}
                      </Link>
                      {genError && (
                        <p className="mt-0.5 text-xs text-destructive">{genError}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={report.type} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={report.status} />
                        {isGenerating && (
                          <svg
                            className="h-3.5 w-3.5 animate-spin text-yellow-600"
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
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {report.lastGeneratedAt
                        ? new Date(report.lastGeneratedAt).toLocaleString("id-ID")
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canGenerate && (
                          <button
                            type="button"
                            onClick={() => void handleGenerate(report.id)}
                            disabled={isGenerating}
                            data-tour="generate-report-btn"
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                          >
                            {isGenerating ? "Generating..." : "Generate"}
                          </button>
                        )}
                        {report.status === "READY" && (
                          <button
                            type="button"
                            onClick={() => void handleDownload(report.id)}
                            disabled={isDownloading}
                            data-tour="download-report-btn"
                            className="rounded px-2 py-1 text-xs text-primary hover:bg-accent disabled:opacity-50"
                          >
                            {isDownloading ? "Downloading..." : "Download"}
                          </button>
                        )}
                        <Link
                          href={`/admin/reports/${report.id}`}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          View
                        </Link>
                        {canGenerate && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(report.id)}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing page {meta.page} of {meta.totalPages} ({meta.total} total)
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
