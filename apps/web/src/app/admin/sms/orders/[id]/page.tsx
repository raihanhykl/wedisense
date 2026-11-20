"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { newIdempotencyKey, smsPut, smsErrorMessage, toSmsError } from "@/lib/sms/client";
import {
  formatDate,
  formatDateTime,
  variantLabel,
  todayInputValue,
} from "@/lib/sms/labels";
import { useShowroom } from "@/components/sms/showroom-context";
import { OrderLineStatusBadge } from "@/components/sms/orders/order-line-status-badge";
import { CancelLineDialog } from "@/components/sms/orders/cancel-line-dialog";
import { FollowUpDialog } from "@/components/sms/orders/follow-up-dialog";
import { ConfirmPickupDialog } from "@/components/sms/orders/confirm-pickup-dialog";
import { AddUnitsDialog } from "@/components/sms/orders/add-units-dialog";
import { HandoverRtoDialog } from "@/components/sms/rto/handover-rto-dialog";
import { RecordSaleReturnDialog } from "@/components/sms/orders/record-sale-return-dialog";
import { DecideSaleReturnDialog } from "@/components/sms/orders/decide-sale-return-dialog";
import type {
  OrderDetail,
  OrderLineDetail,
  RecordSaleResult,
} from "@/lib/sms/orders-types";

type DialogState =
  | { kind: "cancel"; lineId: string; vin: string }
  | { kind: "follow-up"; lineId: string; vin: string; followUpAt: string | null }
  | { kind: "confirm-pickup"; lineId: string; vin: string }
  | { kind: "add-units" }
  | {
      kind: "handover-rto";
      lineId: string;
      unitId: string;
      vin: string;
      salesUserId?: string;
      salesName?: string;
      customerName: string;
    }
  | { kind: "record-sale-return"; lineId: string; vin: string }
  | { kind: "decide-sale-return"; lineId: string; vin: string }
  | null;

// ── Summary chips ──────────────────────────────────────────────────────

function SummaryChips({ summary }: { summary: OrderDetail["summary"] }) {
  const { total, booked, sold, pickedUp, cancelled } = summary;
  return (
    <div className="flex flex-wrap gap-2">
      <span className="rounded-full bg-muted px-3 py-1 text-sm">
        {total} unit{total !== 1 ? "s" : ""}
      </span>
      {booked > 0 && (
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">
          {booked} booked
        </span>
      )}
      {sold > 0 && (
        <span className="rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800">
          {sold} sold
        </span>
      )}
      {pickedUp > 0 && (
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
          {pickedUp} of {total - cancelled} picked up
        </span>
      )}
      {cancelled > 0 && (
        <span className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-700">
          {cancelled} cancelled
        </span>
      )}
    </div>
  );
}

// ── Detail row ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1 py-1.5 text-sm">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

// ── Record sale for selected lines ─────────────────────────────────────

interface RecordSaleBarProps {
  orderId: string;
  selectedLineIds: string[];
  onSuccess: () => void;
}

