"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileText,
  Loader2,
  Package,
  PlayCircle,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { cn, formatCurrency } from "@/lib/utils";
import { ProcurementBatchStatusBadge } from "@/components/shared/procurement-status-badge";
import type {
  BatchItemRow,
  ProcurementBatchDetail,
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

function toIsoDate(d: string): string {
  return new Date(`${d}T12:00:00.000Z`).toISOString();
}

// ── Status-driven action availability ─────────────────────────────────

const canEdit = (s: ProcurementBatchDetail["status"]) =>
  s !== "COMPLETED" && s !== "CANCELLED";
const canSubmit = (s: ProcurementBatchDetail["status"]) => s === "DRAFT";
const canReceive = (s: ProcurementBatchDetail["status"]) =>
  s === "ITEMS_PENDING";
const canComplete = (s: ProcurementBatchDetail["status"]) => s === "RECEIVED";
const canCancelStatus = (s: ProcurementBatchDetail["status"]) =>
  s === "DRAFT" || s === "ITEMS_PENDING";
const canDelete = (s: ProcurementBatchDetail["status"], assetCount: number) =>
  s === "DRAFT" && assetCount === 0;
const canImport = (s: ProcurementBatchDetail["status"]) =>
  s === "DRAFT" || s === "ITEMS_PENDING";

// ── Modal shell ───────────────────────────────────────────────────────

function ModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

interface UserOption {
  id: string;
  name: string;
}

// ── Receive dialog ────────────────────────────────────────────────────

function ReceiveDialog({
  batch,
  onClose,
  onDone,
  users,
}: {
  batch: ProcurementBatchDetail;
  onClose: () => void;
  onDone: (next: ProcurementBatchDetail) => void;
  users: UserOption[];
}) {
  const [form, setForm] = useState({
    bastNumber: batch.bastNumber ?? "",
    bastDate: batch.bastDate
      ? batch.bastDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    bastUrl: batch.bastUrl ?? "",
    receivedDate: batch.receivedDate
      ? batch.receivedDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    receivedByName: batch.receivedByName ?? "",
    receivedByPosition: batch.receivedByPosition ?? "",
  });
  const [receivedByUserId, setReceivedByUserId] = useState(
    batch.receivedByUserId ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signatoryValid = !!(receivedByUserId || form.receivedByName.trim());
  const bastValid =
    form.bastNumber.trim().length > 0 && form.bastDate.length > 0;
  const valid = signatoryValid && bastValid;

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        bastNumber: form.bastNumber,
        bastDate: toIsoDate(form.bastDate),
        receivedDate: toIsoDate(form.receivedDate),
        ...(form.bastUrl && { bastUrl: form.bastUrl }),
        receivedByUserId: receivedByUserId || null,
        receivedByName: form.receivedByName.trim() || null,
        receivedByPosition: form.receivedByPosition.trim() || null,
      };
      const updated = await apiPut<ProcurementBatchDetail>(
        `/api/procurement-batches/${batch.id}/receive`,
        payload,
      );
      onDone(updated);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to mark batch as received"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Mark batch as Received"
      description="Records the BAST hand-over. Requires BAST number, BAST date, and at least one signatory."
      onClose={onClose}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">
            BAST number <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            value={form.bastNumber}
            onChange={(e) => setForm((f) => ({ ...f, bastNumber: e.target.value }))}
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">
            BAST date <span className="text-red-600">*</span>
          </label>
          <input
            type="date"
            value={form.bastDate}
            onChange={(e) => setForm((f) => ({ ...f, bastDate: e.target.value }))}
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Received date</label>
          <input
            type="date"
            value={form.receivedDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, receivedDate: e.target.value }))
            }
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">BAST document URL</label>
          <input
            type="url"
            value={form.bastUrl}
            onChange={(e) => setForm((f) => ({ ...f, bastUrl: e.target.value }))}
            placeholder="https://…"
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="mt-2 rounded-md border border-dashed p-3 md:col-span-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signatory
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            At least one is required. Pick an internal user or fill the external name.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Internal user</label>
              <select
                value={receivedByUserId}
                onChange={(e) => setReceivedByUserId(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              >
                <option value="">— Select user —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">External name</label>
              <input
                type="text"
                value={form.receivedByName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, receivedByName: e.target.value }))
                }
                placeholder="e.g. Pak Budi (PT XYZ)"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Position / title</label>
              <input
                type="text"
                value={form.receivedByPosition}
                onChange={(e) =>
                  setForm((f) => ({ ...f, receivedByPosition: e.target.value }))
                }
                placeholder="Optional"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      </div>

      {!signatoryValid && (
        <p className="mt-2 text-xs text-amber-700">
          Provide at least one signatory before proceeding.
        </p>
      )}

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
          disabled={!valid || busy}
          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Mark as Received
        </button>
      </div>
    </ModalShell>
  );
}

