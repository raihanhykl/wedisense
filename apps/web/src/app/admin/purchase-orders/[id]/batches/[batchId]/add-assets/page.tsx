"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, ScanLine } from "lucide-react";
import Breadcrumb from "@/components/shared/breadcrumb";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import BarcodeScanner from "@/components/barcode/barcode-scanner";
import type { ProcurementBatchDetail } from "@/types/admin";

// Phase 17 v2 / spec §3 — receipt-integrity workflow.
//
// After the user submits a DRAFT batch with qtyReceived per BatchItem,
// the backend transitions it to ITEMS_PENDING. Before "Mark Received"
// is allowed, every physical unit must be logged as an Asset row. This
// page renders one input row per missing unit (per BatchItem), with:
//   - product name (read-only, inherited from the BatchItem)
//   - asset name (auto-filled "{Product} - Unit N", editable)
//   - optional serial number + camera scan button
// On submit: POST /api/assets/bulk with each row linked to this batch
// via procurementBatchId. Existing bulkCreateAssets service handles
// asset-number generation, serial-uniqueness check, and the batch /
// PO assetCount increment cascade atomically.

interface AssetRow {
  batchItemId: string;
  productId: string;
  productName: string;
  unitLabel: string; // "Unit 1", "Unit 2", … (display + name suffix)
  name: string;
  serialNumber: string;
}

interface LocationOption {
  id: string;
  name: string;
  code: string;
}

