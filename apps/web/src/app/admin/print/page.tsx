"use client";

import { useCallback, useEffect, useState } from "react";
import api, { apiGetPaginated, apiDelete } from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { LabelTemplateItem, PrintJobItem } from "@/types/admin";
import LabelTemplateDialog from "@/components/shared/label-template-dialog";

// ── Status badge colors ────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  READY: "bg-green-100 text-green-800",
  PRINTED: "bg-gray-100 text-gray-800",
  FAILED: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {status}
    </span>
  );
}

// ── Date helpers ───────────────────────────────────────────────────
function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Tab type ───────────────────────────────────────────────────────
type Tab = "templates" | "printJobs";

// ── Page ───────────────────────────────────────────────────────────
export default function PrintPage() {
  const canManage = usePermission("labels:manage");
  const [activeTab, setActiveTab] = useState<Tab>("templates");

  // ── Templates state ────────────────────────────────────────────
  const [templates, setTemplates] = useState<LabelTemplateItem[]>([]);
  const [templatesMeta, setTemplatesMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesPage, setTemplatesPage] = useState(1);
  const [templatesSearch, setTemplatesSearch] = useState("");

  // ── Print jobs state ───────────────────────────────────────────
  const [printJobs, setPrintJobs] = useState<PrintJobItem[]>([]);
  const [printJobsMeta, setPrintJobsMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [printJobsLoading, setPrintJobsLoading] = useState(true);
  const [printJobsPage, setPrintJobsPage] = useState(1);

  // ── Dialog state ───────────────────────────────────────────────
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<LabelTemplateItem | null>(null);

  // ── Fetch templates ────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const params: Record<string, unknown> = {
        page: templatesPage,
        limit: 10,
      };
      if (templatesSearch.trim()) params.search = templatesSearch.trim();

      const result = await apiGetPaginated<LabelTemplateItem[]>(
        "/api/label-templates",
        params,
      );
      setTemplates(result.data);
      setTemplatesMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setTemplatesLoading(false);
    }
  }, [templatesPage, templatesSearch]);

  // ── Fetch print jobs ───────────────────────────────────────────
  const fetchPrintJobs = useCallback(async () => {
    setPrintJobsLoading(true);
    try {
      const params: Record<string, unknown> = {
        page: printJobsPage,
        limit: 10,
      };

      const result = await apiGetPaginated<PrintJobItem[]>(
        "/api/print-jobs",
        params,
      );
      setPrintJobs(result.data);
      setPrintJobsMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setPrintJobsLoading(false);
    }
  }, [printJobsPage]);

  useEffect(() => {
    if (activeTab === "templates") {
      void fetchTemplates();
    } else {
      void fetchPrintJobs();
    }
  }, [activeTab, fetchTemplates, fetchPrintJobs]);

  // ── Handlers ───────────────────────────────────────────────────
  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;
    try {
      await apiDelete(`/api/label-templates/${id}`);
      void fetchTemplates();
    } catch {
      // handle error
    }
  };

  const handleEditTemplate = (template: LabelTemplateItem) => {
    setEditingTemplate(template);
    setTemplateDialogOpen(true);
  };

  const handlePreview = async (id: string) => {
    try {
      // Need an asset to preview with — fetch first available asset
      const assetsRes = await apiGetPaginated<Array<{ id: string; name: string }>>(
        "/api/assets",
        { limit: 1 },
      );
      const firstAsset = assetsRes.data[0];
      if (!firstAsset) {
        alert("No assets available for preview");
        return;
      }
      // Fetch PDF as blob via authenticated request
      const res = await api.post(
        `/api/label-templates/${id}/preview`,
        { assetId: firstAsset.id },
        { responseType: "blob" },
      );
      const blob = new Blob([res.data as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch {
      alert("Failed to generate preview");
    }
  };

  const handleTemplatesSearchChange = (value: string) => {
    setTemplatesSearch(value);
    setTemplatesPage(1);
  };

  return (
    <div className="p-6" data-tour="label-printing">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Label Printing</h1>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setActiveTab("templates")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "templates"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Templates
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("printJobs")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "printJobs"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Print Jobs
        </button>
      </div>

      {/* ── Templates Tab ─────────────────────────────────────────── */}
      {activeTab === "templates" && (
        <>
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search templates..."
              value={templatesSearch}
              onChange={(e) => handleTemplatesSearchChange(e.target.value)}
              className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
            />
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateDialogOpen(true);
                }}
                className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add Template
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Paper Size
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Default</th>
                  <th className="px-4 py-3 text-left font-medium">Fields</th>
                  {canManage && (
                    <th className="px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {templatesLoading ? (
                  <tr>
                    <td
                      colSpan={canManage ? 5 : 4}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Loading templates...
                    </td>
                  </tr>
                ) : templates.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManage ? 5 : 4}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No templates found.
                    </td>
                  </tr>
                ) : (
                  templates.map((template) => (
                    <tr
                      key={template.id}
                      className="border-b last:border-b-0"
                    >
                      <td className="px-4 py-3 font-medium">
                        {template.name}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {template.paperWidthMm} x {template.paperHeightMm} mm
                      </td>
                      <td className="px-4 py-3">
                        {template.isDefault ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Default
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            -
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {template.fields.length}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handlePreview(template.id)}
                              className="rounded px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditTemplate(template)}
                              className="rounded px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteTemplate(template.id)
                              }
                              className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {templatesMeta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Showing page {templatesMeta.page} of{" "}
                {templatesMeta.totalPages} ({templatesMeta.total} total)
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={templatesPage <= 1}
                  onClick={() =>
                    setTemplatesPage((p) => Math.max(1, p - 1))
                  }
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={templatesPage >= templatesMeta.totalPages}
                  onClick={() => setTemplatesPage((p) => p + 1)}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Print Jobs Tab ────────────────────────────────────────── */}
      {activeTab === "printJobs" && (
        <>
          {/* Table */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Template</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Copies</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {printJobsLoading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Loading print jobs...
                    </td>
                  </tr>
                ) : printJobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No print jobs found.
                    </td>
                  </tr>
                ) : (
                  printJobs.map((job) => (
                    <tr key={job.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium">
                        {job.labelTemplate.name}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {job.copiesPerAsset}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDateTime(job.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        {job.pdfUrl ? (
                          <a
                            href={`${process.env.NEXT_PUBLIC_API_URL}${job.pdfUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-700 hover:underline"
                          >
                            Download PDF
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            -
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {printJobsMeta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Showing page {printJobsMeta.page} of{" "}
                {printJobsMeta.totalPages} ({printJobsMeta.total} total)
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={printJobsPage <= 1}
                  onClick={() =>
                    setPrintJobsPage((p) => Math.max(1, p - 1))
                  }
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={printJobsPage >= printJobsMeta.totalPages}
                  onClick={() => setPrintJobsPage((p) => p + 1)}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────── */}
      <LabelTemplateDialog
        open={templateDialogOpen}
        onClose={() => {
          setTemplateDialogOpen(false);
          setEditingTemplate(null);
        }}
        onSaved={() => void fetchTemplates()}
        template={editingTemplate}
      />
    </div>
  );
}
