"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGetPaginated, type PaginationMeta } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatDateTime, INSPECTION_REASON_LABEL, INSPECTION_RESULT_LABEL } from "@/lib/sms/labels";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import { InspectionQueueResultDialog } from "@/components/sms/inspection-queue-result-dialog";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import { cn } from "@/lib/utils";
import type { InspectionRow } from "@/lib/sms/shipments-types";

type ResultFilter = "PENDING" | "PASSED" | "FAILED" | "ALL";

const RESULT_FILTER_TABS: Array<{ value: ResultFilter; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "PASSED", label: "Passed" },
  { value: "FAILED", label: "Failed" },
  { value: "ALL", label: "All" },
];

const RESULT_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  PASSED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800",
};

function InspectionsInner() {
  const { showroom, can } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlResult = searchParams.get("result");
  const initFilter: ResultFilter =
    urlResult === "PASSED" || urlResult === "FAILED" || urlResult === "ALL"
      ? urlResult
      : "PENDING";

  const [resultFilter, setResultFilter] = useState<ResultFilter>(initFilter);
  const [page, setPage] = useState(1);

  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recordDialog, setRecordDialog] = useState<InspectionRow | null>(null);

  const canManage = can(SMS_PERMISSIONS.INSPECTIONS_MANAGE);

  const load = useCallback(async () => {
    if (!showroom) return;
    setLoading(true);
    setError(null);
    try {
      const { data, meta: m } = await apiGetPaginated<InspectionRow[]>(
        "/api/sms/inspections",
        {
          showroomId: showroom.id,
          result: resultFilter !== "ALL" ? resultFilter : undefined,
          page,
          limit: 20,
        },
      );
      setInspections(data);
      setMeta(m);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load inspections."));
    } finally {
      setLoading(false);
    }
  }, [showroom, resultFilter, page]);

  useEffect(() => { void load(); }, [load]);

  // Update URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (resultFilter !== "PENDING") params.set("result", resultFilter);
    if (page > 1) params.set("page", String(page));
    router.replace(`/admin/sms/inspections?${params.toString()}`, { scroll: false });
  }, [resultFilter, page, router]);

  const handleResultSaved = () => {
    setRecordDialog(null);
    void load();
  };

  return (
    <div className="p-4 md:p-6" data-tour="sms-inspections-page">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">Inspections</h1>
          <ShowroomSwitcher />
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4">
        <div
          role="tablist"
          aria-label="Filter by result"
          className="inline-flex rounded-md border bg-card p-0.5"
        >
          {RESULT_FILTER_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={resultFilter === t.value}
              onClick={() => { setResultFilter(t.value); setPage(1); }}
              className={cn(
                "rounded-sm px-3 py-1 text-xs font-medium",
                resultFilter === t.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && inspections.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm font-medium">No inspections</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {resultFilter === "PENDING"
              ? "No units are currently pending inspection at this showroom."
              : "No inspections match the selected filter."}
          </p>
        </div>
      )}

      {/* Table — desktop */}
      {!loading && inspections.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium">VIN</th>
                  <th className="px-4 py-3 text-left font-medium">Variant</th>
                  <th className="px-4 py-3 text-left font-medium">Reason</th>
                  <th className="px-4 py-3 text-left font-medium">Result</th>
                  <th className="px-4 py-3 text-left font-medium">Condition</th>
                  <th className="px-4 py-3 text-left font-medium">Opened</th>
                  <th className="px-4 py-3 text-left font-medium">Inspector</th>
                  {canManage && <th className="px-4 py-3 text-right font-medium">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {inspections.map((insp) => (
                  <tr key={insp.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/sms/units/${insp.unitId}`}
                        className="font-mono text-sm text-primary hover:underline break-all"
                      >
                        {insp.unit.vin}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {insp.unit.variant.modelName} · {insp.unit.variant.variantName} · {insp.unit.variant.color}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {INSPECTION_REASON_LABEL[insp.reason] ?? insp.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          RESULT_STYLE[insp.result] ?? "bg-slate-100 text-slate-700",
                        )}
                      >
                        {INSPECTION_RESULT_LABEL[insp.result] ?? insp.result}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {insp.condition ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {formatDateTime(insp.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {insp.inspector?.name ?? "—"}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        {insp.result === "PENDING" && (
                          <button
                            type="button"
                            data-tour="sms-inspection-record"
                            onClick={() => setRecordDialog(insp)}
                            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent min-h-[36px]"
                          >
                            Record result
                          </button>
                        )}
                        {insp.result !== "PENDING" && (
                          <Link
                            href={`/admin/sms/units/${insp.unitId}`}
                            className="text-xs text-primary hover:underline"
                          >
                            View unit
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards — mobile */}
          <div className="space-y-3 md:hidden">
            {inspections.map((insp) => (
              <div key={insp.id} className="rounded-lg border bg-card p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/admin/sms/units/${insp.unitId}`}
                      className="font-mono text-sm font-medium text-primary hover:underline break-all"
                    >
                      {insp.unit.vin}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {insp.unit.variant.modelName} · {insp.unit.variant.variantName} · {insp.unit.variant.color}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      RESULT_STYLE[insp.result] ?? "bg-slate-100 text-slate-700",
                    )}
                  >
                    {INSPECTION_RESULT_LABEL[insp.result] ?? insp.result}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{INSPECTION_REASON_LABEL[insp.reason] ?? insp.reason}</span>
                  {insp.condition && <span>{insp.condition}</span>}
                  {insp.inspector && <span>{insp.inspector.name}</span>}
                  <span>{formatDateTime(insp.createdAt)}</span>
                </div>
                {canManage && insp.result === "PENDING" && (
                  <button
                    type="button"
                    data-tour="sms-inspection-record-mobile"
                    onClick={() => setRecordDialog(insp)}
                    className="mt-3 w-full rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent min-h-[36px]"
                  >
                    Record result
                  </button>
                )}
                {insp.result !== "PENDING" && (
                  <Link
                    href={`/admin/sms/units/${insp.unitId}`}
                    className="mt-2 block text-xs text-primary hover:underline"
                  >
                    View unit →
                  </Link>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Page {meta.page} of {meta.totalPages} · {meta.total} inspections
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={meta.page >= meta.totalPages}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Record result dialog */}
      {recordDialog && (
        <InspectionQueueResultDialog
          inspection={recordDialog}
          onClose={() => setRecordDialog(null)}
          onSuccess={handleResultSaved}
        />
      )}
    </div>
  );
}

export default function InspectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 md:p-6">
          <div className="mb-4 h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      }
    >
      <InspectionsInner />
    </Suspense>
  );
}