export default function AddBatchAssetsPage() {
  const router = useRouter();
  const params = useParams<{ id: string; batchId: string }>();
  const poId = params?.id;
  const batchId = params?.batchId;

  const canUpdate = usePermission("procurement:update");

  const [batch, setBatch] = useState<ProcurementBatchDetail | null>(null);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scannerIdx, setScannerIdx] = useState<number | null>(null);

  // Load locations + batch in parallel. Batch detail carries items
  // (BatchItem.qtyReceived) and existing assets (productId), enough to
  // compute how many rows we still need to render per product.
  const fetchAll = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const [b, locs] = await Promise.all([
        apiGet<ProcurementBatchDetail>(`/api/procurement-batches/${batchId}`),
        apiGet<LocationOption[]>("/api/locations", { limit: 200 }),
      ]);
      setBatch(b);
      setLocations(locs);

      // Default the location selector to the batch's defaultLocation
      // if present — most receipts go to a single warehouse. User can
      // override before submit.
      if (b.defaultLocationId) {
        setLocationId(b.defaultLocationId);
      }

      // Build rows: per BatchItem, render (qtyReceived − existingAssets
      // of that product) input rows. Existing assets are counted by
      // productId since BatchItem has no direct FK to Asset.
      const existingByProduct = new Map<string, number>();
      for (const a of b.assets ?? []) {
        existingByProduct.set(
          a.productId,
          (existingByProduct.get(a.productId) ?? 0) + 1,
        );
      }
      const next: AssetRow[] = [];
      for (const item of b.items ?? []) {
        const product = item.purchaseOrderItem.product;
        const expected = item.qtyReceived;
        const existing = existingByProduct.get(product.id) ?? 0;
        const toCreate = Math.max(0, expected - existing);
        for (let i = 0; i < toCreate; i++) {
          const unitNumber = existing + i + 1;
          const unitLabel = `Unit ${unitNumber}`;
          next.push({
            batchItemId: item.id,
            productId: product.id,
            productName: product.name,
            unitLabel,
            name: `${product.name} - ${unitLabel}`,
            serialNumber: "",
          });
        }
      }
      setRows(next);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load batch"));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const updateRow = (idx: number, patch: Partial<AssetRow>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  // Within-form duplicate serial check — matches the multi-asset-create
  // form pattern. Empty serials are skipped (backend allows blank).
  const duplicateSerialIndices = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    rows.forEach((r, i) => {
      const s = r.serialNumber.trim().toLowerCase();
      if (!s) return;
      const first = seen.get(s);
      if (first !== undefined) {
        dupes.add(first);
        dupes.add(i);
      } else {
        seen.set(s, i);
      }
    });
    return dupes;
  }, [rows]);

  const canSubmit =
    !submitting &&
    rows.length > 0 &&
    locationId !== "" &&
    rows.every((r) => r.name.trim() !== "") &&
    duplicateSerialIndices.size === 0;

  const handleSubmit = async () => {
    if (!batch || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        assets: rows.map((r) => ({
          productId: r.productId,
          name: r.name.trim(),
          locationId,
          procurementBatchId: batch.id,
          ...(r.serialNumber.trim() && {
            serialNumber: r.serialNumber.trim(),
          }),
        })),
      };
      await apiPost("/api/assets/bulk", payload);
      router.push(`/admin/purchase-orders/${poId}/batches/${batch.id}`);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "Failed to create assets"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canUpdate) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You don&apos;t have permission to add assets to a procurement batch.
        </div>
      </div>
    );
  }

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

  // Status gating — backend bulkCreateAssets also enforces this via
  // assertBatchAcceptsAssets, but a friendlier client-side block here
  // avoids the round-trip and an unhelpful 409.
  const acceptsAssets =
    batch.status === "DRAFT" || batch.status === "ITEMS_PENDING";

  if (!acceptsAssets) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link
          href={`/admin/purchase-orders/${poId}/batches/${batch.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to batch
        </Link>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Assets can only be added while the batch is DRAFT or ITEMS_PENDING.
          Current status: <span className="font-medium">{batch.status}</span>.
        </div>
      </div>
    );
  }

  // All required assets already exist — render a friendly "done" state
  // so the user can navigate back without confusion.
  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link
          href={`/admin/purchase-orders/${poId}/batches/${batch.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to batch
        </Link>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-medium">All assets recorded.</p>
              <p className="mt-1 text-xs">
                Every received unit for this batch has a corresponding
                asset entry. You can proceed to{" "}
                <Link
                  href={`/admin/purchase-orders/${poId}/batches/${batch.id}`}
                  className="underline hover:no-underline"
                >
                  Mark Received
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Group rows by product for visual chunking — easier to scan a long
  // list when each product's units are clustered with a header.
  const groupedRows: Array<{
    productId: string;
    productName: string;
    rowIndices: number[];
  }> = [];
  const groupIndexByProduct = new Map<string, number>();
  rows.forEach((r, idx) => {
    const existing = groupIndexByProduct.get(r.productId);
    if (existing !== undefined) {
      groupedRows[existing]!.rowIndices.push(idx);
    } else {
      groupIndexByProduct.set(r.productId, groupedRows.length);
      groupedRows.push({
        productId: r.productId,
        productName: r.productName,
        rowIndices: [idx],
      });
    }
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "Purchase Orders", href: "/admin/purchase-orders" },
          {
            label: batch.purchaseOrder?.poNumber ?? "PO",
            href: `/admin/purchase-orders/${poId}`,
          },
          {
            label: batch.batchNumber,
            href: `/admin/purchase-orders/${poId}/batches/${batch.id}`,
          },
          { label: "Add assets" },
        ]}
      />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add assets</h1>
        <p className="text-sm text-muted-foreground">
          One row per physical unit. Asset numbers (WDS-…) are generated
          automatically on save. Serial numbers are optional — leave blank
          for items without a serial sticker.
        </p>
      </div>

      {/* Location applies to every row in this submission. Single picker
          to keep the form short; per-row location overrides are out of
          scope for v1. */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">Location</legend>
        <p className="mb-2 text-xs text-muted-foreground">
          Where these units physically live. Applied to every row below.
        </p>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="">— Select a location —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>
      </fieldset>

      {/* Rows */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">
          New asset rows ({rows.length})
        </legend>

        <div className="space-y-4">
          {groupedRows.map((group) => (
            <div key={group.productId} className="space-y-2">
              <div className="flex items-baseline gap-2 border-b pb-1">
                <h3 className="text-sm font-semibold">{group.productName}</h3>
                <span className="text-xs text-muted-foreground">
                  {group.rowIndices.length} unit
                  {group.rowIndices.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="space-y-2">
                {group.rowIndices.map((idx) => {
                  const row = rows[idx]!;
                  const dupSerial = duplicateSerialIndices.has(idx);
                  return (
                    <div
                      key={idx}
                      className="grid items-start gap-2 md:grid-cols-12"
                    >
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-muted-foreground">
                          Unit
                        </label>
                        <div className="mt-1 rounded-md border bg-muted/40 px-2 py-1.5 text-sm">
                          {row.unitLabel}
                        </div>
                      </div>
                      <div className="md:col-span-5">
                        <label className="block text-xs font-medium text-muted-foreground">
                          Asset name <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) =>
                            updateRow(idx, { name: e.target.value })
                          }
                          className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </div>
                      <div className="md:col-span-5">
                        <label className="block text-xs font-medium text-muted-foreground">
                          Serial number
                        </label>
                        <div className="mt-1 flex gap-1">
                          <input
                            type="text"
                            value={row.serialNumber}
                            onChange={(e) =>
                              updateRow(idx, { serialNumber: e.target.value })
                            }
                            placeholder="Optional"
                            className={`flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary ${
                              dupSerial ? "border-red-500" : ""
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setScannerIdx(idx)}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted"
                            title="Scan barcode / QR"
                          >
                            <ScanLine className="h-3.5 w-3.5" /> Scan
                          </button>
                        </div>
                        {dupSerial && (
                          <p className="mt-1 text-[10px] text-red-600">
                            Duplicate serial in this form
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {submitError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/admin/purchase-orders/${poId}/batches/${batch.id}`}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Save {rows.length} asset{rows.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* Scanner modal — full-screen overlay rendered conditionally so
          the camera permission prompt only fires when invoked. */}
      {scannerIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/80">
          <BarcodeScanner
            mode="single"
            onScan={(value) => {
              updateRow(scannerIdx, { serialNumber: value });
              setScannerIdx(null);
            }}
            onClose={() => setScannerIdx(null)}
          />
        </div>
      )}
    </div>
  );
}
