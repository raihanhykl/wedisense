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
  History,
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
import { cn, formatIDR, relativeTime } from "@/lib/utils";
import { ProcurementBatchStatusBadge } from "@/components/shared/procurement-status-badge";
import { PurchaseOrderStatusBadge } from "@/components/shared/procurement-status-badge";
import type {
  BatchAuditEntry,
  ProcurementBatchAssetEntry,
  ProcurementBatchDetail,
} from "@/types/admin";

// ── Formatting helpers ─────────────────────────────────────────────────

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

function formatTotal(amount: string | null, currency: string): string {
  if (!amount) return "—";
  if (currency === "IDR") return formatIDR(amount);
  return `${currency} ${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(amount))}`;
}

function toIsoDate(d: string): string {
  return new Date(`${d}T12:00:00.000Z`).toISOString();
}

// ── Status-driven action availability ─────────────────────────────────

function canEdit(status: ProcurementBatchDetail["status"]): boolean {
  // COMPLETED + CANCELLED restrict to notes/attachments only (server-side
  // enforced). We still allow opening the edit dialog — the dialog scopes
  // its writeable set based on status, but for now block entirely for
  // these terminal states and surface a tooltip elsewhere.
  return status !== "COMPLETED" && status !== "CANCELLED";
}

function canSubmit(status: ProcurementBatchDetail["status"]): boolean {
  return status === "DRAFT";
}

function canReceive(status: ProcurementBatchDetail["status"]): boolean {
  return status === "ITEMS_PENDING";
}

function canComplete(status: ProcurementBatchDetail["status"]): boolean {
  return status === "RECEIVED";
}

function canCancelStatus(status: ProcurementBatchDetail["status"]): boolean {
  return status === "DRAFT" || status === "ITEMS_PENDING";
}

function canDelete(
  status: ProcurementBatchDetail["status"],
  assetCount: number,
): boolean {
  return status === "DRAFT" && assetCount === 0;
}

function canImport(status: ProcurementBatchDetail["status"]): boolean {
  return status === "DRAFT" || status === "ITEMS_PENDING";
}

// ── Generic modal shell ────────────────────────────────────────────────

interface ModalShellProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}

function ModalShell({ title, description, onClose, children }: ModalShellProps) {
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

// ── Receive dialog ────────────────────────────────────────────────────
//
// ITEMS_PENDING → RECEIVED. Captures the BAST chain + hybrid signatory.
// Backend enforces ≥1 of (receivedByUserId | receivedByName); we mirror
// that here with a UI-level check so the user gets immediate feedback.

interface ReceiveForm {
  bastNumber: string;
  bastDate: string;
  bastUrl: string;
  receivedDate: string;
  receivedByName: string;
  receivedByPosition: string;
}

interface UserOption {
  id: string;
  name: string;
}

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
  const [form, setForm] = useState<ReceiveForm>({
    bastNumber: batch.bastNumber ?? "",
    bastDate: batch.bastDate ? batch.bastDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    bastUrl: batch.bastUrl ?? "",
    receivedDate: batch.receivedDate
      ? batch.receivedDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    receivedByName: batch.receivedByName ?? "",
    receivedByPosition: batch.receivedByPosition ?? "",
  });
  const [receivedByUserId, setReceivedByUserId] = useState<string>(
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
        `/procurement-batches/${batch.id}/receive`,
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
      description="Records the BAST hand-over event. Requires BAST number, BAST date, and at least one signatory (internal user or external name)."
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
            onChange={(e) => setForm((f) => ({ ...f, receivedDate: e.target.value }))}
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

        <div className="md:col-span-2 mt-2 rounded-md border border-dashed p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signatory
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            At least one is required. Use the user picker for internal staff,
            or fill the name field for an external signer (vendor PIC, etc.).
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
    taxInvoiceDate: batch.taxInvoiceDate ? batch.taxInvoiceDate.slice(0, 10) : "",
    totalAmount: batch.totalAmount ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = form.invoiceNumber.trim().length > 0 && form.invoiceDate.length > 0;

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
        ...(form.totalAmount && { totalAmount: Number(form.totalAmount) }),
      };
      const updated = await apiPut<ProcurementBatchDetail>(
        `/procurement-batches/${batch.id}/complete`,
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
      description="Records invoice + tax invoice. After Complete the batch is locked — only notes and attachments can be edited."
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
            onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))}
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
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">
            Total amount (override, optional)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={form.totalAmount}
            onChange={(e) => setForm((f) => ({ ...f, totalAmount: e.target.value }))}
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
      description="A cancelled batch is excluded from the parent PO's status calculation. Cancellation is permanent and only allowed before Receive."
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
        <p className="mt-1 text-xs text-red-600">Reason must be at least 5 characters.</p>
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

// ── Edit dialog (metadata only) ───────────────────────────────────────

