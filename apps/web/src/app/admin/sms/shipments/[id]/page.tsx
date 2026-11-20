"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatBusinessDate, formatDate, formatDateTime } from "@/lib/sms/labels";
import { useShowroom } from "@/components/sms/showroom-context";
import { ShipmentProgressBar } from "@/components/sms/shipment-progress-bar";
import { ShipmentReceiveDialog } from "@/components/sms/shipment-receive-dialog";
import { ShipmentDamageDialog } from "@/components/sms/shipment-damage-dialog";
import { ShipmentFindingDialog } from "@/components/sms/shipment-finding-dialog";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import { cn } from "@/lib/utils";
import type { ShipmentDetail, ShipmentLineDetail } from "@/lib/sms/shipments-types";

type LineFilter = "PENDING" | "RECEIVED_OK" | "RECEIVED_DAMAGED" | "DISCREPANCY" | "ALL";

const LINE_FILTER_TABS: Array<{ value: LineFilter; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "RECEIVED_OK", label: "Received" },
  { value: "RECEIVED_DAMAGED", label: "Damaged" },
  { value: "DISCREPANCY", label: "Discrepancy" },
  { value: "ALL", label: "All" },
];

const RECEIPT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RECEIVED_OK: "Received",
  RECEIVED_DAMAGED: "Damaged",
  DISCREPANCY: "Discrepancy",
};

const RECEIPT_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  RECEIVED_OK: "bg-emerald-100 text-emerald-800",
  RECEIVED_DAMAGED: "bg-orange-100 text-orange-800",
  DISCREPANCY: "bg-red-100 text-red-800",
};

interface PageProps {
  params: { id: string };
}

