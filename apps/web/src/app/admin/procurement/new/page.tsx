"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import type {
  ProcurementBatchDetail,
  PurchaseOrderListItem,
} from "@/types/admin";

// ── Schema ────────────────────────────────────────────────────────────
//
// Matches backend createProcurementBatchSchema in
// apps/api/src/modules/procurement-batches/schema.ts. PO link is optional —
// when set, vendor/currency/dates are usually inherited from the parent.

const formSchema = z.object({
  purchaseOrderId: z.string().uuid().nullable().optional(),
  name: z.string().max(255).optional().or(z.literal("")),
  purchaseDate: z.string().min(1, "Purchase date is required"),
  currency: z.string().length(3, "Use a 3-letter ISO code").default("IDR"),
  totalAmount: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^\d+(\.\d{1,2})?$/.test(v), {
      message: "Total amount must be a non-negative number",
    }),
  defaultLocationId: z.string().uuid().optional().or(z.literal("")),
  defaultCategoryId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

function toIsoDate(d: string): string {
  return new Date(`${d}T12:00:00.000Z`).toISOString();
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

export default function NewProcurementBatchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetPoId = searchParams?.get("poId") ?? undefined;
  const canCreate = usePermission("procurement:create");

  const [pos, setPos] = useState<PurchaseOrderListItem[]>([]);
  const [posLoading, setPosLoading] = useState(true);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      purchaseOrderId: presetPoId ?? "",
      name: "",
      purchaseDate: new Date().toISOString().slice(0, 10),
      currency: "IDR",
      totalAmount: "",
      defaultLocationId: "",
      defaultCategoryId: "",
      notes: "",
    },
  });

  // Load active POs (OPEN / PARTIALLY_RECEIVED) for the picker. Closed
  // and cancelled POs reject batch attachment server-side, so we don't
  // surface them here. Limit 100 is plenty for the dropdown UX; if a
  // company ever exceeds it we'll switch to async search-as-you-type.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Two parallel queries — Prisma server-side filtering doesn't
        // accept multi-value status on this endpoint yet, so we fetch
        // both buckets and concatenate.
        const [open, partial] = await Promise.all([
          apiGet<PurchaseOrderListItem[]>("/purchase-orders", {
            status: "OPEN",
            limit: 100,
          }),
          apiGet<PurchaseOrderListItem[]>("/purchase-orders", {
            status: "PARTIALLY_RECEIVED",
            limit: 100,
          }),
        ]);
        if (!cancelled) {
          setPos([...open, ...partial]);
        }
      } catch {
        // Picker is optional — failure here doesn't block the flow.
      } finally {
        if (!cancelled) setPosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load location + category options for the optional defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locs, cats] = await Promise.all([
          apiGet<LocationOption[]>("/locations", { limit: 200 }),
          apiGet<CategoryOption[]>("/asset-categories", { limit: 100 }),
        ]);
        if (!cancelled) {
          setLocations(locs);
          setCategories(cats);
        }
      } catch {
        // Optional inputs; ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When the user picks a PO, inherit its currency unless they've already
  // overridden it. This avoids the "I picked IDR PO but my batch defaulted
  // to USD" footgun.
  const selectedPoId = watch("purchaseOrderId");
  useEffect(() => {
    if (!selectedPoId) return;
    const po = pos.find((p) => p.id === selectedPoId);
    if (po) {
      setValue("currency", po.currency, { shouldDirty: false });
    }
  }, [selectedPoId, pos, setValue]);

  if (!canCreate) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You don&apos;t have permission to create procurement batches.
        </div>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const payload: Record<string, unknown> = {
        ...(values.purchaseOrderId && { purchaseOrderId: values.purchaseOrderId }),
        ...(values.name && { name: values.name }),
        purchaseDate: toIsoDate(values.purchaseDate),
        currency: values.currency,
        ...(values.totalAmount && { totalAmount: Number(values.totalAmount) }),
        ...(values.defaultLocationId && {
          defaultLocationId: values.defaultLocationId,
        }),
        ...(values.defaultCategoryId && {
          defaultCategoryId: values.defaultCategoryId,
        }),
        ...(values.notes && { notes: values.notes }),
      };
      const created = await apiPost<ProcurementBatchDetail>(
        "/procurement-batches",
        payload,
      );
      router.push(`/admin/procurement/${created.id}`);
    } catch (err) {
      setError("root", {
        message: getApiErrorMessage(err, "Failed to create procurement batch"),
      });
    }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href={
            presetPoId
              ? `/admin/purchase-orders/${presetPoId}`
              : "/admin/procurement"
          }
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          New Procurement Batch
        </h1>
        <p className="text-sm text-muted-foreground">
          The BATCH-YYYYMM-NNNN number is auto-generated. BAST + invoice fields
          are filled later when the batch transitions through Receive and
          Complete.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Parent PO */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Parent Purchase Order</legend>
          <p className="text-xs text-muted-foreground">
            Optional. Leave blank for a direct-purchase batch (no formal PO).
          </p>
          <div className="mt-3">
            <select
              {...register("purchaseOrderId")}
              disabled={posLoading}
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">— Direct purchase —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.poNumber} · {p.vendor}
                  {p.name ? ` · ${p.name}` : ""}
                </option>
              ))}
            </select>
            {posLoading && (
              <p className="mt-1 text-xs text-muted-foreground">Loading POs…</p>
            )}
          </div>
        </fieldset>

        {/* Batch details */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Batch details</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Name (optional)</label>
              <input
                type="text"
                {...register("name")}
                placeholder="Friendly label, e.g. Batch 1 of 3 — Lantai 2 laptops"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Purchase date <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                {...register("purchaseDate")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              {errors.purchaseDate && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.purchaseDate.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">Currency</label>
              <input
                type="text"
                {...register("currency")}
                maxLength={3}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm uppercase outline-none focus:border-primary"
              />
              {errors.currency && (
                <p className="mt-1 text-xs text-red-600">{errors.currency.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">Total amount</label>
              <input
                type="text"
                inputMode="decimal"
                {...register("totalAmount")}
                placeholder="0.00"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              {errors.totalAmount && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.totalAmount.message}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        {/* Defaults for assets */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Defaults for assets</legend>
          <p className="text-xs text-muted-foreground">
            Pre-fills these on every asset imported into this batch. Each row in
            the import file may still override them.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Default location</label>
              <select
                {...register("defaultLocationId")}
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
                {...register("defaultCategoryId")}
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
            {...register("notes")}
            rows={3}
            placeholder="Optional. Internal notes visible to anyone with procurement:read."
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </fieldset>

        {errors.root && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errors.root.message}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link
            href={
              presetPoId
                ? `/admin/purchase-orders/${presetPoId}`
                : "/admin/procurement"
            }
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Batch
          </button>
        </div>
      </form>
    </div>
  );
}
