"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import {
  UNIT_STATUS_HINT,
  formatBusinessDate,
  formatDate,
  formatDateTime,
  INSPECTION_REASON_LABEL,
  INSPECTION_RESULT_LABEL,
  VEHICLE_CONDITION_LABEL,
  unitEventLabel,
} from "@/lib/sms/labels";
import { UnitStatusBadge, ExRtoBadge } from "@/components/sms/unit-status-badge";
import { ReleaseDialog } from "@/components/sms/release-dialog";
import { InspectionDialog } from "@/components/sms/inspection-dialog";
import { ResolveIdentityDialog } from "@/components/sms/resolve-identity-dialog";
import { EditDetailsDialog } from "@/components/sms/edit-details-dialog";
import { useShowroom } from "@/components/sms/showroom-context";
import type { UnitDetail, UnitEventTimeline, UnitInspectionSummary } from "@/lib/sms/types";

type DialogKind =
  | "release"
  | "inspection-start"
  | "inspection-result"
  | "resolve-identity"
  | "edit-details"
  | null;

// ── Copy button ────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="ml-2 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Copy VIN"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Detail row ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1 py-1.5 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Timeline entry ─────────────────────────────────────────────────────

function TimelineEntry({ entry }: { entry: UnitEventTimeline }) {
  const lateInput =
    Math.abs(new Date(entry.recordedAt).getTime() - new Date(entry.eventDate).getTime()) >
    24 * 60 * 60 * 1000;

  return (
    <div
      className={`relative pl-6 pb-6 ${entry.isSuperseded || entry.isVoided ? "opacity-60" : ""}`}
    >
      {/* Vertical line */}
      <div className="absolute left-2 top-0 h-full w-px bg-border" />
      {/* Dot */}
      <div className="absolute left-0 top-1 h-4 w-4 rounded-full border-2 border-background bg-primary/30" />

      <div className="rounded-md border bg-card p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span
              className={`font-medium ${entry.isSuperseded || entry.isVoided ? "line-through" : ""}`}
            >
              {unitEventLabel(entry.eventType)}
            </span>
            {entry.isSuperseded && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Corrected
              </span>
            )}
            {entry.isVoided && (
              <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                Voided
              </span>
            )}
          </div>
          <UnitStatusBadge status={entry.statusAfter} />
        </div>

        <div className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium">{formatBusinessDate(entry.eventDate)}</span>
          {lateInput && (
            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
              recorded {formatDateTime(entry.recordedAt)}
            </span>
          )}
          {!lateInput && (
            <span className="ml-1">· recorded {formatDateTime(entry.recordedAt)}</span>
          )}
          {entry.performedBy && <span className="ml-1">by {entry.performedBy.name}</span>}
        </div>

        {entry.location && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            at {entry.location.name}
          </div>
        )}

        {(entry.reason ?? entry.notes) && (
          <div className="mt-1 text-xs text-muted-foreground">
            {entry.reason && <span>{entry.reason}</span>}
            {entry.reason && entry.notes && <span className="mx-1">·</span>}
            {entry.notes && <span>{entry.notes}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inspection entry ───────────────────────────────────────────────────

function InspectionEntry({ item }: { item: UnitInspectionSummary }) {
  const resultColors: Record<string, string> = {
    PASSED: "text-emerald-700 bg-emerald-50 border-emerald-200",
    FAILED: "text-red-700 bg-red-50 border-red-200",
    PENDING: "text-amber-700 bg-amber-50 border-amber-200",
  };
  const colorClass = resultColors[item.result] ?? "text-muted-foreground bg-muted border";

  return (
    <div className={`rounded-md border p-3 text-sm ${colorClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-medium">{INSPECTION_REASON_LABEL[item.reason] ?? item.reason}</span>
          <span className="ml-2 text-xs">
            {INSPECTION_RESULT_LABEL[item.result] ?? item.result}
          </span>
        </div>
        <span className="text-xs">{formatDate(item.inspectedAt ?? item.createdAt)}</span>
      </div>
      {item.condition && (
        <div className="mt-1 text-xs">
          Condition: {VEHICLE_CONDITION_LABEL[item.condition] ?? item.condition}
          {item.odometer != null && ` · ${item.odometer.toLocaleString()} km`}
        </div>
      )}
      {item.findings && <div className="mt-1 text-xs">{item.findings}</div>}
      {item.inspector && <div className="mt-0.5 text-xs opacity-70">Inspector: {item.inspector.name}</div>}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function UnitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useShowroom();

  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const fetchUnit = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<UnitDetail>(`/api/sms/units/${id}`);
      setUnit(data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setNotFound(true);
      } else {
        toast.error(smsErrorMessage(err, "Failed to load unit."));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchUnit();
  }, [fetchUnit]);

  const handleActionSuccess = () => {
    setDialog(null);
    void fetchUnit();
  };

  if (notFound) {
    return (
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-8 text-center">
          <p className="text-sm font-medium">Unit not found or you do not have access.</p>
          <Link href="/admin/sms/units" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to unit list
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="mb-4">
          <Skeleton className="mb-2 h-8 w-72" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!unit) return null;

  const hasActions = unit.availableActions.length > 0;
  const pendingInspection = unit.inspections.find((i) => i.result === "PENDING");
  const statusHint = UNIT_STATUS_HINT[unit.status as keyof typeof UNIT_STATUS_HINT];

  return (
    <div className="p-4 md:p-6" data-tour="sms-vin-card">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/admin/sms" className="hover:text-foreground">
          Stock
        </Link>
        {" / "}
        <Link href="/admin/sms/units" className="hover:text-foreground">
          Units
        </Link>
        {" / "}
        <span className="font-mono text-foreground">{unit.vin}</span>
      </nav>

      {/* Top block */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start gap-3">
          <span className="font-mono text-2xl font-bold tracking-tight sm:text-3xl">{unit.vin}</span>
          <CopyButton text={unit.vin} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <UnitStatusBadge status={unit.status} />
          {unit.wasRto && <ExRtoBadge />}
          {unit.isOpeningBalance && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              Opening balance
            </span>
          )}
        </div>
        {statusHint && <p className="mt-1 text-sm text-muted-foreground">{statusHint}</p>}
        <dl className="mt-3 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
          <div className="flex flex-wrap gap-x-1">
            <dt>Physically at:</dt>
            <dd className="font-medium text-foreground">
              {unit.physicalLocation?.name ?? "Not in a showroom"}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-1">
            <dt>Responsible showroom:</dt>
            <dd className="font-medium text-foreground">{unit.responsibleShowroom.name}</dd>
          </div>
        </dl>
      </div>

      {/* Action bar */}
      {(hasActions || unit.releaseBlockers.length > 0) && (
        <div className="mb-6 flex flex-wrap gap-2" data-tour="sms-action-bar">
          {unit.availableActions.includes("RELEASE") && (
            <button
              type="button"
              onClick={() => setDialog("release")}
              data-tour="sms-unit-release-btn"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Release unit
            </button>
          )}
          {unit.status === "INSPECTION" && unit.releaseBlockers.length > 0 && !unit.availableActions.includes("RELEASE") && can("sms-inspections:manage") && (
            <button
              type="button"
              onClick={() => setDialog("release")}
              className="rounded-md border border-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              View release blockers
            </button>
          )}
          {unit.availableActions.includes("RECORD_INSPECTION") && (
            <button
              type="button"
              onClick={() => setDialog(pendingInspection ? "inspection-result" : "inspection-start")}
              data-tour="sms-inspection-btn"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              {pendingInspection ? "Record inspection result" : "Start inspection"}
            </button>
          )}
          {unit.availableActions.includes("RESOLVE_IDENTITY") && (
            <button
              type="button"
              onClick={() => setDialog("resolve-identity")}
              data-tour="sms-resolve-identity-btn"
              className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              Resolve identity
            </button>
          )}
          {unit.availableActions.includes("EDIT_DETAILS") && (
            <button
              type="button"
              onClick={() => setDialog("edit-details")}
              data-tour="sms-edit-details-btn"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Edit details
            </button>
          )}
        </div>
      )}

      {/* Detail sections */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Identity */}
        <SectionCard title="Identity">
          <div className="divide-y">
            <DetailRow label="Model" value={unit.variant.model.name} />
            <DetailRow label="Variant" value={`${unit.variant.name}${unit.variant.batteryVariant ? ` / ${unit.variant.batteryVariant}` : ""}`} />
            <DetailRow label="Colour" value={unit.variant.color} />
            <DetailRow label="Engine number" value={unit.engineNumber ?? <span className="italic text-muted-foreground">Not recorded</span>} />
            <DetailRow label="License plate" value={unit.licensePlate ?? <span className="italic text-muted-foreground">Not recorded</span>} />
            {unit.notes && <DetailRow label="Notes" value={unit.notes} />}
          </div>
        </SectionCard>

        {/* Origin */}
        <SectionCard title="Origin">
          {unit.shipment ? (
            <div className="divide-y">
              <DetailRow label="Batch" value={unit.shipment.batchNumber} />
              <DetailRow
                label="Delivery note"
                value={
                  unit.shipment.id ? (
                    <Link
                      href={`/admin/sms/shipments/${unit.shipment.id}`}
                      className="text-primary hover:underline"
                    >
                      {unit.shipment.deliveryNoteNumber}
                    </Link>
                  ) : (
                    unit.shipment.deliveryNoteNumber
                  )
                }
              />
              <DetailRow label="Destination" value={unit.shipment.destination.name} />
              <DetailRow label="Dispatch date" value={unit.shipment.dispatchDate ? formatDate(unit.shipment.dispatchDate) : "—"} />
              <DetailRow label="Received" value={unit.receivedAt ? formatDate(unit.receivedAt) : "—"} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Entered as opening balance — earlier history is not available.
            </p>
          )}
        </SectionCard>
      </div>

      {/* Inspections */}
      {unit.inspections.length > 0 && (
        <div className="mt-4">
          <SectionCard title={`Inspections (${unit.inspections.length})`}>
            <div className="space-y-3">
              {unit.inspections.map((item) => (
                <InspectionEntry key={item.id} item={item} />
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Timeline */}
      <div className="mt-4">
        <SectionCard title="Movement history">
          {unit.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <div className="mt-2">
              {[...unit.timeline].reverse().map((entry) => (
                <TimelineEntry key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Dialogs */}
      {dialog === "release" && (
        <ReleaseDialog
          unitId={unit.id}
          releaseBlockers={unit.releaseBlockers}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog === "inspection-start" && (
        <InspectionDialog
          mode="start"
          unitId={unit.id}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog === "inspection-result" && pendingInspection && (
        <InspectionDialog
          mode="result"
          inspection={pendingInspection}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog === "resolve-identity" && (
        <ResolveIdentityDialog
          unitId={unit.id}
          currentVin={unit.vin}
          currentEngineNumber={unit.engineNumber}
          currentVariantId={unit.variant.id}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
      {dialog === "edit-details" && (
        <EditDetailsDialog
          unitId={unit.id}
          currentLicensePlate={unit.licensePlate}
          currentEngineNumber={unit.engineNumber}
          currentNotes={unit.notes}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
    </div>
  );
}
