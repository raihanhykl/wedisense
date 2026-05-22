"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getApiErrorMessage } from "@/lib/error";
import { useLocations, useUsers } from "@/hooks/use-reference-data";
import ProductPicker from "@/components/shared/product-picker";
import type { AssetFormData } from "@/types/admin";

// ── Zod schema ──────────────────────────────────────────────────────
const assetSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  name: z.string().min(1, "Name is required"),
  serialNumber: z.string().optional().default(""),
  locationId: z.string().min(1, "Location is required"),
  assignedToUserId: z.string().optional().default(""),
  status: z.string().min(1, "Status is required"),
  condition: z.string().min(1, "Condition is required"),
  purchaseDate: z.string().optional().default(""),
  purchasePrice: z.string().optional().default(""),
  vendor: z.string().optional().default(""),
  invoiceNumber: z.string().optional().default(""),
  warrantyStartDate: z.string().optional().default(""),
  warrantyEndDate: z.string().optional().default(""),
  usefulLifeMonths: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

type AssetSchemaValues = z.infer<typeof assetSchema>;

// ── Status & condition options ──────────────────────────────────────
const STATUS_OPTIONS = [
  "ACTIVE",
  "IDLE",
  "IN_MAINTENANCE",
  "DISPOSED",
  "LOST",
  "BORROWED",
];

const CONDITION_OPTIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];

// ── Props ───────────────────────────────────────────────────────────
interface AssetFormProps {
  defaultValues?: AssetFormData;
  /** Phase 17 v2: pre-fills the ProductPicker chip when editing an
   *  existing asset. The form data only carries productId — the label
   *  comes through this side-channel so we don't need an extra fetch
   *  on mount just to render the selected product name. */
  defaultProductLabel?: string | null;
  onSubmit: (data: AssetFormData) => Promise<void>;
  submitLabel: string;
}

