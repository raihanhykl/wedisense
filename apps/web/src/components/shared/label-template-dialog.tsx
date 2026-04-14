"use client";

import { useEffect, useState } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiPost, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { LabelTemplateItem } from "@/types/admin";

// ── Constants ──────────────────────────────────────────────────────
const FIELD_TYPES = [
  "barcode",
  "qr_code",
  "text",
  "field",
  "divider",
] as const;

const FIELD_KEY_OPTIONS = [
  "asset_number",
  "serial_number",
  "name",
  "location",
  "assigned_to",
  "purchase_date",
  "warranty_end_date",
] as const;

// ── Zod schema ─────────────────────────────────────────────────────
const labelFieldSchema = z.object({
  type: z.enum(FIELD_TYPES),
  field_key: z.string().optional(),
  label: z.string().optional(),
  x: z.coerce.number().min(0, "x must be >= 0"),
  y: z.coerce.number().min(0, "y must be >= 0"),
  width: z.coerce.number().min(0).optional(),
  font_size: z.coerce.number().min(1).optional(),
  bold: z.boolean().optional(),
  custom_value: z.string().optional(),
});

const templateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  paperWidthMm: z.coerce.number().min(1, "Width must be > 0"),
  paperHeightMm: z.coerce.number().min(1, "Height must be > 0"),
  isDefault: z.boolean(),
  fields: z.array(labelFieldSchema),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

// ── Props ──────────────────────────────────────────────────────────
interface LabelTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  template?: LabelTemplateItem | null;
}

// ── Component ──────────────────────────────────────────────────────
export default function LabelTemplateDialog({
  open,
  onClose,
  onSaved,
  template,
}: LabelTemplateDialogProps) {
  const isEdit = !!template;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: "",
      description: "",
      paperWidthMm: 50,
      paperHeightMm: 25,
      isDefault: false,
      fields: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "fields",
  });

  useEffect(() => {
    if (open) {
      if (template) {
        reset({
          name: template.name,
          description: template.description ?? "",
          paperWidthMm: template.paperWidthMm,
          paperHeightMm: template.paperHeightMm,
          isDefault: template.isDefault,
          fields: template.fields.map((f) => ({
            type: f.type,
            field_key: f.field_key ?? "",
            label: f.label ?? "",
            x: f.x,
            y: f.y,
            width: f.width,
            font_size: f.font_size,
            bold: f.bold ?? false,
            custom_value: f.custom_value ?? "",
          })),
        });
      } else {
        reset({
          name: "",
          description: "",
          paperWidthMm: 50,
          paperHeightMm: 25,
          isDefault: false,
          fields: [],
        });
      }
    }
  }, [open, template, reset]);

  const onSubmit = async (data: TemplateFormValues) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = {
        ...data,
        description: data.description || undefined,
        fields: data.fields.map((f) => ({
          ...f,
          field_key: f.field_key || undefined,
          label: f.label || undefined,
          width: f.width || undefined,
          font_size: f.font_size || undefined,
          custom_value: f.custom_value || undefined,
        })),
      };
      if (isEdit) {
        await apiPut(`/api/label-templates/${template.id}`, payload);
      } else {
        await apiPost("/api/label-templates", payload);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setSubmitError(getApiErrorMessage(err,
        isEdit
          ? "Failed to update template. Please try again."
          : "Failed to create template. Please try again.",
      ));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddField = () => {
    append({
      type: "text",
      field_key: "",
      label: "",
      x: 0,
      y: 0,
      width: undefined,
      font_size: undefined,
      bold: false,
      custom_value: "",
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? "Edit Template" : "New Label Template"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              {...register("name")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Standard Asset Label"
            />
            {errors.name?.message && (
              <p className="mt-1 text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description
            </label>
            <textarea
              {...register("description")}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional description..."
            />
          </div>

          {/* Paper size */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Paper Width (mm)
              </label>
              <input
                type="number"
                {...register("paperWidthMm")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {errors.paperWidthMm?.message && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.paperWidthMm.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Paper Height (mm)
              </label>
              <input
                type="number"
                {...register("paperHeightMm")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {errors.paperHeightMm?.message && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.paperHeightMm.message}
                </p>
              )}
            </div>
          </div>

          {/* Is Default */}
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="isDefault"
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    field.value ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform",
                      field.value ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </button>
              )}
            />
            <label className="text-sm font-medium">Set as Default</label>
          </div>

          {/* ── Field Editor ──────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">Fields</label>
              <button
                type="button"
                onClick={handleAddField}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add Field
              </button>
            </div>

            {fields.length === 0 && (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No fields yet. Click &quot;Add Field&quot; to start building
                your label layout.
              </p>
            )}

            <div className="space-y-3">
              {fields.map((field, index) => {
                const fieldType = watch(`fields.${index}.type`);
                return (
                  <div
                    key={field.id}
                    className="rounded-md border bg-muted/30 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Field {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="rounded px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {/* Type */}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Type
                        </label>
                        <select
                          {...register(`fields.${index}.type`)}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        >
                          {FIELD_TYPES.map((ft) => (
                            <option key={ft} value={ft}>
                              {ft.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Field Key (only for 'field' type) */}
                      {fieldType === "field" && (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Field Key
                          </label>
                          <select
                            {...register(`fields.${index}.field_key`)}
                            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                          >
                            <option value="">Select field...</option>
                            {FIELD_KEY_OPTIONS.map((fk) => (
                              <option key={fk} value={fk}>
                                {fk.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Label */}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Label
                        </label>
                        <input
                          type="text"
                          {...register(`fields.${index}.label`)}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                          placeholder="Optional label"
                        />
                      </div>

                      {/* X */}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          X
                        </label>
                        <input
                          type="number"
                          {...register(`fields.${index}.x`)}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        />
                        {errors.fields?.[index]?.x?.message && (
                          <p className="mt-0.5 text-xs text-destructive">
                            {errors.fields[index]?.x?.message}
                          </p>
                        )}
                      </div>

                      {/* Y */}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Y
                        </label>
                        <input
                          type="number"
                          {...register(`fields.${index}.y`)}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        />
                        {errors.fields?.[index]?.y?.message && (
                          <p className="mt-0.5 text-xs text-destructive">
                            {errors.fields[index]?.y?.message}
                          </p>
                        )}
                      </div>

                      {/* Width */}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Width
                        </label>
                        <input
                          type="number"
                          {...register(`fields.${index}.width`)}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                          placeholder="Auto"
                        />
                      </div>

                      {/* Font Size */}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Font Size
                        </label>
                        <input
                          type="number"
                          {...register(`fields.${index}.font_size`)}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                          placeholder="Default"
                        />
                      </div>

                      {/* Bold */}
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            {...register(`fields.${index}.bold`)}
                            className="rounded border"
                          />
                          Bold
                        </label>
                      </div>

                      {/* Custom Value (for 'text' type) */}
                      {fieldType === "text" && (
                        <div className="col-span-2 sm:col-span-3">
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Custom Value
                          </label>
                          <input
                            type="text"
                            {...register(`fields.${index}.custom_value`)}
                            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                            placeholder="Static text to display"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting
                ? isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                  ? "Save Changes"
                  : "Create Template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
