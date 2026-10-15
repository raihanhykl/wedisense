"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";

// ── Row model ──────────────────────────────────────────────────────
interface DraftRow {
  localId: string;
  name: string;
  employeeId: string;
  email: string;
  phone: string;
}

function newRowId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyRow(): DraftRow {
  return { localId: newRowId(), name: "", employeeId: "", email: "", phone: "" };
}

// Server-side per-row conflict (409 BULK_USERS_CONFLICT details[]).
interface ServerRowError {
  index: number;
  field: "employeeId" | "email";
  message: string;
}

function extractServerRowErrors(err: unknown): ServerRowError[] | null {
  if (!axios.isAxiosError(err)) return null;
  const error = err.response?.data?.error as
    | { code?: string; details?: unknown[] }
    | undefined;
  if (error?.code !== "BULK_USERS_CONFLICT" || !Array.isArray(error.details)) {
    return null;
  }
  return error.details.filter(
    (d): d is ServerRowError =>
      typeof d === "object" &&
      d !== null &&
      typeof (d as ServerRowError).index === "number" &&
      typeof (d as ServerRowError).message === "string",
  );
}

// ── Paste parsing ──────────────────────────────────────────────────
// Accepts what people actually paste from a spreadsheet or HR email:
// one employee per line, columns separated by tab / comma / semicolon /
// pipe, in the order  Name, Employee ID, Email, Phone. A header row
// (first cell says "name" / "nama") is skipped. Email and phone are
// optional; a cell that looks like an email is accepted in either of
// the last two positions so "Name, ID, Phone, Email" also works.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parsePastedEmployees(text: string): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(/\t|;|\||,/).map((c) => c.trim());
    const [name = "", employeeId = "", third = "", fourth = ""] = cells;
    if (rows.length === 0 && /^(name|nama)$/i.test(name)) continue;

    let email = "";
    let phone = "";
    for (const cell of [third, fourth]) {
      if (!cell) continue;
      if (EMAIL_RE.test(cell)) email = email || cell;
      else phone = phone || cell;
    }
    rows.push({ localId: newRowId(), name, employeeId, email, phone });
  }
  return rows;
}

// ── Component ──────────────────────────────────────────────────────
interface BulkEmployeeDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (createdCount: number) => void;
}

