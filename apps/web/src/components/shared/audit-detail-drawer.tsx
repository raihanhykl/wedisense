"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { apiGet } from "@/lib/api";
import { relativeTime, cn } from "@/lib/utils";
import type { AuditAction, AuditLogDto } from "@/types/admin";

// ── Action badge colour map ────────────────────────────────────────────
const ACTION_COLORS: Record<AuditAction, string> = {
  CREATE:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  UPDATE:
    "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  DELETE:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  LOGIN:
    "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
  LOGOUT:
    "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
  EXPORT:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  IMPORT:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  PRINT:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  APPROVE:
    "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  REJECT:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

// ── Resource → route map ──────────────────────────────────────────────
const RESOURCE_ROUTES: Record<string, (id: string) => string> = {
  Asset: (id) => `/admin/assets/${id}`,
  Role: (id) => `/admin/roles/${id}`,
  OnboardingTour: (id) => `/admin/tours/${id}`,
  User: () => `/admin/users`,
};

export interface AuditDetailDrawerProps {
  logId: string | null;
  onClose: () => void;
}

export function AuditActionBadge({ action }: { action: AuditAction }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        ACTION_COLORS[action],
      )}
    >
      {action}
    </span>
  );
}

// ── JSON side-by-side diff renderer ──────────────────────────────────
function JsonPanel({
  label,
  value,
  side,
}: {
  label: string;
  value: unknown;
  side: "before" | "after";
}) {
  const formatted = JSON.stringify(value, null, 2);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <p
        className={cn(
          "mb-1 text-xs font-semibold uppercase tracking-wide",
          side === "before" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {label}
      </p>
      <pre
        className={cn(
          "min-h-[80px] overflow-x-auto rounded-md border px-3 py-2 text-xs leading-relaxed",
          side === "before"
            ? "border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-900/10"
            : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/30 dark:bg-emerald-900/10",
        )}
      >
        {formatted}
      </pre>
    </div>
  );
}

// ── Focus trap ────────────────────────────────────────────────────────
function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active || !ref.current) return;

    const el = ref.current;
    const focusables = el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Move focus into the drawer.
    first?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [active, ref]);
}

export default function AuditDetailDrawer({
  logId,
  onClose,
}: AuditDetailDrawerProps) {
  const [entry, setEntry] = useState<AuditLogDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const drawerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const open = logId !== null;

  // Fetch detail when logId changes (and is non-null).
  useEffect(() => {
    if (!logId) {
      setEntry(null);
      setError("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    apiGet<AuditLogDto>(`/api/audit-logs/${logId}`)
      .then((data) => {
        if (!cancelled) setEntry(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load audit log details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [logId]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  // Focus trap.
  useFocusTrap(drawerRef, open && !loading);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  // Derive "view resource" link.
  const resourceLink = (() => {
    if (!entry) return null;
    const builder = RESOURCE_ROUTES[entry.resourceType];
    return builder ? builder(entry.resourceId) : null;
  })();

  const hasDiff = entry && (entry.oldValues !== null || entry.newValues !== null);

  return (
    <>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        onClick={handleBackdropClick}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-drawer-title"
        className={cn(
          // Base layout
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-card shadow-xl",
          "transition-transform duration-200 ease-out",
          // Desktop fixed width; mobile full-screen
          "sm:w-[480px]",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {entry ? (
              <>
                <AuditActionBadge action={entry.action} />
                <span
                  id="audit-drawer-title"
                  className="truncate text-sm font-semibold"
                >
                  {entry.resourceType}
                </span>
              </>
            ) : (
              <span
                id="audit-drawer-title"
                className="text-sm font-semibold text-muted-foreground"
              >
                Audit detail
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audit detail"
            className="ml-2 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="space-y-3 p-4">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-muted"
                  style={{ width: `${60 + (i % 3) * 15}%` }}
                />
              ))}
            </div>
          )}

          {error && !loading && (
            <div className="p-4 text-sm text-red-600">{error}</div>
          )}

          {entry && !loading && (
            <div className="space-y-5 p-4">
              {/* Timestamp + actor */}
              <div>
                <p
                  title={entry.createdAt}
                  className="text-sm font-medium"
                >
                  {relativeTime(entry.createdAt)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString("id-ID")}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {entry.user ? (
                    <>
                      by{" "}
                      <span className="font-medium text-foreground">
                        {entry.user.name}
                      </span>{" "}
                      <span className="text-xs">({entry.user.email})</span>
                    </>
                  ) : (
                    "by system"
                  )}
                </p>
              </div>

              {/* Meta block */}
              <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
                <MetaRow label="Log ID" value={entry.id} mono />
                <MetaRow label="Resource ID" value={entry.resourceId} mono />
                {entry.ipAddress && (
                  <MetaRow label="IP address" value={entry.ipAddress} />
                )}
                {entry.userAgent && (
                  <MetaRow
                    label="User agent"
                    value={entry.userAgent}
                    truncate
                  />
                )}
              </div>

              {/* Diff section */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Payload
                </h3>
                {hasDiff ? (
                  <div className="flex gap-3">
                    {entry.oldValues !== null && (
                      <JsonPanel
                        label="Before"
                        value={entry.oldValues}
                        side="before"
                      />
                    )}
                    {entry.newValues !== null && (
                      <JsonPanel
                        label="After"
                        value={entry.newValues}
                        side="after"
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No payload recorded for this action.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────── */}
        {entry && resourceLink && (
          <div className="shrink-0 border-t px-4 py-3">
            <Link
              href={resourceLink}
              onClick={onClose}
              className="text-sm font-medium text-primary hover:underline"
            >
              View {entry.resourceType} →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

// ── Small helper ──────────────────────────────────────────────────────
function MetaRow({
  label,
  value,
  mono = false,
  truncate = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-all",
          mono && "font-mono",
          truncate && "truncate",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
