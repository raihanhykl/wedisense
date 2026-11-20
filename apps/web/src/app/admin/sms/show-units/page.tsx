"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetPaginated, type PaginationMeta } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatDate, formatDateTime } from "@/lib/sms/labels";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import { ReturnShowUnitDialog } from "@/components/sms/show-units/return-show-unit-dialog";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import { cn } from "@/lib/utils";
import type { ShowLoanRow } from "@/lib/sms/show-loans-types";

type StatusFilter = "out" | "overdue" | "returned" | "all";

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "out", label: "Out" },
  { value: "overdue", label: "Overdue" },
  { value: "returned", label: "Returned" },
  { value: "all", label: "All" },
];

// ── Overdue badge ──────────────────────────────────────────────────────

function OverdueBadge({ days }: { days: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
      Overdue · {days}d
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────

function ShowLoanStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OUT: "bg-cyan-100 text-cyan-800",
    OVERDUE: "bg-red-100 text-red-800",
    RETURNED: "bg-slate-100 text-slate-700",
  };
  const labels: Record<string, string> = {
    OUT: "Out",
    OVERDUE: "Overdue",
    RETURNED: "Returned",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        styles[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ── Inner component (uses useSearchParams) ────────────────────────────

function ShowUnitsInner() {
  const { showroom, can } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlStatus = searchParams.get("status") as StatusFilter | null;
  const initFilter: StatusFilter =
    urlStatus === "out" || urlStatus === "overdue" || urlStatus === "returned" || urlStatus === "all"
      ? urlStatus
      : "out";

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initFilter);
  const [page, setPage] = useState(1);
  const [loans, setLoans] = useState<ShowLoanRow[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returnDialog, setReturnDialog] = useState<ShowLoanRow | null>(null);

  const canManage = can(SMS_PERMISSIONS.SHOW_UNITS_MANAGE);

  const load = useCallback(async () => {
    if (!showroom) return;
    setLoading(true);
    setError(null);
    try {
      const { data, meta: m } = await apiGetPaginated<ShowLoanRow[]>(
        "/api/sms/show-loans",
        {
          showroomId: showroom.id,
          status: statusFilter !== "all" ? statusFilter : undefined,
          page,
          limit: 20,
        },
      );
      setLoans(data);
      setMeta(m);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load show loans."));
    } finally {
      setLoading(false);
    }
  }, [showroom, statusFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Update URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "out") params.set("status", statusFilter);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.replace(`/admin/sms/show-units${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [statusFilter, page, router]);

  const handleTabChange = (val: StatusFilter) => {
    setStatusFilter(val);
    setPage(1);
  };

  const handleReturnSuccess = () => {
    setReturnDialog(null);
    void load();
  };

  if (!showroom) return null;

  return (
    <div className="p-4 md:p-6" data-tour="sms-show-units-list">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Show Units</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Units currently dispatched to show events or recently returned.
          </p>
        </div>
        <ShowroomSwitcher />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleTabChange(tab.value)}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              statusFilter === tab.value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Mobile cards */}
      {loading ? (
        <div className="space-y-3 md:hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : loans.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground md:hidden">
          No show loans found for this filter.
        </div>
      ) : (
        <div className="space-y-3 md:hidden">
          {loans.map((loan) => (
            <div key={loan.id} className="rounded-lg border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/admin/sms/units/${loan.unitId}`}
                    className="font-mono font-medium text-primary hover:underline"
                  >
                    {loan.unit.vin}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {loan.unit.variant.modelName} · {loan.unit.variant.variantName} · {loan.unit.variant.color}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {loan.overdue && loan.daysOverdue > 0 ? (
                    <OverdueBadge days={loan.daysOverdue} />
                  ) : (
                    <ShowLoanStatusBadge status={loan.status} />
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">{loan.eventName}</span>
                  {" — "}
                  {loan.eventLocation}
                </div>
                {loan.pic && <div>PIC: {loan.pic.name}</div>}
                <div>Dispatched: {formatDateTime(loan.dispatchedAt)}</div>
                <div>Planned return: {formatDate(loan.expectedReturnDate)}</div>
                {loan.returnedAt && <div>Returned: {formatDateTime(loan.returnedAt)}</div>}
              </div>
              {canManage && !loan.returnedAt && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnDialog(loan)}
                    data-tour="sms-unit-record-show-return"
                    className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    Record return
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">VIN</th>
              <th className="px-4 py-3 text-left font-medium">Model / Variant / Colour</th>
              <th className="px-4 py-3 text-left font-medium">Event</th>
              <th className="px-4 py-3 text-left font-medium">PIC</th>
              <th className="px-4 py-3 text-left font-medium">Dispatched</th>
              <th className="px-4 py-3 text-left font-medium">Planned return</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              {canManage && <th className="px-4 py-3 text-right font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: canManage ? 8 : 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : loans.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">
                  No show loans found for this filter.
                </td>
              </tr>
            ) : (
              loans.map((loan) => (
                <tr key={loan.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/sms/units/${loan.unitId}`}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {loan.unit.vin}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {loan.unit.variant.modelName} · {loan.unit.variant.variantName} · {loan.unit.variant.color}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{loan.eventName}</div>
                    <div className="text-xs text-muted-foreground">{loan.eventLocation}</div>
                  </td>
                  <td className="px-4 py-3">{loan.pic?.name ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(loan.dispatchedAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(loan.expectedReturnDate)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {loan.overdue && loan.daysOverdue > 0 ? (
                        <OverdueBadge days={loan.daysOverdue} />
                      ) : (
                        <ShowLoanStatusBadge status={loan.status} />
                      )}
                      {loan.returnedAt && (
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(loan.returnedAt)}
                        </span>
                      )}
                    </div>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      {!loan.returnedAt && (
                        <button
                          type="button"
                          onClick={() => setReturnDialog(loan)}
                          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                        >
                          Record return
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            {meta.total} loan{meta.total !== 1 ? "s" : ""} · page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={meta.page >= meta.totalPages}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Return dialog */}
      {returnDialog && (
        <ReturnShowUnitDialog
          loanId={returnDialog.id}
          unitVin={returnDialog.unit.vin}
          onClose={() => setReturnDialog(null)}
          onSuccess={handleReturnSuccess}
        />
      )}
    </div>
  );
}

// ── Page wrapper (Suspense for useSearchParams) ────────────────────────

export default function ShowUnitsPage() {
  return (
    <Suspense>
      <ShowUnitsInner />
    </Suspense>
  );
}