export default function ShipmentReceivingPage({ params }: PageProps) {
  const { id } = params;
  const { canAt } = useShowroom();

  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [lineFilter, setLineFilter] = useState<LineFilter>("PENDING");
  const [vinSearch, setVinSearch] = useState("");

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Dialogs
  const [receiveDialog, setReceiveDialog] = useState(false);
  const [damageDialog, setDamageDialog] = useState<ShipmentLineDetail | null>(null);
  const [findingDialog, setFindingDialog] = useState<ShipmentLineDetail | null>(null);
  const [findingFromPage, setFindingFromPage] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ShipmentDetail>(`/api/sms/shipments/${id}`);
      setShipment(data);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load shipment."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Clear selection when filter changes
  useEffect(() => { setSelected(new Set()); }, [lineFilter]);

  const canReceive = shipment
    ? canAt(SMS_PERMISSIONS.RECEIVING_MANAGE, shipment.destinationLocationId)
    : false;

  // Filtered and searched lines
  const filteredLines = useMemo(() => {
    if (!shipment) return [];
    let lines = shipment.lines;
    if (lineFilter !== "ALL") {
      lines = lines.filter((l) => l.receiptStatus === lineFilter);
    }
    if (vinSearch.trim()) {
      const q = vinSearch.trim().toUpperCase();
      lines = lines.filter((l) => l.vin.toUpperCase().includes(q));
    }
    return lines;
  }, [shipment, lineFilter, vinSearch]);

  const pendingLines = useMemo(
    () => (shipment?.lines ?? []).filter((l) => l.receiptStatus === "PENDING"),
    [shipment],
  );

  const selectedLines = useMemo(
    () => pendingLines.filter((l) => selected.has(l.id)),
    [pendingLines, selected],
  );

  const toggleLine = (lineId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const toggleAll = () => {
    const visiblePending = filteredLines.filter((l) => l.receiptStatus === "PENDING");
    const allSelected = visiblePending.every((l) => selected.has(l.id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        visiblePending.forEach((l) => next.delete(l.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        visiblePending.forEach((l) => next.add(l.id));
        return next;
      });
    }
  };

  const handleReceiveSuccess = () => {
    setReceiveDialog(false);
    setSelected(new Set());
    // If some items were "already received", that's fine — just refetch
    void load();
  };

  const handleDamageSuccess = () => {
    setDamageDialog(null);
    void load();
  };

  const handleFindingSuccess = () => {
    setFindingDialog(null);
    setFindingFromPage(false);
    void load();
  };

  const closeFindingDialog = () => {
    setFindingDialog(null);
    setFindingFromPage(false);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-3 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!shipment) return null;

  const visiblePending = filteredLines.filter((l) => l.receiptStatus === "PENDING");
  const allVisiblePendingSelected =
    visiblePending.length > 0 && visiblePending.every((l) => selected.has(l.id));

  return (
    <div className="p-4 md:p-6" data-tour="sms-shipment-receiving">
      {/* Header */}
      <div className="mb-4">
        <div className="mb-2 flex flex-wrap items-start gap-2">
          <Link href="/admin/sms/shipments" className="text-sm text-muted-foreground hover:text-foreground">
            ← Shipments
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{shipment.batchNumber}</h1>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>{shipment.destinationName}</span>
              {shipment.deliveryNoteNumber && <span>DN: {shipment.deliveryNoteNumber}</span>}
              {shipment.dispatchDate && (
                <span>Dispatched: {formatBusinessDate(shipment.dispatchDate)}</span>
              )}
              <span>Created: {formatDate(shipment.createdAt)}</span>
            </div>
            <div className="mt-2 max-w-xs">
              <ShipmentProgressBar counts={shipment.counts} />
            </div>
          </div>

          {/* Page-level actions */}
          {canReceive && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-tour="sms-record-finding-page"
                onClick={() => setFindingFromPage(true)}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent min-h-[36px]"
              >
                Record a finding…
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filters row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Line status tabs */}
        <div
          role="tablist"
          className="inline-flex rounded-md border bg-card p-0.5 overflow-x-auto"
        >
          {LINE_FILTER_TABS.map((t) => {
            const count =
              t.value === "ALL"
                ? shipment.lines.length
                : shipment.lines.filter((l) => l.receiptStatus === t.value).length;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={lineFilter === t.value}
                onClick={() => setLineFilter(t.value)}
                className={cn(
                  "shrink-0 rounded-sm px-3 py-1 text-xs font-medium whitespace-nowrap",
                  lineFilter === t.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label} {count > 0 && <span className="ml-0.5 opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>

        {/* VIN search */}
        <input
          type="search"
          placeholder="Find by last VIN digits…"
          value={vinSearch}
          onChange={(e) => setVinSearch(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Empty pending state */}
      {lineFilter === "PENDING" && pendingLines.length === 0 && !vinSearch && (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm font-medium">All units accounted for</p>
          <p className="mt-1 text-sm text-muted-foreground">
            There are no pending units in this batch.
          </p>
        </div>
      )}

      {/* Empty filtered state */}
      {filteredLines.length === 0 && (lineFilter !== "PENDING" || !!vinSearch) && (
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {vinSearch ? `No units matching "${vinSearch}"` : "No units in this category"}
          </p>
        </div>
      )}

      {/* Pending lines notice */}
      {lineFilter === "PENDING" && pendingLines.length > 0 && shipment.counts.pending > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          Units that have not arrived yet stay pending — come back to this batch when they do.
        </p>
      )}

      {/* Table — desktop */}
      {filteredLines.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {canReceive && lineFilter !== "ALL" && lineFilter !== "RECEIVED_OK" && lineFilter !== "RECEIVED_DAMAGED" && lineFilter !== "DISCREPANCY" && (
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allVisiblePendingSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded"
                        aria-label="Select all visible pending units"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-medium">VIN</th>
                  <th className="px-4 py-3 text-left font-medium">Engine</th>
                  <th className="px-4 py-3 text-left font-medium">Variant</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Received</th>
                  {canReceive && <th className="px-4 py-3 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLines.map((line) => (
                  <DesktopLineRow
                    key={line.id}
                    line={line}
                    canReceive={canReceive}
                    selected={selected.has(line.id)}
                    onToggle={() => toggleLine(line.id)}
                    onDamage={() => setDamageDialog(line)}
                    onFinding={() => setFindingDialog(line)}
                    showCheckbox={lineFilter === "PENDING" || lineFilter === "ALL"}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards — mobile */}
          <div className="space-y-3 md:hidden">
            {filteredLines.map((line) => (
              <MobileLineCard
                key={line.id}
                line={line}
                canReceive={canReceive}
                selected={selected.has(line.id)}
                onToggle={() => toggleLine(line.id)}
                onDamage={() => setDamageDialog(line)}
                onFinding={() => setFindingDialog(line)}
              />
            ))}
          </div>
        </>
      )}

      {/* Sticky bottom bar — only visible when items are selected */}
      {selected.size > 0 && canReceive && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <span className="text-sm font-medium">
              {selected.size} unit{selected.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent min-h-[36px]"
              >
                Clear
              </button>
              <button
                type="button"
                data-tour="sms-receive-selected-bar"
                onClick={() => setReceiveDialog(true)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 min-h-[36px]"
              >
                Receive selected ({selected.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {receiveDialog && (
        <ShipmentReceiveDialog
          shipmentId={id}
          lines={selectedLines}
          onClose={() => setReceiveDialog(false)}
          onSuccess={handleReceiveSuccess}
        />
      )}
      {damageDialog && (
        <ShipmentDamageDialog
          shipmentId={id}
          line={damageDialog}
          onClose={() => setDamageDialog(null)}
          onSuccess={handleDamageSuccess}
        />
      )}
      {(findingFromPage || findingDialog !== null) && (
        <ShipmentFindingDialog
          shipmentId={id}
          line={findingFromPage ? null : findingDialog}
          onClose={closeFindingDialog}
          onSuccess={handleFindingSuccess}
        />
      )}
    </div>
  );
}

// ── Desktop line row ───────────────────────────────────────────────────────

function DesktopLineRow({
  line,
  canReceive,
  selected,
  onToggle,
  onDamage,
  onFinding,
  showCheckbox,
}: {
  line: ShipmentLineDetail;
  canReceive: boolean;
  selected: boolean;
  onToggle: () => void;
  onDamage: () => void;
  onFinding: () => void;
  showCheckbox: boolean;
}) {
  const isPending = line.receiptStatus === "PENDING";
  const isReceived = line.receiptStatus === "RECEIVED_OK" || line.receiptStatus === "RECEIVED_DAMAGED";

  return (
    <tr className={cn(selected && "bg-primary/5")}>
      {canReceive && showCheckbox && (
        <td className="w-10 px-3 py-3">
          {isPending && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="h-5 w-5 rounded"
              aria-label={`Select ${line.vin}`}
            />
          )}
        </td>
      )}
      <td className="px-4 py-3 font-mono text-sm break-all">{line.vin}</td>
      <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
        {line.engineNumber ?? "—"}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {line.variantName
          ? `${line.modelName ?? ""} · ${line.variantName}`
          : [line.rawModel, line.rawVariant, line.rawColor].filter(Boolean).join(" · ") || "—"}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            RECEIPT_STATUS_STYLE[line.receiptStatus],
          )}
        >
          {RECEIPT_STATUS_LABEL[line.receiptStatus]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {isReceived ? (
          <span>
            {formatDateTime(line.receivedAt)}
            {line.receivedByName && <span className="block">{line.receivedByName}</span>}
          </span>
        ) : (
          "—"
        )}
        {line.unit && (
          <Link
            href={`/admin/sms/units/${line.unit.id}`}
            className="mt-0.5 block text-primary hover:underline"
          >
            View unit
          </Link>
        )}
      </td>
      {canReceive && (
        <td className="px-4 py-3 text-right">
          {isPending && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onDamage}
                className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent min-h-[36px]"
              >
                Arrived damaged…
              </button>
              <button
                type="button"
                onClick={onFinding}
                className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent min-h-[36px]"
              >
                Finding…
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

// ── Mobile line card ───────────────────────────────────────────────────────

function MobileLineCard({
  line,
  canReceive,
  selected,
  onToggle,
  onDamage,
  onFinding,
}: {
  line: ShipmentLineDetail;
  canReceive: boolean;
  selected: boolean;
  onToggle: () => void;
  onDamage: () => void;
  onFinding: () => void;
}) {
  const isPending = line.receiptStatus === "PENDING";
  const isReceived = line.receiptStatus === "RECEIVED_OK" || line.receiptStatus === "RECEIVED_DAMAGED";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4",
        selected && "border-primary bg-primary/5",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Large checkbox area for phone use */}
        {canReceive && isPending && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Select ${line.vin}`}
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-background"
          >
            {selected && (
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium break-all">{line.vin}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                RECEIPT_STATUS_STYLE[line.receiptStatus],
              )}
            >
              {RECEIPT_STATUS_LABEL[line.receiptStatus]}
            </span>
          </div>
          {line.engineNumber && (
            <p className="text-xs text-muted-foreground">Engine: {line.engineNumber}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {line.variantName
              ? `${line.modelName ?? ""} · ${line.variantName}`
              : [line.rawModel, line.rawVariant, line.rawColor].filter(Boolean).join(" · ") || "—"}
          </p>
          {isReceived && line.receivedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(line.receivedAt)}
              {line.receivedByName && ` · ${line.receivedByName}`}
            </p>
          )}
          {line.unit && (
            <Link
              href={`/admin/sms/units/${line.unit.id}`}
              className="mt-1 text-xs text-primary hover:underline"
            >
              View unit
            </Link>
          )}
          {canReceive && isPending && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onDamage}
                className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent min-h-[36px]"
              >
                Arrived damaged…
              </button>
              <button
                type="button"
                onClick={onFinding}
                className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent min-h-[36px]"
              >
                Finding…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