function EditDialog({
  batch,
  onClose,
  onSaved,
}: {
  batch: ProcurementBatchDetail;
  onClose: () => void;
  onSaved: (next: ProcurementBatchDetail) => void;
}) {
  const [form, setForm] = useState({
    name: batch.name ?? "",
    notes: batch.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name || null,
        notes: form.notes || null,
      };
      const updated = await apiPut<ProcurementBatchDetail>(
        `/procurement-batches/${batch.id}`,
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
    <ModalShell
      title="Edit batch"
      description="Use Receive / Complete to advance status. This dialog patches name and notes only — other fields are managed by the transition flows."
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={4}
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
    </ModalShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function ProcurementBatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const canUpdate = usePermission("procurement:update");
  const canCompleteAction = usePermission("procurement:complete");
  const canCancelAction = usePermission("procurement:cancel");
  const canImportAssets = usePermission("assets:import");

  const [batch, setBatch] = useState<ProcurementBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<BatchAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [openDialog, setOpenDialog] = useState<null | "edit" | "receive" | "complete" | "cancel">(null);
  const [busyAction, setBusyAction] = useState<null | "submit" | "cancel" | "delete">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchBatch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ProcurementBatchDetail>(`/procurement-batches/${id}`);
      setBatch(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load batch"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchAudit = useCallback(async () => {
    if (!id) return;
    setAuditLoading(true);
    try {
      const rows = await apiGet<BatchAuditEntry[]>(
        `/procurement-batches/${id}/audit`,
      );
      setAudit(rows);
    } catch {
      // Non-critical — surface "no audit available" instead of failing the
      // whole page.
      setAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchBatch();
    void fetchAudit();
  }, [fetchBatch, fetchAudit]);

  // Fetch user list once, used by the Receive dialog's signatory picker.
  // Active users only; loose limit covers most orgs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet<Array<{ id: string; name: string; status: string }>>(
          "/users",
          { limit: 200 },
        );
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
        `/procurement-batches/${batch.id}/submit`,
        {},
      );
      setBatch({ ...batch, ...updated });
      void fetchAudit();
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
        `/procurement-batches/${batch.id}/cancel`,
        { reason },
      );
      setBatch({ ...batch, ...updated });
      setOpenDialog(null);
      void fetchAudit();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to cancel batch"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!batch) return;
    if (!window.confirm(`Delete batch ${batch.batchNumber}? This cannot be undone.`)) {
      return;
    }
    setBusyAction("delete");
    setActionError(null);
    try {
      await apiDelete(`/procurement-batches/${batch.id}`);
      router.push("/admin/procurement");
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
        <Link
          href="/admin/procurement"
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
        href="/admin/procurement"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Procurement
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
              onClick={() => setOpenDialog("edit")}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
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

      {/* Parent PO panel */}
      {batch.purchaseOrder ? (
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
              <span>{batch.purchaseOrder.vendor}</span>
              <PurchaseOrderStatusBadge status={batch.purchaseOrder.status} />
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ) : (
        <div className="rounded-lg border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
          Direct-purchase batch — no parent Purchase Order.
        </div>
      )}

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
                {formatTotal(batch.totalAmount, batch.currency)}
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
                <div className="text-xs text-muted-foreground">
                  {batch.receivedBy.email}
                </div>
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

      {/* Documents row */}
      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Documents
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
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
          {batch.purchaseOrder && (
            <div className="rounded-md border border-dashed p-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                PO
              </div>
              <Link
                href={`/admin/purchase-orders/${batch.purchaseOrder.id}`}
                className="mt-1 inline-flex items-center gap-1 font-mono text-sm text-primary hover:underline"
              >
                {batch.purchaseOrder.poNumber}
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
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

      {/* Assets table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              Assets ({batch.assetCount})
            </h2>
          </div>
          {batch.assetCount > batch.assets.length && (
            <Link
              href={`/admin/assets?procurementBatchId=${batch.id}`}
              className="text-xs text-primary hover:underline"
            >
              See all {batch.assetCount} →
            </Link>
          )}
        </div>
        {batch.assets.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No assets linked yet.{" "}
            {canImportAssets && canImport(batch.status) && (
              <>
                Use{" "}
                <Link
                  href={`/admin/assets/import?batchId=${batch.id}`}
                  className="text-primary hover:underline"
                >
                  Import assets
                </Link>{" "}
                to add the first batch of items.
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Asset #</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Serial</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Condition</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {batch.assets.map((a) => (
                  <AssetRow key={a.id} asset={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit trail */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Audit trail</h2>
        </div>
        {auditLoading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : audit.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No audit entries yet.
          </div>
        ) : (
          <ul className="divide-y">
            {audit.slice(0, 25).map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                        entry.action === "CREATE"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : entry.action === "DELETE" || entry.action === "REJECT"
                          ? "bg-red-50 text-red-700 ring-red-600/20"
                          : "bg-blue-50 text-blue-700 ring-blue-600/20",
                      )}
                    >
                      {entry.action}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.resource_type}
                    </span>
                  </div>
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(entry.created_at)}
                  >
                    {relativeTime(entry.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
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
      {openDialog === "edit" && (
        <EditDialog
          batch={batch}
          onClose={() => setOpenDialog(null)}
          onSaved={(next) => {
            setBatch({ ...batch, ...next });
            void fetchAudit();
          }}
        />
      )}
      {openDialog === "receive" && (
        <ReceiveDialog
          batch={batch}
          users={users}
          onClose={() => setOpenDialog(null)}
          onDone={(next) => {
            setBatch({ ...batch, ...next });
            void fetchAudit();
          }}
        />
      )}
      {openDialog === "complete" && (
        <CompleteDialog
          batch={batch}
          onClose={() => setOpenDialog(null)}
          onDone={(next) => {
            setBatch({ ...batch, ...next });
            void fetchAudit();
          }}
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

// ── Asset row ─────────────────────────────────────────────────────────

function AssetRow({ asset }: { asset: ProcurementBatchAssetEntry }) {
  return (
    <tr className="border-b transition-colors last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <Link
          href={`/admin/assets/${asset.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {asset.assetNumber}
        </Link>
      </td>
      <td className="px-4 py-3">{asset.name}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {asset.serialNumber ?? "—"}
      </td>
      <td className="px-4 py-3 text-xs">{asset.status}</td>
      <td className="px-4 py-3 text-xs">{asset.condition}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatDate(asset.createdAt)}
      </td>
    </tr>
  );
}
