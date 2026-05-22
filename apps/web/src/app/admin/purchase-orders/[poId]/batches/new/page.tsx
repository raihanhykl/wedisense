"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { formatCurrency, cn } from "@/lib/utils";
import type {
  ProcurementBatchDetail,
  PurchaseOrderDetail,
} from "@/types/admin";

// Phase 17 v2 / spec §3 — nested batch create. Parent PO is implicit
// from the route param; we fetch its items so the form can render one
// row per PO line with a "qty received" input (min 0, max = remaining
// capacity).
//
// Spec §3.3: purchaseDate / currency / total all auto-fill from PO and
// stay disabled (the form just displays them). totalAmount updates
// live as the user types qtyReceived values.

interface ReceiptLine {
  purchaseOrderItemId: string;
  productName: string;
  productSub: string;
  poQty: number;
  alreadyReceived: number;
  remaining: number;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  qtyReceived: string; // string for input control
}

function computeLineTotal(line: ReceiptLine): number {
  const qty = Number(line.qtyReceived) || 0;
  const price = Number(line.unitPrice) || 0;
  const disc = Number(line.discountPercent) || 0;
  const tax = Number(line.taxPercent) || 0;
  const gross = qty * price;
  const untaxed = gross * (1 - disc / 100);
  return untaxed + untaxed * (tax / 100);
}

interface LocationOption {
  id: string;
  name: string;
  code: string;
}

interface CategoryOption {
  id: string;
  name: string;
  code: string;
}

