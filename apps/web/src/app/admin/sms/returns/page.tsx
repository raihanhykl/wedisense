"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetPaginated, type PaginationMeta } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatDateTime } from "@/lib/sms/labels";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import { DecideReturnDialog } from "@/components/sms/returns/decide-return-dialog";
import { CustodyArrivalDialog } from "@/components/sms/returns/custody-arrival-dialog";
import { OfficialReceiptDialog } from "@/components/sms/returns/official-receipt-dialog";
import { HandBackDialog } from "@/components/sms/returns/hand-back-dialog";
import { NewReturnRequestDialog } from "@/components/sms/returns/new-return-request-dialog";
import type {
  ReturnRequestRow,
  ReturnRequestListDirection,
  ReturnRequestListStatus,
} from "@/lib/sms/returns-types";

// ── Status badge ───────────────────────────────────────────────────────

const DISPLAY_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  APPROVED_IN_CUSTODY: "Approved · In custody",
  REJECTED: "Rejected",
  REJECTED_IN_CUSTODY: "Rejected · Custody held",
  COMPLETED: "Completed",
};

const DISPLAY_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  APPROVED_IN_CUSTODY: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
  REJECTED_IN_CUSTODY: "bg-red-100 text-red-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        DISPLAY_STATUS_STYLE[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {DISPLAY_STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Tab type ──────────────────────────────────────────────────────────

type TabKey = "to-decide" | "our-requests" | "custody" | "closed";

const TAB_LABELS: Record<TabKey, string> = {
  "to-decide": "To decide",
  "our-requests": "Our requests",
  custody: "Custody held",
  closed: "Closed",
};

function tabToParams(
  tab: TabKey,
  showroomId: string,
): { direction: ReturnRequestListDirection; status: ReturnRequestListStatus; showroomId: string } {
  switch (tab) {
    case "to-decide":
      return { direction: "incoming", status: "pending", showroomId };
    case "our-requests":
      return { direction: "outgoing", status: "all", showroomId };
    case "custody":
      return { direction: "outgoing", status: "rejected_custody", showroomId };
    case "closed":
      return { direction: "all", status: "closed", showroomId };
  }
}

// ── Row actions ───────────────────────────────────────────────────────

type DialogKind =
  | { type: "decide"; request: ReturnRequestRow }
  | { type: "custody"; request: ReturnRequestRow }
  | { type: "receipt"; request: ReturnRequestRow }
  | { type: "handback"; request: ReturnRequestRow }
  | { type: "new" };

// ── Row card (mobile) ────────────────────────────────────────────────

