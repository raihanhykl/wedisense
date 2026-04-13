"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiPost, apiPut, apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LocationFlat } from "@/types/admin";

const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  province: z.string().optional().default(""),
  type: z.string().min(1, "Type is required"),
  parentId: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
});

type LocationFormValues = z.infer<typeof locationSchema>;

const LOCATION_TYPES = [
  "headquarters",
  "branch",
  "warehouse",
  "floor",
  "room",
  "zone",
];

interface LocationFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingLocation?: LocationFlat | null;
}

export default function LocationFormDialog({
  open,
  onClose,
  onSuccess,
  editingLocation,
}: LocationFormDialogProps) {
  const [locations, setLocations] = useState<LocationFlat[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: "",
      code: "",
      address: "",
      city: "",
      province: "",
      type: "",
      parentId: null,
      isActive: true,
    },
  });

  const isActive = watch("isActive");

  useEffect(() => {
    if (open) {
      apiGet<LocationFlat[]>("/api/locations").then(setLocations).catch(() => {});
      if (editingLocation) {
        reset({
          name: editingLocation.name,
          code: editingLocation.code,
          address: editingLocation.address ?? "",
          city: editingLocation.city ?? "",
          province: editingLocation.province ?? "",
          type: editingLocation.type,
          parentId: editingLocation.parentId,
          isActive: editingLocation.isActive,
        });
      } else {
        reset({
          name: "",
          code: "",
          address: "",
          city: "",
          province: "",
          type: "",
          parentId: null,
          isActive: true,
        });
      }
    }
  }, [open, editingLocation, reset]);

  const onSubmit = async (data: LocationFormValues) => {
    setSubmitting(true);
    try {
      if (editingLocation) {
        await apiPut(`/api/locations/${editingLocation.id}`, data);
      } else {
        await apiPost("/api/locations", data);
      }
      onSuccess();
      onClose();
    } catch {
      // Error handling can be enhanced later
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">
          {editingLocation ? "Edit Location" : "Add Location"}
        </h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              {...register("name")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.name && "border-destructive",
              )}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Code */}
          <div>
            <label className="mb-1 block text-sm font-medium">Code</label>
            <input
              {...register("code")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.code && "border-destructive",
              )}
            />
            {errors.code && (
              <p className="mt-1 text-xs text-destructive">{errors.code.message}</p>
            )}
          </div>

          {/* Address */}
          <div>
            <label className="mb-1 block text-sm font-medium">Address</label>
            <input
              {...register("address")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* City + Province */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">City</label>
              <input
                {...register("city")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Province</label>
              <input
                {...register("province")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <select
              {...register("type")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.type && "border-destructive",
              )}
            >
              <option value="">Select type</option>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            {errors.type && (
              <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>
            )}
          </div>

          {/* Parent */}
          <div>
            <label className="mb-1 block text-sm font-medium">Parent Location</label>
            <select
              value={watch("parentId") ?? ""}
              onChange={(e) =>
                setValue("parentId", e.target.value || null, { shouldValidate: true })
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">None (top-level)</option>
              {locations
                .filter((l) => l.id !== editingLocation?.id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.code})
                  </option>
                ))}
            </select>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => setValue("isActive", !isActive)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                isActive ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
                  isActive ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
            <label className="text-sm font-medium">Active</label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