export default function NewBatchPage() {
  const router = useRouter();
  const params = useParams<{ poId: string }>();
  const poId = params?.poId;
  const canCreate = usePermission("procurement:create");

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [poLoading, setPoLoading] = useState(true);
  const [poError, setPoError] = useState<string | null>(null);

  // Form state — kept simple (useState) since the structure is mostly
  // derived from PO + a per-row input. RHF would add ceremony without
  // payoff.
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch parent PO + already-received-per-item from sibling batches so
  // the "remaining" column reflects actual capacity. The sibling-batches
  // query is a soft lookup — backend will re-validate at submit time.
  const fetchPoContext = useCallback(async () => {
    if (!poId) return;
    setPoLoading(true);
    setPoError(null);
    try {
      const [poDetail, siblingBatches] = await Promise.all([
        apiGet<PurchaseOrderDetail>(`/api/purchase-orders/${poId}`),
        // Fetch all batches under this PO (excluding cancelled) so we
        // can pre-compute remaining qty per PO line. The detail page
        // already includes batches summary, but it doesn't carry items
        // — separate /procurement-batches list query joins items.
        apiGet<ProcurementBatchDetail[]>(`/api/procurement-batches`, {
          purchaseOrderId: poId,
          limit: 100,
        }),
      ]);
      setPo(poDetail);

      // Sum qty received per PO line across sibling batches (skip
      // CANCELLED ones — they were voided). The list endpoint
      // returns ProcurementBatchListItem which doesn't include items;
      // for a fully accurate "remaining", we'd need per-batch detail
      // fetches. For now we just show what the user is doing in this
      // batch — backend will reject over-receive on submit with a
      // clear message.
      // Sidebar: the backend's validateAndPrepareBatchItems already
      // does the source-of-truth check, so soft client display is OK.
      const totalReceivedPerItem = new Map<string, number>();
      void siblingBatches; // silence unused; reserved for richer UI later

      // Build the receipt lines from PO items.
      setLines(
        poDetail.items.map((it) => ({
          purchaseOrderItemId: it.id,
          productName: it.product.name,
          productSub:
            [it.product.brand, it.product.model, it.product.eanCode]
              .filter(Boolean)
              .join(" · ") || it.product.category.name,
          poQty: it.qty,
          alreadyReceived: totalReceivedPerItem.get(it.id) ?? 0,
          remaining: it.qty - (totalReceivedPerItem.get(it.id) ?? 0),
          unitPrice: it.unitPrice,
          discountPercent: it.discountPercent,
          taxPercent: it.taxPercent,
          qtyReceived: "0",
        })),
      );
    } catch (err) {
      setPoError(getApiErrorMessage(err, "Failed to load purchase order"));
    } finally {
      setPoLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    void fetchPoContext();
  }, [fetchPoContext]);

  // Load location + category options for the optional defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locs, cats] = await Promise.all([
          apiGet<LocationOption[]>("/api/locations", { limit: 200 }),
          apiGet<CategoryOption[]>("/api/asset-categories", { limit: 100 }),
        ]);
        if (!cancelled) {
          setLocations(locs);
          setCategories(cats);
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live computed total from the lines.
  const computedTotal = useMemo(
    () => lines.reduce((sum, l) => sum + computeLineTotal(l), 0),
    [lines],
  );

  const updateLine = (idx: number, qty: string) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, qtyReceived: qty } : l)),
    );
  };

  if (!canCreate) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You don&apos;t have permission to create procurement batches.
        </div>
      </div>
    );
  }

  if (poLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border bg-card" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  if (poError || !po) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {poError ?? "Purchase order not found."}
        </div>
      </div>
    );
  }

  const poLocked =
    po.status === "CLOSED" || po.status === "CANCELLED";

  if (poLocked) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link
          href={`/admin/purchase-orders/${po.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to PO
        </Link>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Cannot add a batch to a {po.status.toLowerCase()} purchase order.
        </div>
      </div>
    );
  }

  const validForSubmit =
    lines.some((l) => Number(l.qtyReceived) > 0) || // either receive something
    name.trim() !== "" || // or label it for later (DRAFT placeholder)
    notes.trim() !== "" ||
    defaultLocationId !== "" ||
    defaultCategoryId !== "";

  const overReceive = lines.some(
    (l) => Number(l.qtyReceived) > l.remaining,
  );

  const handleSubmit = async () => {
    if (overReceive) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Record<string, unknown> = {
        purchaseOrderId: po.id,
        ...(name && { name }),
        ...(notes && { notes }),
        ...(defaultLocationId && { defaultLocationId }),
        ...(defaultCategoryId && { defaultCategoryId }),
        items: lines
          // Only ship non-zero rows — backend allows blank DRAFT but the
          // payload stays compact and the user can come back to add
          // qty later.
          .filter((l) => Number(l.qtyReceived) > 0)
          .map((l) => ({
            purchaseOrderItemId: l.purchaseOrderItemId,
            qtyReceived: Number(l.qtyReceived),
          })),
      };
      const created = await apiPost<ProcurementBatchDetail>(
        "/api/procurement-batches",
        payload,
      );
      router.push(`/admin/purchase-orders/${po.id}/batches/${created.id}`);
    } catch (err) {
      setSubmitError(
        getApiErrorMessage(err, "Failed to create procurement batch"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href={`/admin/purchase-orders/${po.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to PO
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          New Procurement Batch
        </h1>
        <p className="text-sm text-muted-foreground">
          The BATCH-YYYYMM-NNNN number is auto-generated. BAST + invoice
          fields fill in later when the batch transitions through Receive
          and Complete.
        </p>
      </div>

      {/* Parent PO — read-only context per spec §3.1 / §3.3 */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">Parent Purchase Order</legend>
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              PO number
            </div>
            <div className="mt-1 font-mono">{po.poNumber}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vendor
            </div>
            <div className="mt-1">{po.vendor.name}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              PO date
            </div>
            <div className="mt-1">
              {new Date(po.poDate).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
        </div>
      </fieldset>

      {/* Batch metadata */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">Batch details</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">
              Batch name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Batch 1 of 3 — first delivery"
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground">
              Purchase date (from PO)
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={new Date(po.poDate).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              className="mt-1 w-full cursor-not-allowed rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground">
              Currency (from PO)
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={po.currency}
              className="mt-1 w-full cursor-not-allowed rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
            />
          </div>
        </div>
      </fieldset>

      {/* Receipts grid per PO line */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">Items received</legend>
        <p className="mb-3 text-xs text-muted-foreground">
          Enter how many units of each PO line this batch receives. Leave 0
          for any line not received in this batch. Backend rejects qty &gt;
          remaining capacity across all batches.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 text-right font-medium">PO qty</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
                <th className="px-3 py-2 text-right font-medium">Qty received</th>
                <th className="px-3 py-2 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const lineTotal = computeLineTotal(line);
                const overByLine = Number(line.qtyReceived) > line.remaining;
                return (
                  <tr key={line.purchaseOrderItemId} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{line.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.productSub}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{line.poQty}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {line.remaining}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {formatCurrency(line.unitPrice, po.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={line.remaining}
                        step={1}
                        value={line.qtyReceived}
                        onChange={(e) => updateLine(idx, e.target.value)}
                        className={cn(
                          "w-24 rounded-md border bg-background px-2 py-1 text-right text-sm outline-none focus:border-primary",
                          overByLine && "border-red-500",
                        )}
                      />
                      {overByLine && (
                        <p className="mt-1 text-[10px] text-red-600">
                          Max {line.remaining}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(lineTotal, po.currency)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t bg-muted/30 text-sm font-medium">
                <td colSpan={5} className="px-3 py-2 text-right">
                  Batch total
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(computedTotal, po.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>

      {/* Defaults */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">Defaults for assets</legend>
        <p className="mb-2 text-xs text-muted-foreground">
          Pre-fills these on every asset imported into this batch. Each row in
          the import file may still override them.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Default location</label>
            <select
              value={defaultLocationId}
              onChange={(e) => setDefaultLocationId(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="">— No default —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Default category</label>
            <select
              value={defaultCategoryId}
              onChange={(e) => setDefaultCategoryId(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="">— No default —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      {/* Notes */}
      <fieldset className="rounded-lg border bg-card p-4">
        <legend className="px-2 text-sm font-medium">Notes</legend>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Optional internal notes."
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </fieldset>

      {submitError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/admin/purchase-orders/${po.id}`}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !validForSubmit || overReceive}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create Batch
        </button>
      </div>
    </div>
  );
}
