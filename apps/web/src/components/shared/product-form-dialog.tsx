"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { useAssetCategories } from "@/hooks/use-reference-data";
import CategoryTreePicker from "@/components/shared/category-tree-picker";
import type { ProductListItem } from "@/types/admin";

// Product create / edit dialog — used by the /admin/products management page.
// Field shape mirrors the backend Zod schema for POST /api/products and
// PUT /api/products/:id. Does NOT touch new-product-dialog.tsx, which serves
// the inline catalog-search flow (EAN scan / ProductPicker) and has a
// different API surface (callback-based onSubmit returning boolean).

const productFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  brand: z.string().trim().max(255).optional().default(""),
  model: z.string().trim().max(255).optional().default(""),
  eanCode: z
    .string()
    .trim()
    .max(32)
    .optional()
    .default("")
    .refine((v) => v === "" || /^\d{8,14}$/.test(v), {
      message: "EAN code must be 8–14 digits",
    }),
  categoryId: z.string().uuid("Category is required"),
  description: z.string().trim().max(2000).optional().default(""),
  imageUrl: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .default("")
    .refine((v) => v === "" || /^https?:\/\/.+/.test(v), {
      message: "Image URL must start with http:// or https://",
    }),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

export interface ProductFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pass an existing product to switch the dialog into edit mode. */
  editingProduct?: ProductListItem | null;
}

export default function ProductFormDialog({
  open,
  onClose,
  onSuccess,
  editingProduct,
}: ProductFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: categories = [] } = useAssetCategories();

  const isEditing = !!editingProduct;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "",
      brand: "",
      model: "",
      eanCode: "",
      categoryId: "",
      description: "",
      imageUrl: "",
    },
  });

  // Re-populate the form whenever the dialog opens with a different record.
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    if (editingProduct) {
      reset({
        name: editingProduct.name,
        brand: editingProduct.brand ?? "",
        model: editingProduct.model ?? "",
        eanCode: editingProduct.eanCode ?? "",
        categoryId: editingProduct.categoryId,
        description: editingProduct.description ?? "",
        imageUrl: editingProduct.imageUrl ?? "",
      });
    } else {
      reset({
        name: "",
        brand: "",
        model: "",
        eanCode: "",
        categoryId: "",
        description: "",
        imageUrl: "",
      });
    }
  }, [open, editingProduct, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const nullify = (s: string) => (s.trim() === "" ? null : s.trim());
      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        categoryId: values.categoryId,
        brand: nullify(values.brand ?? ""),
        model: nullify(values.model ?? ""),
        eanCode: nullify(values.eanCode ?? ""),
        description: nullify(values.description ?? ""),
        imageUrl: nullify(values.imageUrl ?? ""),
      };

      if (isEditing) {
        await apiPut(`/api/products/${editingProduct.id}`, payload);
      } else {
        await apiPost("/api/products", payload);
      }

      toast.success(
        isEditing
          ? `Product updated: ${values.name}`
          : `Product created: ${values.name}`,
      );
      onSuccess();
      onClose();
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "Failed to save product. Please try again."));
    } finally {
      setSubmitting(false);
    }
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden />

      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">
          {isEditing ? "Edit product" : "New product"}
        </h2>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="pf-name">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id="pf-name"
              {...register("name")}
              autoFocus
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50",
                errors.name && "border-destructive",
              )}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="pf-cat">
              Category <span className="text-destructive">*</span>
            </label>
            <CategoryTreePicker
              id="pf-cat"
              data-tour="product-form-category-picker"
              value={watch("categoryId") || null}
              onChange={(id) =>
                setValue("categoryId", id ?? "", {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              categories={categories}
              placeholder="-- Select category --"
              clearLabel="-- Select category --"
            />
            {errors.categoryId && (
              <p className="mt-1 text-xs text-destructive">{errors.categoryId.message}</p>
            )}
          </div>

          {/* Brand + Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="pf-brand">
                Brand
              </label>
              <input
                id="pf-brand"
                {...register("brand")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="pf-model">
                Model
              </label>
              <input
                id="pf-model"
                {...register("model")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* EAN code */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="pf-ean">
              EAN code
            </label>
            <input
              id="pf-ean"
              {...register("eanCode")}
              placeholder="8–14 digit barcode"
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50",
                errors.eanCode && "border-destructive",
              )}
            />
            {errors.eanCode && (
              <p className="mt-1 text-xs text-destructive">{errors.eanCode.message}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="pf-desc">
              Description
            </label>
            <textarea
              id="pf-desc"
              {...register("description")}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Image URL */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="pf-img">
              Image URL
            </label>
            <input
              id="pf-img"
              {...register("imageUrl")}
              type="url"
              placeholder="https://…"
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50",
                errors.imageUrl && "border-destructive",
              )}
            />
            {errors.imageUrl && (
              <p className="mt-1 text-xs text-destructive">{errors.imageUrl.message}</p>
            )}
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
              {submitError}
            </div>
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
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Saving..." : isEditing ? "Save changes" : "Create product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
