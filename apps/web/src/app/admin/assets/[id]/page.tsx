"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { apiGet, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import { Skeleton } from "@/components/ui/skeleton";
import PrintDialog from "@/components/shared/print-dialog";
import Breadcrumb from "@/components/shared/breadcrumb";
import { ProcurementBatchStatusBadge } from "@/components/shared/procurement-status-badge";
import type { AssetDetail } from "@/types/admin";

// ── Skeleton matching the real detail layout so swap-in is non-jarring.
function DetailSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border bg-card p-4 md:p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status badge ────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  IDLE: "bg-gray-100 text-gray-800",
  IN_MAINTENANCE: "bg-yellow-100 text-yellow-800",
  DISPOSED: "bg-red-100 text-red-800",
  LOST: "bg-red-100 text-red-800",
  BORROWED: "bg-blue-100 text-blue-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Currency formatter ──────────────────────────────────────────────
const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatIDR(value: string | null): string {
  if (!value) return "-";
  const num = Number(value);
  if (isNaN(num)) return "-";
  return idrFormatter.format(num);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── Movement type ───────────────────────────────────────────────────
interface AssetMovement {
  id: string;
  movementType: string;
  referenceNumber: string;
  status: string;
  fromLocation: { id: string; name: string } | null;
  toLocation: { id: string; name: string } | null;
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  performedBy: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
}

// ── Info row ────────────────────────────────────────────────────────
// On mobile (<sm) the label sits ABOVE the value so long values aren't
// crammed into the narrow column to the right of a fixed-width label.
// On sm+ the original two-column layout is back.
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-40 sm:shrink-0 sm:text-sm sm:normal-case sm:tracking-normal">
        {label}
      </dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────
export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const canUpdate = usePermission("assets:update");
  const canPrint = usePermission("assets:print");
  const canDelete = usePermission("assets:delete");

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!asset) return;
    if (
      !confirm(
        `Delete asset ${asset.assetNumber}? This cannot be undone — make sure you've recorded a DISPOSAL movement first if this asset has any history.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await apiDelete(`/api/assets/${asset.id}`);
      toast.success(`Asset ${asset.assetNumber} deleted.`);
      router.push("/admin/assets");
    } catch (err: unknown) {
      // Backend may 409 if asset has non-INITIAL movements and is not in a
      // terminal state — surface the message instead of failing silently.
      toast.error(
        getApiErrorMessage(err, "Failed to delete asset. Please try again."),
      );
      setDeleting(false);
    }
  }, [asset, router]);

  const fetchAsset = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<AssetDetail>(`/api/assets/${params.id}`);
      setAsset(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  const fetchMovements = useCallback(async () => {
    try {
      const data = await apiGet<AssetMovement[]>(
        `/api/assets/${params.id}/movements`,
        { limit: 5 },
      );
      setMovements(data);
    } catch {
      // movements endpoint may not exist yet
    }
  }, [params.id]);

  useEffect(() => {
    void fetchAsset();
    void fetchMovements();
  }, [fetchAsset, fetchMovements]);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Asset not found.</p>
        <button
          type="button"
          onClick={() => router.push("/admin/assets")}
          className="mt-4 text-sm text-primary hover:underline"
        >
          Back to Assets
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6" data-tour="asset-detail">
      <Breadcrumb
        items={[
          { label: "Assets", href: "/admin/assets" },
          { label: asset.name },
        ]}
      />
      {/* Header — stacks vertically on mobile so the title doesn't get
          squashed and the 4 buttons have room to wrap. */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">
            {asset.name}
          </h1>
          <p className="text-sm text-muted-foreground">{asset.assetNumber}</p>
        </div>
        <div className="-mx-1 flex flex-wrap gap-2 sm:mx-0">
          {canUpdate && (
            <Link
              href={`/admin/assets/${asset.id}/edit`}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:px-4"
            >
              Edit
            </Link>
          )}
          {canPrint && (
            <button
              type="button"
              onClick={() => setPrintDialogOpen(true)}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent sm:px-4"
            >
              Print
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50 sm:px-4"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Basic Info */}
        <div className="rounded-lg border bg-card p-4 md:p-5">
          <h2 className="mb-4 text-lg font-semibold">Basic Info</h2>
          <dl className="divide-y">
            <InfoRow label="Asset Number">{asset.assetNumber}</InfoRow>
            <InfoRow label="Name">{asset.name}</InfoRow>
            <InfoRow label="Product">
              {asset.product
                ? `${asset.product.name}${asset.product.brand ? ` (${asset.product.brand})` : ""}`
                : "-"}
            </InfoRow>
            <InfoRow label="Serial Number">
              {asset.serialNumber ?? "-"}
            </InfoRow>
            <InfoRow label="Status">
              <StatusBadge status={asset.status} />
            </InfoRow>
            <InfoRow label="Condition">{asset.condition}</InfoRow>
            <InfoRow label="Location">{asset.location.name}</InfoRow>
            <InfoRow label="Assigned To">
              {asset.assignedTo ? (
                <span>
                  {asset.assignedTo.name}{" "}
                  <span className="text-muted-foreground">
                    ({asset.assignedTo.email})
                  </span>
                </span>
              ) : (
                "-"
              )}
            </InfoRow>
            <InfoRow label="Notes">{asset.notes ?? "-"}</InfoRow>
          </dl>
        </div>

        {/* Financial */}
        <div className="rounded-lg border bg-card p-4 md:p-5">
          <h2 className="mb-4 text-lg font-semibold">Financial</h2>
          <dl className="divide-y">
            <InfoRow label="Purchase Date">
              {formatDate(asset.purchaseDate)}
            </InfoRow>
            <InfoRow label="Purchase Price">
              {formatIDR(asset.purchasePrice)}
            </InfoRow>
            <InfoRow label="Current Book Value">
              {formatIDR(asset.currentBookValue)}
            </InfoRow>
            <InfoRow label="Vendor">
              {asset.vendor ? (
                <Link
                  href={`/admin/vendors/${asset.vendor.id}`}
                  className="text-primary hover:underline"
                >
                  {asset.vendor.name}
                </Link>
              ) : (
                asset.vendorLegacy ?? "-"
              )}
            </InfoRow>
            <InfoRow label="Invoice Number">
              {asset.invoiceNumber ?? "-"}
            </InfoRow>
            <InfoRow label="Useful Life">
              {asset.usefulLifeMonths
                ? `${asset.usefulLifeMonths} months`
                : "-"}
            </InfoRow>
          </dl>
        </div>

        {/* Warranty */}
        <div className="rounded-lg border bg-card p-4 md:p-5">
          <h2 className="mb-4 text-lg font-semibold">Warranty</h2>
          <dl className="divide-y">
            <InfoRow label="Warranty Start">
              {formatDate(asset.warrantyStartDate)}
            </InfoRow>
            <InfoRow label="Warranty End">
              {formatDate(asset.warrantyEndDate)}
            </InfoRow>
          </dl>
        </div>

        {/* Assignment / Barcode */}
        <div className="rounded-lg border bg-card p-4 md:p-5">
          <h2 className="mb-4 text-lg font-semibold">Barcode</h2>
          <dl className="divide-y">
            <InfoRow label="Barcode Type">{asset.barcodeType}</InfoRow>
            <InfoRow label="Barcode Value">{asset.barcodeValue}</InfoRow>
          </dl>
          {asset.barcodeImageUrl && (
            <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.barcodeImageUrl}
                alt={`Barcode for ${asset.assetNumber}`}
                className="max-h-24"
              />
            </div>
          )}
        </div>
      </div>

      {/* Procurement provenance — only rendered for assets created via a
          procurement batch. Two-link layout: jump straight to either the
          batch (for receipt details) or the parent PO (for the original
          order). */}
      {asset.procurementBatch && (
        <div className="mt-6 rounded-lg border bg-card p-4 md:p-5">
          <h2 className="mb-4 text-lg font-semibold">Procurement</h2>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <InfoRow label="Purchase Order">
              <Link
                href={`/admin/purchase-orders/${asset.procurementBatch.purchaseOrder.id}`}
                className="font-mono text-sm font-medium text-primary hover:underline"
              >
                {asset.procurementBatch.purchaseOrder.poNumber}
              </Link>
              <span className="ml-2 text-xs text-muted-foreground">
                {asset.procurementBatch.purchaseOrder.vendor.name}
              </span>
            </InfoRow>
            <InfoRow label="PO Date">
              {formatDate(asset.procurementBatch.purchaseOrder.poDate)}
            </InfoRow>
            <InfoRow label="Batch">
              <Link
                href={`/admin/purchase-orders/${asset.procurementBatch.purchaseOrder.id}/batches/${asset.procurementBatch.id}`}
                className="font-mono text-sm font-medium text-primary hover:underline"
              >
                {asset.procurementBatch.batchNumber}
              </Link>
              <span className="ml-2">
                <ProcurementBatchStatusBadge
                  status={asset.procurementBatch.status}
                />
              </span>
            </InfoRow>
            <InfoRow label="BAST">
              {asset.procurementBatch.bastNumber ?? "-"}
              {asset.procurementBatch.receivedDate && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({formatDate(asset.procurementBatch.receivedDate)})
                </span>
              )}
            </InfoRow>
          </dl>
        </div>
      )}

      {/* Metadata */}
      <div className="mt-6 rounded-lg border bg-card p-4 md:p-5">
        <h2 className="mb-4 text-lg font-semibold">Metadata</h2>
        <dl className="grid gap-x-8 sm:grid-cols-3">
          <InfoRow label="Created By">
            {asset.createdBy?.name ?? "-"}
          </InfoRow>
          <InfoRow label="Created At">{formatDate(asset.createdAt)}</InfoRow>
          <InfoRow label="Updated At">{formatDate(asset.updatedAt)}</InfoRow>
        </dl>
      </div>

      {/* Recent Movements */}
      {movements.length > 0 && (
        <div className="mt-6 rounded-lg border bg-card p-4 md:p-5">
          <h2 className="mb-4 text-lg font-semibold">Recent Movements</h2>
          <div className="space-y-4">
            {movements.map((movement) => (
              <div
                key={movement.id}
                className="relative border-l-2 border-muted pl-4"
              >
                <div className="absolute -left-1.5 top-1 h-3 w-3 rounded-full bg-primary" />
                <p className="text-sm font-medium">
                  {(movement.movementType ?? "").replace(/_/g, " ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {movement.fromLocation?.name ?? "N/A"} &rarr;{" "}
                  {movement.toLocation?.name ?? "N/A"}
                </p>
                {movement.notes && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {movement.notes}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(movement.createdAt)}
                  {movement.performedBy
                    ? ` by ${movement.performedBy.name}`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Single-asset print dialog. Reuses the same component the list view
          uses for bulk print — assetIds is a 1-element array here. */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        assetIds={[asset.id]}
      />
    </div>
  );
}