export default function BulkEmployeeDialog({
  open,
  onClose,
  onSuccess,
}: BulkEmployeeDialogProps) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<ServerRowError[]>([]);

  useEffect(() => {
    if (open) {
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      setPasteOpen(false);
      setPasteText("");
      setSubmitError(null);
      setServerErrors([]);
    }
  }, [open]);

  // Client-side validation mirrors the backend's: required name + ID,
  // valid email when present, no repeated IDs / emails in the sheet.
  const rowIssues = useMemo(() => {
    const issues = new Map<string, string[]>();
    const seenIds = new Map<string, string>();
    const seenEmails = new Map<string, string>();
    for (const row of rows) {
      const list: string[] = [];
      const name = row.name.trim();
      const employeeId = row.employeeId.trim();
      const email = row.email.trim().toLowerCase();
      const isBlank = !name && !employeeId && !email && !row.phone.trim();
      if (isBlank) continue; // fully empty rows are dropped on submit
      if (!name) list.push("Name is required");
      if (!employeeId) list.push("Employee ID is required");
      if (email && !EMAIL_RE.test(email)) list.push("Invalid email");
      if (employeeId) {
        const key = employeeId.toLowerCase();
        if (seenIds.has(key)) list.push("Duplicate employee ID in this list");
        else seenIds.set(key, row.localId);
      }
      if (email) {
        if (seenEmails.has(email)) list.push("Duplicate email in this list");
        else seenEmails.set(email, row.localId);
      }
      if (list.length > 0) issues.set(row.localId, list);
    }
    return issues;
  }, [rows]);

  const filledRows = useMemo(
    () =>
      rows.filter(
        (r) => r.name.trim() || r.employeeId.trim() || r.email.trim() || r.phone.trim(),
      ),
    [rows],
  );

  const canSubmit = !submitting && filledRows.length > 0 && rowIssues.size === 0;

  const updateRow = (localId: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
    setServerErrors([]);
  };

  const removeRow = (localId: string) => {
    setRows((prev) => prev.filter((r) => r.localId !== localId));
    setServerErrors([]);
  };

  const applyPaste = () => {
    const parsed = parsePastedEmployees(pasteText);
    if (parsed.length === 0) return;
    setRows((prev) => {
      // Replace trailing blank rows rather than leaving them under the
      // pasted block.
      const kept = prev.filter(
        (r) => r.name.trim() || r.employeeId.trim() || r.email.trim() || r.phone.trim(),
      );
      return [...kept, ...parsed];
    });
    setPasteText("");
    setPasteOpen(false);
    setServerErrors([]);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setServerErrors([]);
    try {
      const payload = {
        users: filledRows.map((r) => ({
          name: r.name.trim(),
          employeeId: r.employeeId.trim(),
          email: r.email.trim() || null,
          phone: r.phone.trim() || null,
        })),
      };
      const created = await apiPost<Array<{ id: string }>>("/api/users/bulk", payload);
      toast.success(`${created.length} employee(s) created`);
      onSuccess(created.length);
      onClose();
    } catch (err) {
      const perRow = extractServerRowErrors(err);
      if (perRow && perRow.length > 0) {
        setServerErrors(perRow);
        setSubmitError(
          `${perRow.length} row(s) conflict with existing employees — nothing was created. Fix the highlighted rows and retry.`,
        );
      } else {
        setSubmitError(getApiErrorMessage(err, "Failed to create employees"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  // Server errors are indexed against the FILLED rows we sent.
  const serverErrorsByLocalId = new Map<string, string[]>();
  for (const e of serverErrors) {
    const row = filledRows[e.index];
    if (!row) continue;
    const list = serverErrorsByLocalId.get(row.localId) ?? [];
    list.push(e.message);
    serverErrorsByLocalId.set(row.localId, list);
  }

  const inputClass =
    "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border bg-card shadow-lg">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Add employees in bulk</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Creates employee records only — no login accounts. Name and
            Employee ID are required; email and phone are optional. Accounts
            can be granted later per employee from the Users page.
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {/* Paste helper */}
          <div className="rounded-md border bg-muted/30">
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-accent"
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste from spreadsheet
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                Name, Employee ID, Email, Phone — one per line
              </span>
            </button>
            {pasteOpen && (
              <div className="space-y-2 border-t p-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                  placeholder={"Budi Santoso\tEMP-0101\tbudi@wedison.co.id\t0812…\nSiti Rahma\tEMP-0102"}
                  className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPasteOpen(false)}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyPaste}
                    disabled={!pasteText.trim()}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Add rows
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Row editor */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-8 pb-2 pr-2">#</th>
                <th className="pb-2 pr-2">Name *</th>
                <th className="pb-2 pr-2">Employee ID *</th>
                <th className="pb-2 pr-2">Email</th>
                <th className="pb-2 pr-2">Phone</th>
                <th className="w-8 pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const issues = [
                  ...(rowIssues.get(row.localId) ?? []),
                  ...(serverErrorsByLocalId.get(row.localId) ?? []),
                ];
                return (
                  <tr key={row.localId} className="align-top">
                    <td className="py-1 pr-2 text-xs text-muted-foreground">{index + 1}</td>
                    <td className="py-1 pr-2">
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(row.localId, { name: e.target.value })}
                        className={cn(inputClass, issues.length > 0 && "border-amber-400")}
                        placeholder="Full name"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={row.employeeId}
                        onChange={(e) => updateRow(row.localId, { employeeId: e.target.value })}
                        className={cn(inputClass, "font-mono")}
                        placeholder="EMP-0001"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="email"
                        value={row.email}
                        onChange={(e) => updateRow(row.localId, { email: e.target.value })}
                        className={inputClass}
                        placeholder="optional"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={row.phone}
                        onChange={(e) => updateRow(row.localId, { phone: e.target.value })}
                        className={inputClass}
                        placeholder="optional"
                      />
                      {issues.length > 0 && (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{issues.join(" · ")}</span>
                        </p>
                      )}
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        onClick={() => removeRow(row.localId)}
                        aria-label="Remove row"
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
            className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Add row
          </button>

          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {submitError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {filledRows.length} employee(s) ready
            {rowIssues.size > 0 && ` · ${rowIssues.size} row(s) need attention`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Creating…" : `Create ${filledRows.length || ""} employee(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