function RecordSaleBar({ orderId, selectedLineIds, onSuccess }: RecordSaleBarProps) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [soldAt, setSoldAt] = useState(todayInputValue());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (selectedLineIds.length === 0) return null;

  const handleRecordSale = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await smsPut<RecordSaleResult>(
        `/api/sms/orders/${orderId}/record-sale`,
        { lineIds: selectedLineIds, soldAt: soldAt || undefined },
        idempotencyKey,
      );
      setIdempotencyKey(newIdempotencyKey());
      if (result.alreadyDone) {
        toast.info("All selected lines were already marked as sold.");
      } else {
        toast.success(
          `Sale recorded for ${result.recordedCount} unit${result.recordedCount !== 1 ? "s" : ""}.`,
        );
      }
      onSuccess();
    } catch (err) {
      const smsErr = toSmsError(err, "Failed to record sale.");
      setIdempotencyKey(newIdempotencyKey());
      setError(smsErr.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-primary/5 px-4 py-3">
      <span className="text-sm font-medium">
        {selectedLineIds.length} unit{selectedLineIds.length !== 1 ? "s" : ""} selected
      </span>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Sale date</label>
        <input
          type="date"
          value={soldAt}
          max={todayInputValue()}
          onChange={(e) => setSoldAt(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        />
      </div>
      <button
        type="button"
        onClick={() => void handleRecordSale()}
        disabled={submitting}
        data-tour="sms-order-record-sale"
        className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Recording…" : "Record sale"}
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Inline sale-return recording dialog ───────────────────────────────



// ── Line timestamps sub-component ──────────────────────────────────────

function LineTimestamps({ line }: { line: OrderLineDetail }) {
  const isStaleBooking =
    line.status === "BOOKED" &&
    line.followUpAt !== null &&
    new Date(line.followUpAt) < new Date();

  return (
    <div className="space-y-0.5">
      {line.bookedAt && <div>Booked: {formatDate(line.bookedAt)}</div>}
      {line.followUpAt && line.status === "BOOKED" && (
        <div className={isStaleBooking ? "text-amber-700" : ""}>
          Follow up: {formatDate(line.followUpAt)}
        </div>
      )}
      {line.soldAt && <div>Sold: {formatDate(line.soldAt)}</div>}
      {line.pickedUpAt && <div>Picked up: {formatDateTime(line.pickedUpAt)}</div>}
      {line.rtoHandoverAt && <div>RTO handover: {formatDateTime(line.rtoHandoverAt)}</div>}
      {line.cancelledAt && <div>Cancelled: {formatDate(line.cancelledAt)}</div>}
      {line.receiverName && <div>Receiver: {line.receiverName}</div>}
      {line.cancelReason && (
        <div className="max-w-xs truncate text-muted-foreground">Reason: {line.cancelReason}</div>
      )}
      {/* Sale return info */}
      {line.returnReceivedAt && (
        <div className="mt-1 rounded-sm bg-orange-50 px-1.5 py-1 text-orange-700">
          Return received: {formatDateTime(line.returnReceivedAt)}
          {line.returnReason && (
            <div className="mt-0.5 text-xs text-orange-600 truncate max-w-xs">
              Reason: {line.returnReason}
            </div>
          )}
          {line.returnDecision ? (
            <div className={`mt-0.5 font-medium text-xs ${
              line.returnDecision === "APPROVED"
                ? "text-emerald-700"
                : line.returnDecision === "REJECTED"
                ? "text-red-700"
                : "text-amber-700"
            }`}>
              {line.returnDecision === "APPROVED"
                ? "Return approved"
                : line.returnDecision === "REJECTED"
                ? `Return rejected${line.returnDecisionReason ? `: ${line.returnDecisionReason}` : ""}`
                : "Awaiting decision"}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Lines table ────────────────────────────────────────────────────────

type OpenableDialog = Exclude<DialogState, null | { kind: "add-units" }>;

interface LinesTableProps {
  lines: OrderLineDetail[];
  canManage: boolean;
  canDecideReturn: boolean;
  canRto: boolean;
  customerName: string;
  salesUserId?: string;
  salesName?: string;
  selectedForSale: Set<string>;
  onToggleSale: (lineId: string) => void;
  onOpenDialog: (state: OpenableDialog) => void;
}

function LinesTable({
  lines,
  canManage,
  canDecideReturn,
  canRto,
  customerName,
  salesUserId,
  salesName,
  selectedForSale,
  onToggleSale,
  onOpenDialog,
}: LinesTableProps) {
  const now = new Date();

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {canManage && <th className="w-10 px-3 py-3" />}
            <th className="px-4 py-3 text-left font-medium">VIN</th>
            <th className="px-4 py-3 text-left font-medium">Variant</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Timestamps</th>
            <th className="px-4 py-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const isStale =
              line.status === "BOOKED" &&
              line.followUpAt !== null &&
              new Date(line.followUpAt) < now;
            const hasPendingReturn =
              (line.status === "SOLD" || line.status === "PICKED_UP") &&
              line.returnReceivedAt !== null &&
              line.returnDecision === null;

            return (
              <tr
                key={line.id}
                className={`border-b last:border-b-0 ${isStale ? "bg-amber-50/50" : hasPendingReturn ? "bg-orange-50/50" : ""}`}
              >
                {canManage && (
                  <td className="px-3 py-3">
                    {line.status === "BOOKED" && (
                      <input
                        type="checkbox"
                        checked={selectedForSale.has(line.id)}
                        onChange={() => onToggleSale(line.id)}
                        className="h-4 w-4 rounded border"
                      />
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={`/admin/sms/units/${line.unit.id}`}
                      className="font-mono font-semibold text-primary hover:underline"
                    >
                      {line.unit.vin}
                    </Link>
                    {isStale && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        Follow up due
                      </span>
                    )}
                    {hasPendingReturn && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
                        Return pending
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {variantLabel(line.unit.variant)}
                </td>
                <td className="px-4 py-3">
                  <OrderLineStatusBadge status={line.status} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  <LineTimestamps line={line} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {/* Existing actions */}
                    {canManage && line.status === "BOOKED" && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenDialog({
                              kind: "follow-up",
                              lineId: line.id,
                              vin: line.unit.vin,
                              followUpAt: line.followUpAt,
                            })
                          }
                          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Follow up
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenDialog({ kind: "cancel", lineId: line.id, vin: line.unit.vin })
                          }
                          className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {canManage && line.status === "SOLD" && !hasPendingReturn && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDialog({ kind: "confirm-pickup", lineId: line.id, vin: line.unit.vin })
                        }
                        className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                      >
                        Confirm pickup
                      </button>
                    )}
                    {/* Stage 4: RTO handover for BOOKED lines */}
                    {canRto && line.status === "BOOKED" && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDialog({
                            kind: "handover-rto",
                            lineId: line.id,
                            unitId: line.unit.id,
                            vin: line.unit.vin,
                            salesUserId,
                            salesName,
                            customerName,
                          })
                        }
                        data-tour="sms-order-handover-rto"
                        className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
                      >
                        Hand over as RTO
                      </button>
                    )}
                    {/* Stage 4: Sale return for SOLD or PICKED_UP */}
                    {canManage &&
                      (line.status === "SOLD" || line.status === "PICKED_UP") &&
                      line.returnReceivedAt === null && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenDialog({ kind: "record-sale-return", lineId: line.id, vin: line.unit.vin })
                          }
                          data-tour="sms-order-record-sale-return"
                          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Record return
                        </button>
                      )}
                    {/* Stage 4: Decide pending return */}
                    {canDecideReturn && hasPendingReturn && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDialog({ kind: "decide-sale-return", lineId: line.id, vin: line.unit.vin })
                        }
                        data-tour="sms-order-decide-sale-return"
                        className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                      >
                        Decide return
                      </button>
                    )}
                    {/* RTO_HANDED_OVER: read-only link to VIN card */}
                    {line.status === "RTO_HANDED_OVER" && (
                      <Link
                        href={`/admin/sms/units/${line.unit.id}`}
                        className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent hover:underline"
                      >
                        View VIN card
                      </Link>
                    )}
                    {/* RETURNED: read-only link to VIN card */}
                    {line.status === "RETURNED" && (
                      <Link
                        href={`/admin/sms/units/${line.unit.id}`}
                        className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent hover:underline"
                      >
                        View VIN card
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Mobile line card ────────────────────────────────────────────────────

function LineCard({
  line,
  canManage,
  canDecideReturn,
  canRto,
  customerName,
  salesUserId,
  salesName,
  selectedForSale,
  onToggleSale,
  onOpenDialog,
}: {
  line: OrderLineDetail;
  canManage: boolean;
  canDecideReturn: boolean;
  canRto: boolean;
  customerName: string;
  salesUserId?: string;
  salesName?: string;
  selectedForSale: Set<string>;
  onToggleSale: (lineId: string) => void;
  onOpenDialog: (state: OpenableDialog) => void;
}) {
  const now = new Date();
  const isStale =
    line.status === "BOOKED" &&
    line.followUpAt !== null &&
    new Date(line.followUpAt) < now;
  const hasPendingReturn =
    (line.status === "SOLD" || line.status === "PICKED_UP") &&
    line.returnReceivedAt !== null &&
    line.returnDecision === null;

  return (
    <div
      className={`rounded-lg border bg-card p-3 ${
        isStale ? "border-amber-200 bg-amber-50/40" : hasPendingReturn ? "border-orange-200 bg-orange-50/40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {canManage && line.status === "BOOKED" && (
            <input
              type="checkbox"
              checked={selectedForSale.has(line.id)}
              onChange={() => onToggleSale(line.id)}
              className="mt-0.5 h-4 w-4 rounded border"
            />
          )}
          <Link
            href={`/admin/sms/units/${line.unit.id}`}
            className="font-mono font-semibold text-primary hover:underline"
          >
            {line.unit.vin}
          </Link>
          {isStale && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Follow up due
            </span>
          )}
          {hasPendingReturn && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
              Return pending
            </span>
          )}
        </div>
        <OrderLineStatusBadge status={line.status} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{variantLabel(line.unit.variant)}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        <LineTimestamps line={line} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {canManage && line.status === "BOOKED" && (
          <>
            <button
              type="button"
              onClick={() =>
                onOpenDialog({
                  kind: "follow-up",
                  lineId: line.id,
                  vin: line.unit.vin,
                  followUpAt: line.followUpAt,
                })
              }
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              Follow up
            </button>
            <button
              type="button"
              onClick={() => onOpenDialog({ kind: "cancel", lineId: line.id, vin: line.unit.vin })}
              className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              Cancel
            </button>
          </>
        )}
        {canManage && line.status === "SOLD" && !hasPendingReturn && (
          <button
            type="button"
            onClick={() =>
              onOpenDialog({ kind: "confirm-pickup", lineId: line.id, vin: line.unit.vin })
            }
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          >
            Confirm pickup
          </button>
        )}
        {canRto && line.status === "BOOKED" && (
          <button
            type="button"
            onClick={() =>
              onOpenDialog({
                kind: "handover-rto",
                lineId: line.id,
                unitId: line.unit.id,
                vin: line.unit.vin,
                salesUserId,
                salesName,
                customerName,
              })
            }
            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
          >
            Hand over as RTO
          </button>
        )}
        {canManage &&
          (line.status === "SOLD" || line.status === "PICKED_UP") &&
          line.returnReceivedAt === null && (
            <button
              type="button"
              onClick={() =>
                onOpenDialog({ kind: "record-sale-return", lineId: line.id, vin: line.unit.vin })
              }
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              Record return
            </button>
          )}
        {canDecideReturn && hasPendingReturn && (
          <button
            type="button"
            onClick={() =>
              onOpenDialog({ kind: "decide-sale-return", lineId: line.id, vin: line.unit.vin })
            }
            className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
          >
            Decide return
          </button>
        )}
        {(line.status === "RTO_HANDED_OVER" || line.status === "RETURNED") && (
          <Link
            href={`/admin/sms/units/${line.unit.id}`}
            className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent hover:underline"
          >
            View VIN card
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { canAt } = useShowroom();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [selectedForSale, setSelectedForSale] = useState<Set<string>>(new Set());

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<OrderDetail>(`/api/sms/orders/${id}`);
      setOrder(data);
      // Clear stale selections after refresh
      setSelectedForSale((prev) => {
        const bookedIds = new Set(data.lines.filter((l) => l.status === "BOOKED").map((l) => l.id));
        const next = new Set(Array.from(prev).filter((id) => bookedIds.has(id)));
        return next;
      });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setNotFound(true);
      } else {
        toast.error(smsErrorMessage(err, "Failed to load order."));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const handleActionSuccess = () => {
    setDialog(null);
    setSelectedForSale(new Set());
    void fetchOrder();
  };

  const toggleSaleSelection = (lineId: string) => {
    setSelectedForSale((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const openDialog = (state: Exclude<DialogState, null>) => setDialog(state);

  if (notFound) {
    return (
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-8 text-center">
          <p className="text-sm font-medium">Order not found or you do not have access.</p>
          <Link href="/admin/sms/orders" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to orders
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <Skeleton className="mb-2 h-8 w-72" />
        <Skeleton className="mb-5 h-5 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
        <Skeleton className="mt-4 h-64 rounded-lg" />
      </div>
    );
  }

  if (!order) return null;

  const canManage = canAt("sms-orders:manage", order.showroom.id);
  const canDecideReturn = canAt("sms-sale-returns:decide", order.showroom.id);
  const canRto = canAt("sms-rto:manage", order.showroom.id);
  const bookedLines = order.lines.filter((l) => l.status === "BOOKED");
  const selectedForSaleIds = Array.from(selectedForSale).filter((lineId) =>
    bookedLines.some((l) => l.id === lineId),
  );

  const salesUserId = order.sales?.id;
  const salesName = order.sales?.name;

  return (
    <div className="p-4 md:p-6" data-tour="sms-order-detail">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/admin/sms" className="hover:text-foreground">Stock</Link>
        {" / "}
        <Link href="/admin/sms/orders" className="hover:text-foreground">Orders</Link>
        {" / "}
        <span className="font-mono text-foreground">{order.spkNumber}</span>
      </nav>

      {/* Header */}
      <div className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-bold tracking-tight sm:text-3xl">
              {order.spkNumber}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{order.showroom.name}</p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setDialog({ kind: "add-units" })}
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Add units
            </button>
          )}
        </div>
        <div className="mt-3">
          <SummaryChips summary={order.summary} />
        </div>
      </div>

      {/* Detail grid */}
      <div className="mb-5 grid gap-4 md:grid-cols-2">
        {/* Customer */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Customer
          </h3>
          <div className="divide-y">
            <DetailRow label="Name" value={order.customerName} />
            <DetailRow
              label="Phone"
              value={
                order.customerPhone ??
                <span className="italic text-muted-foreground">Not visible</span>
              }
            />
            <DetailRow
              label="ID number"
              value={
                order.customerIdNumberMasked
                  ? <span className="italic text-muted-foreground">Restricted</span>
                  : (order.customerIdNumber ?? <span className="italic text-muted-foreground">Not provided</span>)
              }
            />
          </div>
        </div>

        {/* Order info */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Order
          </h3>
          <div className="divide-y">
            <DetailRow label="Sales" value={order.sales?.name ?? "—"} />
            <DetailRow label="Recorded by" value={order.createdBy.name} />
            <DetailRow label="Showroom" value={order.showroom.name} />
            <DetailRow label="Created" value={formatDateTime(order.createdAt)} />
            {order.isOpeningBalance && (
              <DetailRow
                label="Type"
                value={
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Opening balance
                  </span>
                }
              />
            )}
            {order.notes && <DetailRow label="Notes" value={order.notes} />}
          </div>
        </div>
      </div>

      {/* Record-sale action bar */}
      {canManage && selectedForSaleIds.length > 0 && (
        <div className="mb-4">
          <RecordSaleBar
            orderId={order.id}
            selectedLineIds={selectedForSaleIds}
            onSuccess={handleActionSuccess}
          />
        </div>
      )}

      {/* Select-all for BOOKED lines */}
      {canManage && bookedLines.length > 1 && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            id="select-all-booked"
            checked={bookedLines.every((l) => selectedForSale.has(l.id))}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedForSale(new Set(bookedLines.map((l) => l.id)));
              } else {
                setSelectedForSale(new Set());
              }
            }}
            className="h-4 w-4 rounded border"
          />
          <label htmlFor="select-all-booked" className="cursor-pointer text-muted-foreground">
            Select all booked lines
          </label>
        </div>
      )}

      {/* Lines — desktop table */}
      <div className="hidden md:block">
        <LinesTable
          lines={order.lines}
          canManage={canManage}
          canDecideReturn={canDecideReturn}
          canRto={canRto}
          customerName={order.customerName}
          salesUserId={salesUserId}
          salesName={salesName ?? undefined}
          selectedForSale={selectedForSale}
          onToggleSale={toggleSaleSelection}
          onOpenDialog={openDialog}
        />
      </div>

      {/* Lines — mobile cards */}
      <div className="space-y-2 md:hidden">
        {order.lines.map((line) => (
          <LineCard
            key={line.id}
            line={line}
            canManage={canManage}
            canDecideReturn={canDecideReturn}
            canRto={canRto}
            customerName={order.customerName}
            salesUserId={salesUserId}
            salesName={salesName ?? undefined}
            selectedForSale={selectedForSale}
            onToggleSale={toggleSaleSelection}
            onOpenDialog={openDialog}
          />
        ))}
      </div>

      {/* Mobile record-sale button */}
      {canManage && selectedForSaleIds.length > 0 && (
        <div className="mt-3 md:hidden">
          <RecordSaleBar
            orderId={order.id}
            selectedLineIds={selectedForSaleIds}
            onSuccess={handleActionSuccess}
          />
        </div>
      )}

      {/* Dialogs — existing */}
      {dialog?.kind === "cancel" && (
        <CancelLineDialog
          orderId={order.id}
          lineId={dialog.lineId}
          vin={dialog.vin}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.kind === "follow-up" && (
        <FollowUpDialog
          orderId={order.id}
          lineId={dialog.lineId}
          vin={dialog.vin}
          currentFollowUpAt={dialog.followUpAt}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.kind === "confirm-pickup" && (
        <ConfirmPickupDialog
          orderId={order.id}
          lineId={dialog.lineId}
          vin={dialog.vin}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.kind === "add-units" && (
        <AddUnitsDialog
          orderId={order.id}
          spkNumber={order.spkNumber}
          showroomId={order.showroom.id}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {/* Stage 4 dialogs */}
      {dialog?.kind === "handover-rto" && (
        <HandoverRtoDialog
          unitId={dialog.unitId}
          unitVin={dialog.vin}
          preFilledSalesUserId={dialog.salesUserId}
          preFilledSalesName={dialog.salesName}
          preFilledCustomerName={dialog.customerName}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.kind === "record-sale-return" && (
        <RecordSaleReturnDialog
          orderId={order.id}
          lineId={dialog.lineId}
          vin={dialog.vin}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog?.kind === "decide-sale-return" && (
        <DecideSaleReturnDialog
          orderId={order.id}
          lineId={dialog.lineId}
          vin={dialog.vin}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
    </div>
  );
}
