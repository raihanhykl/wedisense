"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Package,
  Phone,
  Plus,
  Trash2,
  User as UserIcon,
  XCircle,
} from "lucide-react";
import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { cn, formatCurrency } from "@/lib/utils";
import {
  ProcurementBatchStatusBadge,
  PurchaseOrderStatusBadge,
} from "@/components/shared/procurement-status-badge";
import type {
  PurchaseOrderBatchSummary,
  PurchaseOrderDetail,
  PurchaseOrderItemRow,
} from "@/types/admin";

// ── Formatting helpers ────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ── Status-driven action availability ─────────────────────────────────

function canEdit(status: PurchaseOrderDetail["status"]): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

function canClose(status: PurchaseOrderDetail["status"]): boolean {
  return status === "FULLY_RECEIVED";
}

function canCancelStatus(status: PurchaseOrderDetail["status"]): boolean {
  return status === "OPEN" || status === "PARTIALLY_RECEIVED";
}

function canDelete(
  status: PurchaseOrderDetail["status"],
  batchCount: number,
): boolean {
  return status === "OPEN" && batchCount === 0;
}

function canAddBatch(status: PurchaseOrderDetail["status"]): boolean {
  return (
    status === "OPEN" ||
    status === "PARTIALLY_RECEIVED" ||
    status === "FULLY_RECEIVED"
  );
}

// ── Cancel dialog ─────────────────────────────────────────────────────

interface CancelDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  busy: boolean;
}