// ── Complete dialog ───────────────────────────────────────────────────

function CompleteDialog({
  batch,
  onClose,
  onDone,
}: {
  batch: ProcurementBatchDetail;
  onClose: () => void;
  onDone: (next: ProcurementBatchDetail) => void;
}) {
  const [form, setForm] = useState({
    invoiceNumber: batch.invoiceNumber ?? "",
    invoiceDate: batch.invoiceDate
      ? batch.invoiceDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    invoiceUrl: batch.invoiceUrl ?? "",
    taxInvoiceNumber: batch.taxInvoiceNumber ?? "",
    taxInvoiceDate: batch.taxInvoiceDate
      ? batch.taxInvoiceDate.slice(0, 10)
      : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    form.invoiceNumber.trim().length > 0 && form.invoiceDate.length > 0;

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber,
        invoiceDate: toIsoDate(form.invoiceDate),
        ...(form.invoiceUrl && { invoiceUrl: form.invoiceUrl }),
        ...(form.taxInvoiceNumber && {
          taxInvoiceNumber: form.taxInvoiceNumber,
        }),
        ...(form.taxInvoiceDate && {
          taxInvoiceDate: toIsoDate(form.taxInvoiceDate),
        }),
      };
      const updated = await apiPut<ProcurementBatchDetail>(
        `/api/procurement-batches/${batch.id}/complete`,
        payload,
      );
      onDone(updated);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to complete batch"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Complete batch"
      description="Records invoice + tax invoice. After Complete, only notes and attachments are editable."
      onClose={onClose}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">
            Invoice number <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            value={form.invoiceNumber}
            onChange={(e) =>
              setForm((f) => ({ ...f, invoiceNumber: e.target.value }))
            }
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">
            Invoice date <span className="text-red-600">*</span>
          </label>
          <input
            type="date"
            value={form.invoiceDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, invoiceDate: e.target.value }))
            }
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">Invoice document URL</label>
          <input
            type="url"
            value={form.invoiceUrl}
            onChange={(e) => setForm((f) => ({ ...f, invoiceUrl: e.target.value }))}
            placeholder="https://…"
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Faktur Pajak number</label>
          <input
            type="text"
            value={form.taxInvoiceNumber}
            onChange={(e) =>
              setForm((f) => ({ ...f, taxInvoiceNumber: e.target.value }))
            }
            placeholder="Optional"
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Faktur Pajak date</label>
          <input
            type="date"
            value={form.taxInvoiceDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, taxInvoiceDate: e.target.value }))
            }
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
          disabled={!valid || busy}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Complete batch
        </button>
      </div>
    </ModalShell>
  );
}

// ── Cancel dialog ─────────────────────────────────────────────────────

