"use client";

/**
 * TourStepFormDialog — modal form to create or edit a single tour step.
 * Uses React Hook Form + Zod for validation. Closes on ESC or backdrop click.
 */

import { useEffect, useId } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { TourStepDto, TourStepPosition } from "@/types/admin";
import TourTargetPicker from "./tour-target-picker";

// ── Zod schema (mirrors backend tourStepSchema minus stepIndex — auto-assigned) ──
const stepFormSchema = z.object({
  title: z.string().min(1, "Title key is required"),
  description: z.string().min(1, "Description key is required"),
  targetElement: z.string().min(1, "Target element is required"),
  route: z.string().min(1, "Route is required").startsWith("/", "Route must start with /"),
  position: z.enum(["top", "bottom", "left", "right", "auto"]),
  requiredPermissionResource: z.string(),
  requiredPermissionAction: z.string(),
  isActive: z.boolean(),
});

type StepFormValues = z.infer<typeof stepFormSchema>;

const POSITIONS: { value: TourStepPosition; label: string }[] = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "auto", label: "Auto" },
];

interface TourStepFormDialogProps {
  open: boolean;
  /** Existing step to edit, or null/undefined for a new step. */
  step?: TourStepDto | null;
  onSave: (step: Omit<TourStepDto, "stepIndex">) => void;
  onClose: () => void;
}

export default function TourStepFormDialog({
  open,
  step,
  onSave,
  onClose,
}: TourStepFormDialogProps) {
  const titleId = useId();

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<StepFormValues>({
    resolver: zodResolver(stepFormSchema),
    defaultValues: {
      title: "",
      description: "",
      targetElement: "",
      route: "/",
      position: "bottom",
      requiredPermissionResource: "",
      requiredPermissionAction: "",
      isActive: true,
    },
  });

  // Re-populate when dialog opens or target step changes
  useEffect(() => {
    if (!open) return;
    if (step) {
      reset({
        title: step.title,
        description: step.description,
        targetElement: step.targetElement,
        route: step.route,
        position: step.position,
        requiredPermissionResource: step.requiredPermission?.resource ?? "",
        requiredPermissionAction: step.requiredPermission?.action ?? "",
        isActive: step.isActive,
      });
    } else {
      reset({
        title: "",
        description: "",
        targetElement: "",
        route: "/",
        position: "bottom",
        requiredPermissionResource: "",
        requiredPermissionAction: "",
        isActive: true,
      });
    }
  }, [open, step, reset]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const permResource = watch("requiredPermissionResource");
  const permAction = watch("requiredPermissionAction");
  const hasPermission = permResource.trim() !== "" || permAction.trim() !== "";

  const onSubmit = handleSubmit((values) => {
    const requiredPermission =
      values.requiredPermissionResource.trim() && values.requiredPermissionAction.trim()
        ? {
            resource: values.requiredPermissionResource.trim(),
            action: values.requiredPermissionAction.trim(),
          }
        : null;

    onSave({
      title: values.title,
      description: values.description,
      targetElement: values.targetElement,
      route: values.route,
      position: values.position,
      requiredPermission,
      isActive: values.isActive,
    });
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-lg max-h-[90vh]">
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {step ? "Edit step" : "Add step"}
        </h2>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {/* Title i18n key */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="step-title">
              Title i18n key <span className="text-destructive">*</span>
            </label>
            <input
              id="step-title"
              {...register("title")}
              placeholder="e.g. tours.admin.dashboard.title"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>

          {/* Description i18n key */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="step-desc">
              Description i18n key <span className="text-destructive">*</span>
            </label>
            <input
              id="step-desc"
              {...register("description")}
              placeholder="e.g. tours.admin.dashboard.description"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {errors.description && (
              <p className="mt-1 text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          {/* Target element */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="step-target">
              Target element <span className="text-destructive">*</span>
            </label>
            <Controller
              control={control}
              name="targetElement"
              render={({ field }) => (
                <TourTargetPicker
                  id="step-target"
                  value={field.value}
                  onChange={field.onChange}
                  hasError={!!errors.targetElement}
                />
              )}
            />
            {errors.targetElement && (
              <p className="mt-1 text-xs text-destructive">{errors.targetElement.message}</p>
            )}
          </div>

          {/* Route + Position side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="step-route">
                Route <span className="text-destructive">*</span>
              </label>
              <input
                id="step-route"
                {...register("route")}
                placeholder="/dashboard"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {errors.route && (
                <p className="mt-1 text-xs text-destructive">{errors.route.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="step-position">
                Position
              </label>
              <select
                id="step-position"
                {...register("position")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Required permission */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Required permission (optional)</span>
              {hasPermission && (
                <button
                  type="button"
                  onClick={() => {
                    setValue("requiredPermissionResource", "");
                    setValue("requiredPermissionAction", "");
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  {...register("requiredPermissionResource")}
                  placeholder="resource (e.g. assets)"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <input
                  {...register("requiredPermissionAction")}
                  placeholder="action (e.g. create)"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Steps without a permission are shown to all users on this role&apos;s tour.
            </p>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2">
            <input
              id="step-active"
              type="checkbox"
              {...register("isActive")}
              className="h-4 w-4 rounded border-gray-300 accent-primary"
            />
            <label htmlFor="step-active" className="text-sm font-medium">
              Active (show this step in tour)
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {step ? "Save changes" : "Add step"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