function CancelDialog({ open, onClose, onConfirm, busy }: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  if (!open) return null;

  const valid = reason.trim().length >= 5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Cancel purchase order</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The cancellation is permanent. The reason will be appended to the
          PO&apos;s notes and recorded in the audit log.
        </p>
        <label className="mt-4 block text-sm font-medium">
          Reason <span className="text-red-600">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={3}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          placeholder="Why is this PO being cancelled? (min. 5 characters)"
        />
        {touched && !valid && (
          <p className="mt-1 text-xs text-red-600">
            Reason must be at least 5 characters.
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Keep PO
          </button>
          <button
            type="button"
            onClick={() => valid && void onConfirm(reason.trim())}
            disabled={!valid || busy}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Cancel PO
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit modal (metadata patch) ───────────────────────────────────────
//
// Metadata-only — items are locked once the PO is saved (full items
// edit requires zero batches anyway). For now the user can edit name,
// description, expected delivery, PO document URL, and notes.

interface EditDialogProps {
  open: boolean;
  po: PurchaseOrderDetail;
  onClose: () => void;
  onSaved: (next: PurchaseOrderDetail) => void;
}

function EditDialog({ open, po, onClose, onSaved }: EditDialogProps) {
  const [form, setForm] = useState({
    name: po.name ?? "",
    description: po.description ?? "",
    expectedDeliveryDate: po.expectedDeliveryDate
      ? po.expectedDeliveryDate.slice(0, 10)
      : "",
    poUrl: po.poUrl ?? "",
    notes: po.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name || null,
        description: form.description || null,
        poUrl: form.poUrl || null,
        notes: form.notes || null,
        expectedDeliveryDate: form.expectedDeliveryDate
          ? new Date(`${form.expectedDeliveryDate}T12:00:00.000Z`).toISOString()
          : null,
      };
      const updated = await apiPut<PurchaseOrderDetail>(
        `/api/purchase-orders/${po.id}`,
        payload,
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to save changes"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Edit purchase order</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Vendor + items are locked here. Use Close / Cancel for status
          changes.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Description</label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={2}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Expected delivery</label>
            <input
              type="date"
              value={form.expectedDeliveryDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, expectedDeliveryDate: e.target.value }))
              }
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">PO document URL</label>
            <input
              type="url"
              value={form.poUrl}
              onChange={(e) => setForm((f) => ({ ...f, poUrl: e.target.value }))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const canUpdate = usePermission("purchase-orders:update");
  const canCloseAction = usePermission("purchase-orders:close");
  const canCancelAction = usePermission("purchase-orders:cancel");
  const canCreateBatch = usePermission("procurement:create");

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showEdit, setShowEdit] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [busyAction, setBusyAction] = useState<null | "close" | "cancel" | "delete">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchPo = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<PurchaseOrderDetail>(`/api/purchase-orders/${id}`);
      setPo(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load purchase order"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchPo();
  }, [fetchPo]);

  const handleClose = async () => {
    if (!po) return;
    setBusyAction("close");
    setActionError(null);
    try {
      const updated = await apiPut<PurchaseOrderDetail>(
        `/api/purchase-orders/${po.id}/close`,
        {},
      );
      setPo({ ...po, ...updated });
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to close PO"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = async (reason: string) => {
    if (!po) return;
    setBusyAction("cancel");
    setActionError(null);
    try {
      const updated = await apiPut<PurchaseOrderDetail>(
        `/api/purchase-orders/${po.id}/cancel`,
        { reason },
      );
      setPo({ ...po, ...updated });
      setShowCancel(false);
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to cancel PO"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!po) return;
    if (!window.confirm(`Delete purchase order ${po.poNumber}? This cannot be undone.`)) {
      return;
    }
    setBusyAction("delete");
    setActionError(null);
    try {
      await apiDelete(`/api/purchase-orders/${po.id}`);
      router.push("/admin/purchase-orders");
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to delete PO"));
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border bg-card" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "Purchase order not found."}
        </div>
        <Link
          href="/admin/purchase-orders"
          className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Link
        href="/admin/purchase-orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Purchase Orders
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {po.poNumber}
            </h1>
            <PurchaseOrderStatusBadge status={po.status} />
          </div>
          {po.name && <p className="mt-1 text-sm text-muted-foreground">{po.name}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateBatch && canAddBatch(po.status) && (
            <Link
              href={`/admin/purchase-orders/${po.id}/batches/new`}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              data-tour="po-add-batch"
            >
              <Plus className="h-4 w-4" /> Add Procurement Batch
            </Link>
          )}
          {canUpdate && canEdit(po.status) && (
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <Edit3 className="h-4 w-4" /> Edit
            </button>
          )}
          {canCloseAction && canClose(po.status) && (
            <button
              type="button"
              onClick={() => void handleClose()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyAction === "close" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Close PO
            </button>
          )}
          {canCancelAction && canCancelStatus(po.status) && (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" /> Cancel
            </button>
          )}
          {canUpdate && canDelete(po.status, po.batchCount) && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {busyAction === "delete" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Vendor + Dates + Totals */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Vendor card */}
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Vendor
          </div>
          <div className="mt-2 text-base font-medium">{po.vendor.name}</div>
          {po.vendor.taxId && (
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              NPWP {po.vendor.taxId}
            </div>
          )}
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {po.vendor.contactPerson && (
              <div className="flex items-center gap-1">
                <UserIcon className="h-3 w-3" /> {po.vendor.contactPerson}
              </div>
            )}
            {po.vendor.email && (
              <div className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> {po.vendor.email}
              </div>
            )}
            {po.vendor.phone && (
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {po.vendor.phone}
              </div>
            )}
          </div>
        </div>

        {/* Dates card */}
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dates
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">PO date</dt>
              <dd>{formatDate(po.poDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Expected delivery</dt>
              <dd>{formatDate(po.expectedDeliveryDate)}</dd>
            </div>
            {po.closedAt && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Closed at</dt>
                <dd>{formatDateTime(po.closedAt)}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Summary card */}
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Summary
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Untaxed</dt>
              <dd>{formatCurrency(po.untaxedAmount, po.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Taxes</dt>
              <dd>{formatCurrency(po.totalTaxes, po.currency)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Total</dt>
              <dd>{formatCurrency(po.totalAmount, po.currency)}</dd>
            </div>
            <div className="flex justify-between pt-1 text-xs text-muted-foreground">
              <dt>Batches / Assets</dt>
              <dd>
                {po.batchCount} / {po.assetCount}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Description / Notes */}
      {(po.description || po.notes) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {po.description && (
            <div className="rounded-lg border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{po.description}</p>
            </div>
          )}
          {po.notes && (
            <div className="rounded-lg border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{po.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* PO document */}
      {po.poUrl && (
        <a
          href={po.poUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-4 w-4 text-muted-foreground" />
          View PO document
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
      )}

      {/* Line items table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Line items ({po.items.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Unit price</th>
                <th className="px-4 py-2 text-right font-medium">Disc %</th>
                <th className="px-4 py-2 text-right font-medium">Tax %</th>
                <th className="px-4 py-2 text-right font-medium">Untaxed</th>
                <th className="px-4 py-2 text-right font-medium">Tax</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item) => (
                <ItemRow key={item.id} item={item} currency={po.currency} />
              ))}
              <tr className="border-t bg-muted/30 text-sm font-medium">
                <td className="px-4 py-3" colSpan={5}>
                  Totals
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(po.untaxedAmount, po.currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(po.totalTaxes, po.currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(po.totalAmount, po.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Batches table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              Procurement batches ({po.batches.length})
            </h2>
          </div>
          {canCreateBatch && canAddBatch(po.status) && (
            <Link
              href={`/admin/purchase-orders/${po.id}/batches/new`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Add batch
            </Link>
          )}
        </div>
        {po.batches.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No batches yet.{" "}
            {canCreateBatch && canAddBatch(po.status) && (
              <>
                <Link
                  href={`/admin/purchase-orders/${po.id}/batches/new`}
                  className="text-primary hover:underline"
                >
                  Add the first batch
                </Link>{" "}
                to start receiving items.
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Batch #</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">BAST #</th>
                  <th className="px-4 py-2 font-medium">Received</th>
                  <th className="px-4 py-2 text-right font-medium">Assets</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {po.batches.map((b) => (
                  <BatchRow
                    key={b.id}
                    batch={b}
                    poId={po.id}
                    currency={po.currency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer meta */}
      <div className="text-xs text-muted-foreground">
        Created by {po.createdBy.name} on {formatDateTime(po.createdAt)}
        {po.closedBy && (
          <>
            {" · "}Closed by {po.closedBy.name} on {formatDateTime(po.closedAt)}
          </>
        )}
      </div>

      {/* Dialogs */}
      <EditDialog
        open={showEdit}
        po={po}
        onClose={() => setShowEdit(false)}
        onSaved={(next) => setPo({ ...po, ...next })}
      />
      <CancelDialog
        open={showCancel}
        onClose={() => setShowCancel(false)}
        onConfirm={handleCancel}
        busy={busyAction === "cancel"}
      />
    </div>
  );
}

// ── PO line item row ──────────────────────────────────────────────────

function ItemRow({
  item,
  currency,
}: {
  item: PurchaseOrderItemRow;
  currency: string;
}) {
  return (
    <tr className={cn("border-b transition-colors last:border-0 hover:bg-muted/30")}>
      <td className="px-4 py-3">
        <div className="font-medium">{item.product.name}</div>
        <div className="text-xs text-muted-foreground">
          {[item.product.brand, item.product.model, item.product.eanCode]
            .filter(Boolean)
            .join(" · ") || item.product.category.name}
        </div>
      </td>
      <td className="px-4 py-3 text-right">{item.qty}</td>
      <td className="px-4 py-3 text-right">
        {formatCurrency(item.unitPrice, currency)}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {item.discountPercent}%
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {item.taxPercent}%
      </td>
      <td className="px-4 py-3 text-right">
        {formatCurrency(item.untaxedAmount, currency)}
      </td>
      <td className="px-4 py-3 text-right">
        {formatCurrency(item.taxAmount, currency)}
      </td>
      <td className="px-4 py-3 text-right font-medium">
        {formatCurrency(item.totalAmount, currency)}
      </td>
    </tr>
  );
}

// ── Batch summary row ─────────────────────────────────────────────────

function BatchRow({
  batch,
  poId,
  currency,
}: {
  batch: PurchaseOrderBatchSummary;
  poId: string;
  currency: string;
}) {
  return (
    <tr className={cn("border-b transition-colors last:border-0 hover:bg-muted/30")}>
      <td className="px-4 py-3">
        <Link
          href={`/admin/purchase-orders/${poId}/batches/${batch.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {batch.batchNumber}
        </Link>
        {batch.name && (
          <div className="text-xs text-muted-foreground">{batch.name}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <ProcurementBatchStatusBadge status={batch.status} />
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {batch.bastNumber ?? "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatDate(batch.receivedDate)}
      </td>
      <td className="px-4 py-3 text-right">{batch.assetCount}</td>
      <td className="px-4 py-3 text-right">
        {formatCurrency(batch.totalAmount, currency)}
      </td>
    </tr>
  );
}
