"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type { AssetDetail } from "@/types/admin";

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
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2">
      <dt className="w-40 shrink-0 text-sm font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────
export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const canUpdate = usePermission("assets:update");

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [loading, setLoading] = useState(true);

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
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading asset...</p>
      </div>
    );
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
    <div className="p-6" data-tour="asset-detail">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{asset.name}</h1>
          <p className="text-sm text-muted-foreground">{asset.assetNumber}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/assets"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Back to List
          </Link>
          {canUpdate && (
            <Link
              href={`/admin/assets/${asset.id}/edit`}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Edit
            </Link>
          )}
          <button
            type="button"
            onClick={() => alert("Print label feature coming soon.")}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Print Label
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Basic Info */}
        <div className="rounded-lg border bg-card p-5">
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
        <div className="rounded-lg border bg-card p-5">
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
            <InfoRow label="Vendor">{asset.vendor ?? "-"}</InfoRow>
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
        <div className="rounded-lg border bg-card p-5">
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
        <div className="rounded-lg border bg-card p-5">
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

      {/* Metadata */}
      <div className="mt-6 rounded-lg border bg-card p-5">
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
        <div className="mt-6 rounded-lg border bg-card p-5">
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
    </div>
  );
}