function ReturnCard({
  row,
  showroomId,
  canDecide,
  canReceive,
  onAction,
}: {
  row: ReturnRequestRow;
  showroomId: string;
  canDecide: boolean;
  canReceive: boolean;
  onAction: (d: DialogKind) => void;
}) {
  const isIncoming = row.fromShowroomId === showroomId;
  const isOutgoing = row.toShowroomId === showroomId;
  const ds = row.displayStatus;

  const daysAgo = Math.floor(
    (Date.now() - new Date(row.requestedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  return (
    <div
      className={`rounded-lg border bg-card p-3 text-sm ${
        ds === "REJECTED_IN_CUSTODY" ? "border-red-200 bg-red-50" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="whitespace-nowrap font-mono font-medium">{row.requestNumber}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{row.unit.vin}</span>
        </div>
        <StatusBadge status={ds} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {row.unit.variant.modelName} · {row.unit.variant.variantName} · {row.unit.variant.color}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {row.fromShowroom.name}
        <span className="mx-1">→</span>
        {row.toShowroom.name}
      </div>
      {row.customerName && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          Customer: {row.customerName}
        </div>
      )}
      <div className="mt-0.5 text-xs text-muted-foreground">{daysAgo}d ago</div>

      {/* Actions */}
      <div className="mt-2 flex flex-wrap gap-2">
        {isIncoming && canDecide && ds === "PENDING" && (
          <button
            type="button"
            onClick={() => onAction({ type: "decide", request: row })}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Decide
          </button>
        )}
        {isOutgoing && canReceive && ds === "PENDING" && !row.custodyReceivedAt && (
          <button
            type="button"
            onClick={() => onAction({ type: "custody", request: row })}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Record arrival
          </button>
        )}
        {isOutgoing &&
          canReceive &&
          (ds === "APPROVED" || ds === "APPROVED_IN_CUSTODY") && (
            <button
              type="button"
              onClick={() => onAction({ type: "receipt", request: row })}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Official receipt
            </button>
          )}
        {isOutgoing && canReceive && ds === "REJECTED_IN_CUSTODY" && (
          <button
            type="button"
            onClick={() => onAction({ type: "handback", request: row })}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            Hand back to rider
          </button>
        )}
        <Link
          href={`/admin/sms/units/${row.unitId}`}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          VIN card
        </Link>
      </div>
    </div>
  );
}

// ── Main page content ─────────────────────────────────────────────────

function ReturnsPageInner() {
  const { showroom, can } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlTab = (searchParams.get("tab") ?? "to-decide") as TabKey;
  const urlPage = Number(searchParams.get("page") ?? "1");

  const [activeTab, setActiveTab] = useState<TabKey>(urlTab);
  const [page, setPage] = useState(urlPage > 0 ? urlPage : 1);
  const [rows, setRows] = useState<ReturnRequestRow[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  const canDecide = can("sms-returns:decide");
  const canReceive = can("sms-receiving:manage");
  const canRequest = can("sms-returns:request");

  const pushUrl = useCallback(
    (tab: TabKey, p: number, sid: string) => {
      const qs = new URLSearchParams();
      qs.set("tab", tab);
      if (p > 1) qs.set("page", String(p));
      qs.set("showroomId", sid);
      router.replace(`?${qs.toString()}`, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (!showroom) return;
    pushUrl(activeTab, page, showroom.id);
  }, [activeTab, page, showroom, pushUrl]);

  const fetchRows = useCallback(async () => {
    if (!showroom) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        ...tabToParams(activeTab, showroom.id),
        page,
        limit: 20,
      };
      const result = await apiGetPaginated<ReturnRequestRow[]>("/api/sms/return-requests", params);
      setRows(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load return requests."));
    } finally {
      setLoading(false);
    }
  }, [showroom, activeTab, page]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const handleActionSuccess = () => {
    setDialog(null);
    void fetchRows();
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setPage(1);
  };

  if (!showroom) return null;

  return (
    <div className="p-4 md:p-6" data-tour="sms-returns-page">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Returns</h1>
            <ShowroomSwitcher />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Cross-branch RTO return requests</p>
        </div>
        {canRequest && (
          <button
            type="button"
            onClick={() => setDialog({ type: "new" })}
            data-tour="sms-returns-new-request"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New request
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex overflow-x-auto rounded-lg border bg-card">
        {(["to-decide", "our-requests", "custody", "closed"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            } ${tab === "custody" && activeTab !== "custody" ? "text-red-600 hover:text-red-700" : ""}`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)
        ) : rows.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No return requests in this category.
          </div>
        ) : (
          rows.map((row) => (
            <ReturnCard
              key={row.id}
              row={row}
              showroomId={showroom.id}
              canDecide={canDecide}
              canReceive={canReceive}
              onAction={setDialog}
            />
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Request #</th>
              <th className="px-4 py-3 text-left font-medium">VIN</th>
              <th className="px-4 py-3 text-left font-medium">Route</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Requested</th>
              <th className="px-4 py-3 text-left font-medium">Custody</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No return requests in this category.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isIncoming = row.fromShowroomId === showroom.id;
                const isOutgoing = row.toShowroomId === showroom.id;
                const ds = row.displayStatus;
                return (
                  <tr
                    key={row.id}
                    className={`border-b last:border-b-0 hover:bg-muted/30 ${
                      ds === "REJECTED_IN_CUSTODY" ? "bg-red-50/50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="whitespace-nowrap font-mono font-medium">{row.requestNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/sms/units/${row.unitId}`}
                        className="font-mono text-primary hover:underline"
                      >
                        {row.unit.vin}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {row.unit.variant.modelName} · {row.unit.variant.variantName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="text-xs">
                        {row.fromShowroom.name}
                        <span className="mx-1">→</span>
                        {row.toShowroom.name}
                      </div>
                      {row.customerName && (
                        <div className="text-xs opacity-70">Customer: {row.customerName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ds} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(row.requestedAt)}
                      <div>{row.requestedBy.name}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.custodyReceivedAt ? formatDateTime(row.custodyReceivedAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {isIncoming && canDecide && ds === "PENDING" && (
                          <button
                            type="button"
                            onClick={() => setDialog({ type: "decide", request: row })}
                            className="whitespace-nowrap rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            Decide
                          </button>
                        )}
                        {isOutgoing && canReceive && ds === "PENDING" && !row.custodyReceivedAt && (
                          <button
                            type="button"
                            onClick={() => setDialog({ type: "custody", request: row })}
                            className="whitespace-nowrap rounded border px-2 py-1 text-xs font-medium hover:bg-accent"
                          >
                            Record arrival
                          </button>
                        )}
                        {isOutgoing &&
                          canReceive &&
                          (ds === "APPROVED" || ds === "APPROVED_IN_CUSTODY") && (
                            <button
                              type="button"
                              onClick={() => setDialog({ type: "receipt", request: row })}
                              className="whitespace-nowrap rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              Official receipt
                            </button>
                          )}
                        {isOutgoing && canReceive && ds === "REJECTED_IN_CUSTODY" && (
                          <button
                            type="button"
                            onClick={() => setDialog({ type: "handback", request: row })}
                            className="whitespace-nowrap rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
                          >
                            Hand back
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
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} ({meta.total} total)
          </span>
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

      {/* Dialogs */}
      {dialog?.type === "decide" && (
        <DecideReturnDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.type === "custody" && (
        <CustodyArrivalDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.type === "receipt" && (
        <OfficialReceiptDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.type === "handback" && (
        <HandBackDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.type === "new" && (
        <NewReturnRequestDialog
          toShowroom={showroom}
          onClose={() => setDialog(null)}
          onSuccess={(requestNumber) => {
            toast.success(`Return request ${requestNumber} created.`);
            setDialog(null);
            void fetchRows();
          }}
        />
      )}
    </div>
  );
}

export default function ReturnsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 md:p-6">
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <ReturnsPageInner />
    </Suspense>
  );
}
