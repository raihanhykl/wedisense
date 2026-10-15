"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileCheck2, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import Breadcrumb from "@/components/shared/breadcrumb";
import { apiGetPaginated } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import {
  HANDOVER_STATUS_CLASSES,
  HANDOVER_STATUS_LABELS,
  HANDOVER_TYPE_LABELS,
  formatHandoverDate,
} from "@/lib/handover";
import type {
  HandoverFormListItem,
  HandoverFormStatus,
  HandoverType,
} from "@/types/admin";
import type { PaginationMeta } from "@/lib/api";

const STATUSES: HandoverFormStatus[] = ["DRAFT", "ISSUED", "SIGNED", "CANCELLED"];
const TYPES: HandoverType[] = [
  "COMPANY_TO_EMPLOYEE",
  "EMPLOYEE_TO_EMPLOYEE",
  "EMPLOYEE_TO_COMPANY",
];

function HandoverFormsContent() {
  const canCreate = usePermission("handover-forms:create");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const [forms, setForms] = useState<HandoverFormListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const fetchForms = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 20 };
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.handoverType = typeFilter;
      const result = await apiGetPaginated<HandoverFormListItem[]>(
        "/api/handover-forms",
        params,
      );
      setForms(result.data);
      setMeta(result.meta);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load handover forms"));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, typeFilter]);

  useEffect(() => {
    void fetchForms();
  }, [fetchForms]);

  const hasFilters = Boolean(search.trim() || statusFilter || typeFilter);

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Handover Forms" }]} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Handover Forms</h1>
          <p className="text-sm text-muted-foreground">
            Berita Acara Serah Terima — the printed, signed record behind asset
            movements. Fill one in, download the PDF, collect signatures, scan
            it back, then cite it when recording the movement.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/admin/handover-forms/new"
            data-tour="handover-forms-create"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New form
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search form number, purpose, employee, asset…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {HANDOVER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {HANDOVER_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Form number</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Parties</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Assets</th>
              <th className="px-4 py-3 text-right font-medium">Movements</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : forms.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {hasFilters
                    ? "No handover forms match the current filters."
                    : "No handover forms yet. Create one before your next asset handover."}
                </td>
              </tr>
            ) : (
              forms.map((form) => (
                <tr key={form.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/handover-forms/${form.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {form.formNumber}
                    </Link>
                    {form.purpose && (
                      <div className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                        {form.purpose}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {HANDOVER_TYPE_LABELS[form.handoverType]}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{form.fromUser?.name ?? <span className="text-muted-foreground">Company</span>}</div>
                    <div className="text-muted-foreground">
                      → {form.toUser?.name ?? "Company"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{formatHandoverDate(form.handoverDate)}</td>
                  <td className="px-4 py-3 text-right">{form._count.items}</td>
                  <td className="px-4 py-3 text-right">
                    {form._count.movements > 0 ? (
                      form._count.movements
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${HANDOVER_STATUS_CLASSES[form.status]}`}
                    >
                      {form.status === "SIGNED" && <FileCheck2 className="h-3 w-3" />}
                      {HANDOVER_STATUS_LABELS[form.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} · {meta.total} form
            {meta.total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HandoverFormsPage() {
  return (
    <ProtectedRoute>
      <HandoverFormsContent />
    </ProtectedRoute>
  );
}
