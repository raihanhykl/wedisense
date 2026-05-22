"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, useFieldArray, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { formatCurrency } from "@/lib/utils";
import VendorPicker from "@/components/shared/vendor-picker";
import ProductPicker from "@/components/shared/product-picker";
import CurrencySelect from "@/components/shared/currency-select";
import MoneyInput from "@/components/shared/money-input";
import { DEFAULT_CURRENCY } from "@/lib/currencies";
import type { PurchaseOrderDetail } from "@/types/admin";

// ── Form schema ───────────────────────────────────────────────────────
//
// Mirrors backend createPurchaseOrderSchema (Tier 7.3) but keeps numeric
// fields as STRINGS for RHF storage. We coerce to number at submit time.

const itemSchema = z.object({
  productId: z.string().uuid({ message: "Pick or create a product" }),
  productLabel: z.string(), // local-only, helps render the picker chip
  qty: z.string().refine((v) => /^\d+$/.test(v) && Number(v) >= 1, {
    message: "Qty must be a positive integer",
  }),
  unitPrice: z.string().refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
    message: "Unit price must be ≥ 0",
  }),
  discountPercent: z.string().refine(
    (v) => {
      if (v === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    { message: "Discount must be 0-100%" },
  ),
  taxPercent: z.string().refine(
    (v) => {
      if (v === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    { message: "Tax must be 0-100%" },
  ),
});

const formSchema = z
  .object({
    vendorId: z.string().uuid({ message: "Pick or create a vendor" }),
    vendorLabel: z.string(),
    name: z.string().max(255).optional().or(z.literal("")),
    description: z.string().max(2000).optional().or(z.literal("")),
    poDate: z.string().min(1, "PO date is required"),
    expectedDeliveryDate: z.string().optional().or(z.literal("")),
    poUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    currency: z.string().length(3),
    notes: z.string().max(2000).optional().or(z.literal("")),
    items: z.array(itemSchema).min(1, "At least one line item is required"),
  })
  .refine(
    (v) => !v.expectedDeliveryDate || v.expectedDeliveryDate >= v.poDate,
    {
      message: "Expected delivery must be on or after PO date",
      path: ["expectedDeliveryDate"],
    },
  );

type FormValues = z.infer<typeof formSchema>;

function blankItem(): FormValues["items"][number] {
  return {
    productId: "",
    productLabel: "",
    qty: "1",
    unitPrice: "0",
    discountPercent: "0",
    taxPercent: "0",
  };
}

function toIsoDate(d: string): string {
  return new Date(`${d}T12:00:00.000Z`).toISOString();
}

// ── Per-row amount + summary computation ──────────────────────────────
//
// Mirrors backend purchase-orders/totals.ts. We replicate here so the
// form shows live totals as the user types — the backend recomputes on
// submit so any UI rounding drift is irrelevant at storage time.

function computeItemAmounts(item: FormValues["items"][number]): {
  untaxed: number;
  tax: number;
  total: number;
} {
  const qty = Number(item.qty) || 0;
  const price = Number(item.unitPrice) || 0;
  const disc = Number(item.discountPercent) || 0;
  const tax = Number(item.taxPercent) || 0;
  const gross = qty * price;
  const untaxed = gross * (1 - disc / 100);
  const taxAmt = untaxed * (tax / 100);
  return { untaxed, tax: taxAmt, total: untaxed + taxAmt };
}

// ── Page ──────────────────────────────────────────────────────────────

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const canCreate = usePermission("purchase-orders:create");

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      vendorId: "",
      vendorLabel: "",
      name: "",
      description: "",
      poDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: "",
      poUrl: "",
      currency: DEFAULT_CURRENCY.code,
      notes: "",
      items: [blankItem()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  // Watch items + currency for live totals. useWatch lets us subscribe
  // surgically — re-rendering the summary only when these slices change.
  const items = useWatch({ control, name: "items" });
  const currency = useWatch({ control, name: "currency" });

  const totals = useMemo(() => {
    let untaxed = 0;
    let tax = 0;
    let total = 0;
    for (const it of items ?? []) {
      const a = computeItemAmounts(it);
      untaxed += a.untaxed;
      tax += a.tax;
      total += a.total;
    }
    return { untaxed, tax, total };
  }, [items]);

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
        vendorId: values.vendorId,
        ...(values.name && { name: values.name }),
        ...(values.description && { description: values.description }),
        poDate: toIsoDate(values.poDate),
        ...(values.expectedDeliveryDate && {
          expectedDeliveryDate: toIsoDate(values.expectedDeliveryDate),
        }),
        ...(values.poUrl && { poUrl: values.poUrl }),
        currency: values.currency,
        ...(values.notes && { notes: values.notes }),
        items: values.items.map((it, idx) => ({
          productId: it.productId,
          qty: Number(it.qty),
          unitPrice: Number(it.unitPrice),
          discountPercent: Number(it.discountPercent || 0),
          taxPercent: Number(it.taxPercent || 0),
          sortOrder: idx * 10,
        })),
      };
      const created = await apiPost<PurchaseOrderDetail>(
        "/api/purchase-orders",
        payload,
      );
      router.push(`/admin/purchase-orders/${created.id}`);
    } catch (err) {
      setError("root", {
        message: getApiErrorMessage(err, "Failed to create purchase order"),
      });
    }
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link
          href="/admin/purchase-orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Purchase Order</h1>
        <p className="text-sm text-muted-foreground">
          The SP-YYYY-NNNN number is auto-generated on save. Totals are
          computed from the line items below.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Vendor */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Vendor</legend>
          <p className="mb-2 text-xs text-muted-foreground">
            Pick from the registry — or type a new name and click + to save it.
          </p>
          <Controller
            name="vendorId"
            control={control}
            render={({ field }) => (
              <Controller
                name="vendorLabel"
                control={control}
                render={({ field: labelField }) => (
                  <VendorPicker
                    value={
                      field.value
                        ? { id: field.value, label: labelField.value }
                        : null
                    }
                    onChange={(next) => {
                      field.onChange(next?.id ?? "");
                      labelField.onChange(next?.label ?? "");
                    }}
                    invalid={!!errors.vendorId}
                  />
                )}
              />
            )}
          />
          {errors.vendorId && (
            <p className="mt-1 text-xs text-red-600">{errors.vendorId.message}</p>
          )}
        </fieldset>

        {/* PO meta */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Order details</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Name</label>
              <input
                type="text"
                {...register("name")}
                placeholder="Friendly label, e.g. Laptop pengadaan 2026 Q2"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Description</label>
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
              <Controller
                name="currency"
                control={control}
                render={({ field }) => (
                  <CurrencySelect
                    value={field.value}
                    onChange={field.onChange}
                    className="mt-1"
                  />
                )}
              />
            </div>
            <div>
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

        {/* Line items */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Line items</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            Amount = qty × unit price × (1 − discount%) × (1 + tax%). All
            amounts compute live.
          </p>

          <div className="space-y-3">
            {fields.map((field, idx) => (
              <ItemRow
                key={field.id}
                idx={idx}
                control={control}
                register={register}
                errors={errors}
                currency={currency}
                onRemove={() => remove(idx)}
                canRemove={fields.length > 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => append(blankItem())}
            className="mt-3 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Add Product
          </button>

          {typeof errors.items?.message === "string" && (
            <p className="mt-2 text-xs text-red-600">{errors.items.message}</p>
          )}
        </fieldset>

        {/* Summary */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Summary</legend>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Untaxed Amount</dt>
              <dd>{formatCurrency(totals.untaxed, currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Total Taxes</dt>
              <dd>{formatCurrency(totals.tax, currency)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total Amount</dt>
              <dd>{formatCurrency(totals.total, currency)}</dd>
            </div>
          </dl>
        </fieldset>

        {/* Notes */}
        <fieldset className="rounded-lg border bg-card p-4">
          <legend className="px-2 text-sm font-medium">Notes</legend>
          <textarea
            {...register("notes")}
            rows={3}
            placeholder="Optional internal notes."
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

// ── Line item row ─────────────────────────────────────────────────────
//
// Split out so re-renders triggered by typing in one row don't re-mount
// the others. Watches its own slice of the form for live total
// computation.

interface ItemRowProps {
  idx: number;
  // RHF generics get heavy here; we accept the broad types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors: any;
  currency: string;
  onRemove: () => void;
  canRemove: boolean;
}

function ItemRow({
  idx,
  control,
  register,
  errors,
  currency,
  onRemove,
  canRemove,
}: ItemRowProps) {
  const row = useWatch({ control, name: `items.${idx}` }) as
    | FormValues["items"][number]
    | undefined;
  const amounts = row
    ? computeItemAmounts(row)
    : { untaxed: 0, tax: 0, total: 0 };

  const rowErrors = errors.items?.[idx];

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="grid gap-3 md:grid-cols-12">
        {/* Product picker */}
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-muted-foreground">
            Product <span className="text-red-600">*</span>
          </label>
          <Controller
            name={`items.${idx}.productId`}
            control={control}
            render={({ field }) => (
              <Controller
                name={`items.${idx}.productLabel`}
                control={control}
                render={({ field: labelField }) => (
                  <div className="mt-1">
                    <ProductPicker
                      value={
                        field.value
                          ? { id: field.value, label: labelField.value }
                          : null
                      }
                      onChange={(next) => {
                        field.onChange(next?.id ?? "");
                        labelField.onChange(next?.label ?? "");
                      }}
                      invalid={!!rowErrors?.productId}
                    />
                  </div>
                )}
              />
            )}
          />
          {rowErrors?.productId && (
            <p className="mt-1 text-xs text-red-600">{rowErrors.productId.message}</p>
          )}
        </div>

        {/* Qty */}
        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-muted-foreground">Qty</label>
          <input
            type="number"
            min={1}
            step={1}
            {...register(`items.${idx}.qty`)}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
          {rowErrors?.qty && (
            <p className="mt-1 text-[10px] text-red-600">{rowErrors.qty.message}</p>
          )}
        </div>

        {/* Unit price */}
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Unit price
          </label>
          <Controller
            name={`items.${idx}.unitPrice`}
            control={control}
            render={({ field }) => (
              <MoneyInput
                value={field.value}
                onChange={field.onChange}
                currency={currency}
                showSymbol
                invalid={!!rowErrors?.unitPrice}
                className="mt-1"
              />
            )}
          />
          {rowErrors?.unitPrice && (
            <p className="mt-1 text-[10px] text-red-600">{rowErrors.unitPrice.message}</p>
          )}
        </div>

        {/* Discount % */}
        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-muted-foreground">Disc %</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            {...register(`items.${idx}.discountPercent`)}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* Tax % */}
        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-muted-foreground">Tax %</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            {...register(`items.${idx}.taxPercent`)}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* Amount (computed) */}
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-muted-foreground">Amount</label>
          <div className="mt-1 rounded-md border bg-muted/40 px-3 py-1.5 text-right text-sm font-medium">
            {formatCurrency(amounts.total, currency)}
          </div>
        </div>

        {/* Remove */}
        <div className="flex items-end justify-end md:col-span-1">
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="rounded-md border p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-700 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Remove item"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
