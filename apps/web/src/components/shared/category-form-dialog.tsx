"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiPost, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import type {
  AssetCategoryDetail,
  DepreciationMethod,
} from "@/types/admin";

// Form schema mirrors the backend Zod (apps/api/.../asset-categories/schema.ts)
// but stays in "string-in" shape so it lines up with what HTML form inputs
// emit. We coerce numeric strings → numbers via preprocess so input and
// output types match (z.infer doesn't diverge), which keeps the RHF
// Resolver typing happy.
const numericString = z.preprocess(
  (v) => {
    if (v === null || v === undefined || v === "") return undefined;
    return typeof v === "string" ? Number(v) : v;
  },
  z.number().optional(),
);

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(32)
    .regex(
      /^[A-Z0-9_-]+$/,
      "Use uppercase letters, digits, underscores, or hyphens only (e.g. IT_EQUIP)",
    ),
  description: z.string().trim().max(2000),
  // Nullable so the dropdown's "no parent" option (value "") maps cleanly
  // to a SQL NULL on the backend.
  parentId: z.string().uuid().nullable(),
  depreciationMethod: z.enum(["STRAIGHT_LINE", "DECLINING_BALANCE", "NONE"]),
  defaultDepreciationRate: numericString.refine(
    (v) => v === undefined || (v >= 0 && v <= 100),
    { message: "Rate must be between 0 and 100" },
  ),
  defaultUsefulLifeMonths: numericString.refine(
    (v) => v === undefined || (Number.isInteger(v) && v > 0),
    { message: "Useful life must be a positive integer" },
  ),
  icon: z.string().trim().max(64),
  color: z
    .string()
    .trim()
    .refine((v) => v === "" || /^#[0-9a-fA-F]{6}$/.test(v), {
      message: "Color must be a hex code like #1F2937",
    }),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

interface CategoryFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pass an existing category to switch the dialog into edit mode. */
  editing: AssetCategoryDetail | null;
  /** All known categories — used to populate the Parent dropdown. The current
   *  record (when editing) is hidden from this list so a category can't pick
   *  itself as its own parent. */
  allCategories: AssetCategoryDetail[];
}

const DEPRECIATION_METHODS: { value: DepreciationMethod; label: string }[] = [
  { value: "NONE", label: "None — no depreciation" },
  { value: "STRAIGHT_LINE", label: "Straight line — equal annual decrease" },
  { value: "DECLINING_BALANCE", label: "Declining balance — % of remaining value" },
];

export default function CategoryFormDialog({
  open,
  onClose,
  onSuccess,
  editing,
  allCategories,
}: CategoryFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      parentId: null,
      depreciationMethod: "NONE",
      defaultDepreciationRate: undefined,
      defaultUsefulLifeMonths: undefined,
      icon: "",
      color: "",
    },
  });

  // Re-populate the form whenever the dialog opens with a different record.
  // We always reset on open so a previous edit doesn't leak into a fresh add.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      reset({
        name: editing.name,
        code: editing.code,
        description: editing.description ?? "",
        parentId: editing.parentId,
        depreciationMethod: editing.depreciationMethod,
        defaultDepreciationRate: editing.defaultDepreciationRate ?? undefined,
        defaultUsefulLifeMonths: editing.defaultUsefulLifeMonths ?? undefined,
        icon: editing.icon ?? "",
        color: editing.color ?? "",
      });
    } else {
      reset({
        name: "",
        code: "",
        description: "",
        parentId: null,
        depreciationMethod: "NONE",
        defaultDepreciationRate: undefined,
        defaultUsefulLifeMonths: undefined,
        icon: "",
        color: "",
      });
    }
    setSubmitError(null);
  }, [open, editing, reset]);

  // Selected method controls visibility of the rate/life inputs — they're
  // only meaningful when a depreciation method is set.
  const method = watch("depreciationMethod") as DepreciationMethod;
  const showDepreciationFields = method !== "NONE";

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Strip empty optional strings so the backend sees them as "unset"
      // rather than empty-string overrides.
      const payload: Record<string, unknown> = {
        name: values.name,
        code: values.code,
        depreciationMethod: values.depreciationMethod,
      };
      if (values.description) payload['description'] = values.description;
      if (values.parentId) payload['parentId'] = values.parentId;
      else if (values.parentId === null) payload['parentId'] = null;
      if (values.defaultDepreciationRate !== undefined)
        payload['defaultDepreciationRate'] = values.defaultDepreciationRate;
      if (values.defaultUsefulLifeMonths !== undefined)
        payload['defaultUsefulLifeMonths'] = values.defaultUsefulLifeMonths;
      if (values.icon) payload['icon'] = values.icon;
      if (values.color) payload['color'] = values.color;

      if (editing) {
        await apiPut(`/api/asset-categories/${editing.id}`, payload);
      } else {
        await apiPost("/api/asset-categories", payload);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "Save failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cat-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="cat-dialog-title" className="mb-4 text-lg font-semibold">
          {editing ? "Edit category" : "New category"}
        </h2>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="cat-name">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id="cat-name"
              {...register("name")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="cat-code">
              Code <span className="text-destructive">*</span>
            </label>
            <input
              id="cat-code"
              {...register("code")}
              placeholder="IT_EQUIP"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Used in asset numbers (WDS-{`{CODE}`}-2026-00001). Cannot be changed
              after assets are assigned.
            </p>
            {errors.code && (
              <p className="mt-1 text-xs text-destructive">{errors.code.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="cat-parent">
              Parent category
            </label>
            <select
              id="cat-parent"
              {...register("parentId", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">— No parent (root) —</option>
              {allCategories
                .filter((c) => !editing || c.id !== editing.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="cat-desc">
              Description
            </label>
            <textarea
              id="cat-desc"
              {...register("description")}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="cat-depr">
              Depreciation method
            </label>
            <select
              id="cat-depr"
              {...register("depreciationMethod")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {DEPRECIATION_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {showDepreciationFields && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="cat-rate">
                  Default rate (% / year)
                </label>
                <input
                  id="cat-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  {...register("defaultDepreciationRate")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.defaultDepreciationRate && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.defaultDepreciationRate.message}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="cat-life">
                  Useful life (months)
                </label>
                <input
                  id="cat-life"
                  type="number"
                  step="1"
                  min="1"
                  {...register("defaultUsefulLifeMonths")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.defaultUsefulLifeMonths && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.defaultUsefulLifeMonths.message}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="cat-icon">
                Icon (optional)
              </label>
              <input
                id="cat-icon"
                {...register("icon")}
                placeholder="laptop"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="cat-color">
                Color (optional)
              </label>
              <input
                id="cat-color"
                {...register("color")}
                placeholder="#1F2937"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
              />
              {errors.color && (
                <p className="mt-1 text-xs text-destructive">{errors.color.message}</p>
              )}
            </div>
          </div>

          {submitError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving..." : editing ? "Save changes" : "Create category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