function CancelDialog({
  onClose,
  onConfirm,
  busy,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const valid = reason.trim().length >= 5;

  return (
    <ModalShell
      title="Cancel batch"
      description="A cancelled batch is excluded from the parent PO's status calculation."
      onClose={onClose}
    >
      <label className="block text-sm font-medium">
        Reason <span className="text-red-600">*</span>
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        rows={3}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        placeholder="Min. 5 characters."
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
          Keep batch
        </button>
        <button
          type="button"
          onClick={() => valid && void onConfirm(reason.trim())}
          disabled={!valid || busy}
          className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Cancel batch
        </button>
      </div>
    </ModalShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ poId: string; batchId: string }>();
  const poId = params?.poId;
  const batchId = params?.batchId;

  const canUpdate = usePermission("procurement:update");
  const canCompleteAction = usePermission("procurement:complete");
  const canCancelAction = usePermission("procurement:cancel");
  const canImportAssets = usePermission("assets:import");

  const [batch, setBatch] = useState<ProcurementBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [openDialog, setOpenDialog] = useState<
    null | "receive" | "complete" | "cancel"
  >(null);
  const [busyAction, setBusyAction] = useState<
    null | "submit" | "cancel" | "delete"
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchBatch = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ProcurementBatchDetail>(
        `/api/procurement-batches/${batchId}`,
      );
      setBatch(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load batch"));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void fetchBatch();
  }, [fetchBatch]);

  // Load active users for the signatory picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet<
          Array<{ id: string; name: string; status: string }>
        >("/api/users", { limit: 200 });
        if (!cancelled) {
          setUsers(
            rows
              .filter((u) => u.status === "ACTIVE")
              .map((u) => ({ id: u.id, name: u.name })),
          );
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    if (!batch) return;
    setBusyAction("submit");
    setActionError(null);
    try {
      const updated = await apiPut<ProcurementBatchDetail>(
        `/api/procurement-batches/${batch.id}/submit`,
        {},
      );
      setBatch(updated);
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to submit batch"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = async (reason: string) => {
    if (!batch) return;
    setBusyAction("cancel");
    setActionError(null);
    try {
      const updated = await apiPut<ProcurementBatchDetail>(
        `/api/procurement-batches/${batch.id}/cancel`,
        { reason },
      );
      setBatch(updated);
      setOpenDialog(null);
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to cancel batch"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!batch || !poId) return;
    if (
      !window.confirm(`Delete batch ${batch.batchNumber}? This cannot be undone.`)
    )
      return;
    setBusyAction("delete");
    setActionError(null);
    try {
      await apiDelete(`/api/procurement-batches/${batch.id}`);
      router.push(`/admin/purchase-orders/${poId}`);
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to delete batch"));
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

  if (error || !batch) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "Batch not found."}
        </div>
        {poId && (
          <Link
            href={`/admin/purchase-orders/${poId}`}
            className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to PO
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Link
        href={`/admin/purchase-orders/${batch.purchaseOrder.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {batch.purchaseOrder.poNumber}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {batch.batchNumber}
            </h1>
            <ProcurementBatchStatusBadge status={batch.status} />
          </div>
          {batch.name && (
            <p className="mt-1 text-sm text-muted-foreground">{batch.name}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImportAssets && canImport(batch.status) && (
            <Link
              href={`/admin/assets/import?batchId=${batch.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <Upload className="h-4 w-4" /> Import assets
            </Link>
          )}
          {canUpdate && canEdit(batch.status) && (
            <button
              type="button"
              disabled
              title="Inline batch edit lands in a follow-up tier"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm opacity-50"
            >
              <Edit3 className="h-4 w-4" /> Edit
            </button>
          )}
          {canUpdate && canSubmit(batch.status) && (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busyAction === "submit" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Submit
            </button>
          )}
          {canUpdate && canReceive(batch.status) && (
            <button
              type="button"
              onClick={() => setOpenDialog("receive")}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              <CheckCircle2 className="h-4 w-4" /> Mark Received
            </button>
          )}
          {canCompleteAction && canComplete(batch.status) && (
            <button
              type="button"
              onClick={() => setOpenDialog("complete")}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" /> Complete
            </button>
          )}
          {canCancelAction && canCancelStatus(batch.status) && (
            <button
              type="button"
              onClick={() => setOpenDialog("cancel")}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              <XCircle className="h-4 w-4" /> Cancel
            </button>
          )}
          {canUpdate && canDelete(batch.status, batch.assetCount) && (
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

      {/* Parent PO link */}
      <Link
        href={`/admin/purchase-orders/${batch.purchaseOrder.id}`}
        className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/30"
      >
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Parent Purchase Order
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="font-mono font-medium text-primary">
              {batch.purchaseOrder.poNumber}
            </span>
            <span className="text-muted-foreground">·</span>
            <span>{batch.purchaseOrder.vendor.name}</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {/* Overview cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dates
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Purchase</dt>
              <dd>{formatDate(batch.purchaseDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">BAST</dt>
              <dd>{formatDate(batch.bastDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Received</dt>
              <dd>{formatDate(batch.receivedDate)}</dd>
            </div>
            {batch.completedAt && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Completed</dt>
                <dd>{formatDateTime(batch.completedAt)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Totals
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Total amount</dt>
              <dd className="font-medium">
                {formatCurrency(batch.totalAmount, batch.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Assets linked</dt>
              <dd>{batch.assetCount}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signatory
          </div>
          <div className="mt-2 text-sm">
            {batch.receivedBy ? (
              <>
                <div className="font-medium">{batch.receivedBy.name}</div>
                {batch.receivedBy.email && (
                  <div className="text-xs text-muted-foreground">
                    {batch.receivedBy.email}
                  </div>
                )}
              </>
            ) : batch.receivedByName ? (
              <>
                <div className="font-medium">{batch.receivedByName}</div>
                {batch.receivedByPosition && (
                  <div className="text-xs text-muted-foreground">
                    {batch.receivedByPosition}
                  </div>
                )}
              </>
            ) : (
              <span className="text-xs italic text-muted-foreground">
                Not yet recorded — fill via Mark Received.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Documents */}
      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Documents
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <DocLink label="BAST" url={batch.bastUrl} number={batch.bastNumber} />
          <DocLink
            label="Invoice"
            url={batch.invoiceUrl}
            number={batch.invoiceNumber}
          />
          <DocLink
            label="Faktur Pajak"
            url={null}
            number={batch.taxInvoiceNumber}
          />
        </div>
      </div>

      {/* Notes */}
      {batch.notes && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notes
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{batch.notes}</p>
        </div>
      )}

      {/* Line items received */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Items received ({batch.items.length})
          </h2>
        </div>
        {batch.items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No items recorded in this batch.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">PO qty</th>
                  <th className="px-4 py-2 text-right font-medium">Received</th>
                  <th className="px-4 py-2 text-right font-medium">Unit price</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((it) => (
                  <BatchItemRowRender
                    key={it.id}
                    item={it}
                    currency={batch.currency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Created by {batch.createdBy.name} on {formatDateTime(batch.createdAt)}
        {batch.completedBy && (
          <>
            {" · "}Completed by {batch.completedBy.name} on{" "}
            {formatDateTime(batch.completedAt)}
          </>
        )}
      </div>

      {/* Dialogs */}
      {openDialog === "receive" && (
        <ReceiveDialog
          batch={batch}
          users={users}
          onClose={() => setOpenDialog(null)}
          onDone={(next) => setBatch(next)}
        />
      )}
      {openDialog === "complete" && (
        <CompleteDialog
          batch={batch}
          onClose={() => setOpenDialog(null)}
          onDone={(next) => setBatch(next)}
        />
      )}
      {openDialog === "cancel" && (
        <CancelDialog
          onClose={() => setOpenDialog(null)}
          onConfirm={handleCancel}
          busy={busyAction === "cancel"}
        />
      )}
    </div>
  );
}

// ── Doc link tile ─────────────────────────────────────────────────────

function DocLink({
  label,
  url,
  number,
}: {
  label: string;
  url: string | null;
  number: string | null;
}) {
  const present = !!(url || number);
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        present ? "border-solid" : "border-dashed",
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {number ? (
        <div className="mt-1 font-mono text-sm">{number}</div>
      ) : (
        <div className="mt-1 text-xs italic text-muted-foreground">
          Not yet recorded
        </div>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <FileText className="h-3 w-3" /> View document
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

// ── Batch-item row ────────────────────────────────────────────────────

function BatchItemRowRender({
  item,
  currency,
}: {
  item: BatchItemRow;
  currency: string;
}) {
  // Per-line total: qtyReceived × unitPrice × (1 - disc%) × (1 + tax%)
  const qty = item.qtyReceived;
  const price = Number(item.purchaseOrderItem.unitPrice);
  const disc = Number(item.purchaseOrderItem.discountPercent);
  const tax = Number(item.purchaseOrderItem.taxPercent);
  const untaxed = qty * price * (1 - disc / 100);
  const total = untaxed * (1 + tax / 100);

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">{item.purchaseOrderItem.product.name}</div>
        <div className="text-xs text-muted-foreground">
          {[
            item.purchaseOrderItem.product.brand,
            item.purchaseOrderItem.product.model,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </td>
      <td className="px-4 py-3 text-right">{item.purchaseOrderItem.qty}</td>
      <td className="px-4 py-3 text-right font-medium">{item.qtyReceived}</td>
      <td className="px-4 py-3 text-right text-xs">
        {formatCurrency(item.purchaseOrderItem.unitPrice, currency)}
      </td>
      <td className="px-4 py-3 text-right">{formatCurrency(total, currency)}</td>
    </tr>
  );
}
