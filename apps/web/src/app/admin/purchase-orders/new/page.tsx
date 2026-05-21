"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import type { PurchaseOrderDetail } from "@/types/admin";

// ── Schema ────────────────────────────────────────────────────────────
//
// Mirrors apps/api/src/modules/purchase-orders/schema.ts createPurchaseOrderSchema.
// Kept loose here on optional fields — backend repeats the strict validation,
// so this is the user-facing layer; we just want immediate error feedback.

const formSchema = z
  .object({
    vendor: z.string().min(1, "Vendor is required").max(255),
    vendorContact: z.string().max(255).optional().or(z.literal("")),
    name: z.string().max(255).optional().or(z.literal("")),
    description: z.string().max(2000).optional().or(z.literal("")),
    poDate: z.string().min(1, "PO date is required"),
    expectedDeliveryDate: z.string().optional().or(z.literal("")),
    poUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    currency: z.string().length(3, "Use a 3-letter ISO code").default("IDR"),
    totalAmount: z
      .string()
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || /^\d+(\.\d{1,2})?$/.test(v), {
        message: "Total amount must be a non-negative number",
      }),
    notes: z.string().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (v) => !v.expectedDeliveryDate || v.expectedDeliveryDate >= v.poDate,
    {
      message: "Expected delivery date must be on or after PO date",
      path: ["expectedDeliveryDate"],
    },
  );

type FormValues = z.infer<typeof formSchema>;

const defaultValues: FormValues = {
  vendor: "",
  vendorContact: "",
  name: "",
  description: "",
  poDate: new Date().toISOString().slice(0, 10),
  expectedDeliveryDate: "",
  poUrl: "",
  currency: "IDR",
  totalAmount: "",
  notes: "",
};

// Local helper — promote a YYYY-MM-DD picker value to a full ISO string at
// noon UTC. We use noon (not midnight) so daylight-saving shifts on the
// client can't accidentally push the date to the day before/after.
function toIsoDate(d: string): string {
  return new Date(`${d}T12:00:00.000Z`).toISOString();
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const canCreate = usePermission("purchase-orders:create");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  if (!canCreate) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You don&apos;t have permission to create purchase orders.
        </div>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const payload = {
        vendor: values.vendor,
        ...(values.vendorContact && { vendorContact: values.vendorContact }),
        ...(values.name && { name: values.name }),
        ...(values.description && { description: values.description }),
        poDate: toIsoDate(values.poDate),
        ...(values.expectedDeliveryDate && {
          expectedDeliveryDate: toIsoDate(values.expectedDeliveryDate),
        }),
        ...(values.poUrl && { poUrl: values.poUrl }),
        currency: values.currency,
        ...(values.totalAmount && { totalAmount: Number(values.totalAmount) }),
        ...(values.notes && { notes: values.notes }),
      };
      const created = await apiPost<PurchaseOrderDetail>(
        "/purchase-orders",
        payload,
      );
      router.push(`/admin/purchase-orders/${created.id}`);
    } catch (err) {
      // Funnel server-side errors back into the form so the user sees them
      // inline; vendor is the most likely culprit (uniqueness conflicts are
      // surfaced by the backend's vendor field check).
      setError("root", { message: getApiErrorMessage(err, "Failed to create purchase order") });
    }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/purchase-orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          New Purchase Order
        </h1>
        <p className="text-sm text-muted-foreground">
          The SP-YYYY-NNNN number is auto-generated when the form is saved.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Vendor card */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Vendor</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">
                Vendor name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                {...register("vendor")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                autoComplete="off"
              />
              {errors.vendor && (
                <p className="mt-1 text-xs text-red-600">{errors.vendor.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">Vendor contact</label>
              <input
                type="text"
                {...register("vendorContact")}
                placeholder="Email, phone, or PIC name"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                autoComplete="off"
              />
            </div>
          </div>
        </fieldset>

        {/* PO meta card */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Order details</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Name (optional)</label>
              <input
                type="text"
                {...register("name")}
                placeholder="Friendly label, e.g. Laptop pengadaan 2026 Q2"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Description (optional)</label>
              <textarea
                {...register("description")}
                rows={2}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                PO date <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                {...register("poDate")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              {errors.poDate && (
                <p className="mt-1 text-xs text-red-600">{errors.poDate.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">Expected delivery</label>
              <input
                type="date"
                {...register("expectedDeliveryDate")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              {errors.expectedDeliveryDate && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.expectedDeliveryDate.message}
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
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">PO document URL</label>
              <input
                type="url"
                {...register("poUrl")}
                placeholder="https://… (optional)"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              {errors.poUrl && (
                <p className="mt-1 text-xs text-red-600">{errors.poUrl.message}</p>
              )}
            </div>
          </div>
        </fieldset>

        {/* Notes */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Notes</legend>
          <textarea
            {...register("notes")}
            rows={4}
            placeholder="Internal notes — visible to anyone with purchase-orders:read."
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
            href="/admin/purchase-orders"
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
            Create Purchase Order
          </button>
        </div>
      </form>
    </div>
  );
}
