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
import type { VendorListItem } from "@/types/admin";

// Vendor create / edit dialog — full-field form (unlike the inline
// quick-save in VendorPicker which only captures `name`). Reachable
// from /admin/vendors. Field shape mirrors the backend Zod schema
// (apps/api/src/modules/vendors/schema.ts).

const vendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required").max(255),
  taxId: z.string().max(50).optional().default(""),
  email: z
    .string()
    .optional()
    .default("")
    .refine(
      (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Invalid email",
    ),
  phone: z.string().max(50).optional().default(""),
  address: z.string().max(500).optional().default(""),
  contactPerson: z.string().max(255).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
  isActive: z.boolean(),
});

type VendorFormValues = z.infer<typeof vendorSchema>;

interface VendorFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Editing target; null = create mode. */
  editingVendor?: VendorListItem | null;
}

export default function VendorFormDialog({
  open,
  onClose,
  onSuccess,
  editingVendor,
}: VendorFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEditing = !!editingVendor;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: "",
      taxId: "",
      email: "",
      phone: "",
      address: "",
      contactPerson: "",
      notes: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    if (editingVendor) {
      reset({
        name: editingVendor.name,
        taxId: editingVendor.taxId ?? "",
        email: editingVendor.email ?? "",
        phone: editingVendor.phone ?? "",
        address: "",
        contactPerson: editingVendor.contactPerson ?? "",
        notes: "",
        isActive: editingVendor.isActive,
      });
    } else {
      reset({
        name: "",
        taxId: "",
        email: "",
        phone: "",
        address: "",
        contactPerson: "",
        notes: "",
        isActive: true,
      });
    }
  }, [open, editingVendor, reset]);

  const onSubmit = async (data: VendorFormValues) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Coerce empty strings to null to match the backend Zod schema
      // (every optional field is `.nullable().optional()`). Without
      // this, "" would slip through as a literal empty string in the
      // DB column instead of true absence.
      const nullify = (s: string) => (s.trim() === "" ? null : s.trim());
      const payload = {
        name: data.name.trim(),
        taxId: nullify(data.taxId),
        email: nullify(data.email),
        phone: nullify(data.phone),
        address: nullify(data.address),
        contactPerson: nullify(data.contactPerson),
        notes: nullify(data.notes),
        isActive: data.isActive,
      };

      if (editingVendor) {
        await apiPut(`/api/vendors/${editingVendor.id}`, payload);
      } else {
        await apiPost("/api/vendors", payload);
      }

      toast.success(
        editingVendor
          ? `Vendor updated: ${data.name}`
          : `Vendor created: ${data.name}`,
      );
      onSuccess();
      onClose();
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "Failed to save vendor"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">
          {isEditing ? "Edit Vendor" : "Add Vendor"}
        </h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Vendor name <span className="text-destructive">*</span>
            </label>
            <input
              {...register("name")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.name && "border-destructive",
              )}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Tax ID (NPWP)
              </label>
              <input
                {...register("taxId")}
                placeholder="00.000.000.0-000.000"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {errors.taxId && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.taxId.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Contact person
              </label>
              <input
                {...register("contactPerson")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                {...register("email")}
                className={cn(
                  "w-full rounded-md border bg-background px-3 py-2 text-sm",
                  errors.email && "border-destructive",
                )}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Phone</label>
              <input
                {...register("phone")}
                placeholder="+62 21 ..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Address</label>
            <textarea
              {...register("address")}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Notes</label>
            <textarea
              {...register("notes")}
              rows={2}
              placeholder="Optional internal notes about this vendor."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...register("isActive")}
              className="h-4 w-4 rounded border"
            />
            <span>Active</span>
            <span className="text-xs text-muted-foreground">
              (inactive vendors are hidden from the picker in PO + asset forms)
            </span>
          </label>

          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
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
              {isEditing ? "Save changes" : "Create vendor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