// ── Component ───────────────────────────────────────────────────────
export default function AssetForm({
  defaultValues,
  defaultProductLabel,
  onSubmit,
  submitLabel,
}: AssetFormProps) {
  const [submitting, setSubmitting] = useState(false);
  // Holds the human-readable backend rejection (e.g. INVALID_STATUS_TRANSITION).
  // Without this the rejected promise bubbles up to Next.js's dev overlay and
  // the user sees a useless stack trace instead of the actual reason.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Phase 17 v2 — track the picker's selected product label locally so
  // the chip shows the name. Initialised from prop on mount.
  const [productLabel, setProductLabel] = useState(defaultProductLabel ?? "");

  // Reference data via TanStack Query — cached across page mounts.
  const { data: locations = [] } = useLocations();
  const { data: users = [] } = useUsers();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<AssetSchemaValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: defaultValues ?? {
      productId: "",
      name: "",
      serialNumber: "",
      locationId: "",
      assignedToUserId: "",
      status: "ACTIVE",
      condition: "NEW",
      purchaseDate: "",
      purchasePrice: "",
      vendor: "",
      invoiceNumber: "",
      warrantyStartDate: "",
      warrantyEndDate: "",
      usefulLifeMonths: "",
      notes: "",
    },
  });

  // Phase 17 v2: name auto-fill is now driven by the ProductPicker's
  // onChange callback (see the field render below) — the picker hands
  // us the chosen item with its label, so we don't need a follow-up
  // products query to map id→name.
  void watch;

  const onFormSubmit = async (data: AssetSchemaValues) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(data as AssetFormData);
      // After a successful save reset the form to the saved values so
      // `isDirty` flips back to false. Otherwise the unsaved-changes guard
      // would still fire when the user navigates away post-save.
      reset(data);
    } catch (err: unknown) {
      // Surface the backend's message (e.g. the
      // INVALID_STATUS_TRANSITION explanation when changing status to
      // BORROWED) instead of letting the rejection escape to the global
      // overlay.
      setSubmitError(getApiErrorMessage(err, "Failed to save asset. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Unsaved-changes guard ──────────────────────────────────────────
  // Two layers:
  //  1. Browser-level: `beforeunload` triggers the native "Leave site?"
  //     prompt on hard navigation/reload/close. Standards mandate ignoring
  //     custom messages — the browser shows its own.
  //  2. In-app navigation (Cancel button, breadcrumb clicks): we own those
  //     handlers, so a custom confirm() with a clear question is shown.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required by Chrome. Modern browsers ignore the actual message.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleCancel = () => {
    if (isDirty) {
      const ok = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them?",
      );
      if (!ok) return;
    }
    window.history.back();
  };

  const fieldClass =
    "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelClass = "mb-1 block text-sm font-medium";
  const errorClass = "mt-1 text-xs text-destructive";

  return (
    <form
      onSubmit={(e) => void handleSubmit(onFormSubmit)(e)}
      className="space-y-8"
    >
      {/* Product & Basic */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Basic Info</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Product picker (Phase 17 v2 — autocomplete + quick-save).
              Auto-fills the asset `name` field with the chosen
              product's name on first pick (only when the form is in
              create mode, so editing doesn't clobber a custom asset
              name). */}
          <div>
            <label className={labelClass}>Product</label>
            <Controller
              name="productId"
              control={control}
              render={({ field }) => (
                <ProductPicker
                  value={
                    field.value
                      ? { id: field.value, label: productLabel }
                      : null
                  }
                  onChange={(next) => {
                    field.onChange(next?.id ?? "");
                    setProductLabel(next?.label ?? "");
                    // Auto-seed asset name from product name on
                    // create. Skip when editing (defaultValues present)
                    // so we don't overwrite a customised label.
                    if (next && !defaultValues) {
                      setValue("name", next.label);
                    }
                  }}
                  invalid={!!errors.productId}
                />
              )}
            />
            {errors.productId && (
              <p className={errorClass}>{errors.productId.message}</p>
            )}
          </div>

          {/* Name */}
          <div>
            <label htmlFor="name" className={labelClass}>
              Name
            </label>
            <input id="name" {...register("name")} className={fieldClass} />
            {errors.name && (
              <p className={errorClass}>{errors.name.message}</p>
            )}
          </div>

          {/* Serial Number */}
          <div>
            <label htmlFor="serialNumber" className={labelClass}>
              Serial Number
            </label>
            <input
              id="serialNumber"
              {...register("serialNumber")}
              className={fieldClass}
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="locationId" className={labelClass}>
              Location
            </label>
            <select
              id="locationId"
              {...register("locationId")}
              className={fieldClass}
            >
              <option value="">-- Select location --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            {errors.locationId && (
              <p className={errorClass}>{errors.locationId.message}</p>
            )}
          </div>

          {/* Assigned To */}
          <div>
            <label htmlFor="assignedToUserId" className={labelClass}>
              Assigned To
            </label>
            <select
              id="assignedToUserId"
              {...register("assignedToUserId")}
              className={fieldClass}
            >
              <option value="">-- Unassigned --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select
              id="status"
              {...register("status")}
              className={fieldClass}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {errors.status && (
              <p className={errorClass}>{errors.status.message}</p>
            )}
          </div>

          {/* Condition */}
          <div>
            <label htmlFor="condition" className={labelClass}>
              Condition
            </label>
            <select
              id="condition"
              {...register("condition")}
              className={fieldClass}
            >
              {CONDITION_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {errors.condition && (
              <p className={errorClass}>{errors.condition.message}</p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Financial */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Financial</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="purchaseDate" className={labelClass}>
              Purchase Date
            </label>
            <input
              id="purchaseDate"
              type="date"
              {...register("purchaseDate")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="purchasePrice" className={labelClass}>
              Purchase Price (IDR)
            </label>
            <input
              id="purchasePrice"
              type="number"
              step="1"
              {...register("purchasePrice")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="vendor" className={labelClass}>
              Vendor
            </label>
            <input
              id="vendor"
              {...register("vendor")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="invoiceNumber" className={labelClass}>
              Invoice Number
            </label>
            <input
              id="invoiceNumber"
              {...register("invoiceNumber")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="usefulLifeMonths" className={labelClass}>
              Useful Life (months)
            </label>
            <input
              id="usefulLifeMonths"
              type="number"
              {...register("usefulLifeMonths")}
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* Warranty */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Warranty</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="warrantyStartDate" className={labelClass}>
              Warranty Start Date
            </label>
            <input
              id="warrantyStartDate"
              type="date"
              {...register("warrantyStartDate")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="warrantyEndDate" className={labelClass}>
              Warranty End Date
            </label>
            <input
              id="warrantyEndDate"
              type="date"
              {...register("warrantyEndDate")}
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* Notes */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Notes</legend>
        <div className="mt-4">
          <textarea
            id="notes"
            rows={4}
            {...register("notes")}
            className={fieldClass}
            placeholder="Additional notes..."
          />
        </div>
      </fieldset>

      {/* Submission error banner — backend rejections (validation, status
          transition guards, etc.) show here instead of bubbling to the
          Next.js error overlay. */}
      {submitError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {submitError}
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
