"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExternalLink } from "lucide-react";
import { apiPost, apiPut, apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  LOCATION_TYPE_OPTIONS,
  type LocationTypeValue,
} from "@/lib/location-types";
import type { LocationFlat } from "@/types/admin";

// Mirror of the backend Zod enum (apps/api/src/modules/locations/schema.ts).
// Keeping this in lock-step prevents the silent-400 class of bugs where the
// form sends a string the API doesn't accept.
const LOCATION_TYPE_VALUES = LOCATION_TYPE_OPTIONS.map((o) => o.value) as [
  LocationTypeValue,
  ...LocationTypeValue[],
];

// Number fields arrive as empty strings from blank inputs. Convert to
// null before validation so Zod's number/range checks don't run on "".
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().nullable(),
);

const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  province: z.string().optional().default(""),
  type: z.enum(LOCATION_TYPE_VALUES, {
    errorMap: () => ({ message: "Type is required" }),
  }),
  parentId: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
  // Tier 4 metadata fields. All nullable — blank input = null.
  latitude: optionalNumber.refine(
    (n) => n === null || (n >= -90 && n <= 90),
    "Latitude must be between -90 and 90",
  ),
  longitude: optionalNumber.refine(
    (n) => n === null || (n >= -180 && n <= 180),
    "Longitude must be between -180 and 180",
  ),
  photoUrl: z
    .string()
    .url("Must be a valid URL")
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  contactPhone: z
    .string()
    .max(50)
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  contactEmail: z
    .string()
    .email("Must be a valid email")
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
});

type LocationFormValues = z.infer<typeof locationSchema>;

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
      parentId: null,
      isActive: true,
      latitude: null,
      longitude: null,
      photoUrl: null,
      contactPhone: null,
      contactEmail: null,
    },
  });

  const isActive = watch("isActive");
  const latitude = watch("latitude");
  const longitude = watch("longitude");

  // OpenStreetMap helper link — when both coords present, surface a "view on
  // map" link so users can sanity-check the pin without leaving copy-paste.
  const mapLink =
    latitude !== null && longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`
      : null;

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
          latitude: editingLocation.latitude,
          longitude: editingLocation.longitude,
          photoUrl: editingLocation.photoUrl,
          contactPhone: editingLocation.contactPhone,
          contactEmail: editingLocation.contactEmail,
        });
      } else {
        reset({
          name: "",
          code: "",
          address: "",
          city: "",
          province: "",
          parentId: null,
          isActive: true,
          latitude: null,
          longitude: null,
          photoUrl: null,
          contactPhone: null,
          contactEmail: null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog. max-h-[90vh] with internal scroll keeps the modal usable on
          short viewports now that we've grown the form. */}
      <div className="relative z-10 flex w-full max-w-2xl max-h-[90vh] flex-col rounded-lg border bg-card shadow-lg">
        <header className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            {editingLocation ? "Edit Location" : "Add Location"}
          </h2>
        </header>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* ── General ───────────────────────────────────────── */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                General
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" error={errors.name?.message}>
                  <input
                    {...register("name")}
                    className={inputCls(errors.name)}
                  />
                </Field>
                <Field label="Code" error={errors.code?.message}>
                  <input
                    {...register("code")}
                    className={inputCls(errors.code)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type" error={errors.type?.message}>
                  <select
                    {...register("type")}
                    defaultValue=""
                    className={inputCls(errors.type)}
                  >
                    <option value="" disabled>
                      Select type
                    </option>
                    {LOCATION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Parent Location">
                  <select
                    value={watch("parentId") ?? ""}
                    onChange={(e) =>
                      setValue("parentId", e.target.value || null, {
                        shouldValidate: true,
                      })
                    }
                    className={inputCls(undefined)}
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
                </Field>
              </div>

              <div className="flex items-center gap-2 pt-1">
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
                <span className="text-xs text-muted-foreground">
                  · Inactive locations are hidden from pickers by default
                </span>
              </div>
            </section>

            {/* ── Address & coordinates ─────────────────────────── */}
            <section className="space-y-4 border-t pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Address & coordinates
              </h3>

              <Field label="Address">
                <input {...register("address")} className={inputCls(undefined)} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City">
                  <input {...register("city")} className={inputCls(undefined)} />
                </Field>
                <Field label="Province">
                  <input
                    {...register("province")}
                    className={inputCls(undefined)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Latitude"
                  hint="Decimal degrees, e.g. -6.2088"
                  error={errors.latitude?.message}
                >
                  <input
                    {...register("latitude")}
                    type="number"
                    step="any"
                    placeholder="-90 to 90"
                    className={inputCls(errors.latitude)}
                  />
                </Field>
                <Field
                  label="Longitude"
                  hint="Decimal degrees, e.g. 106.8456"
                  error={errors.longitude?.message}
                >
                  <input
                    {...register("longitude")}
                    type="number"
                    step="any"
                    placeholder="-180 to 180"
                    className={inputCls(errors.longitude)}
                  />
                </Field>
              </div>
              {mapLink && (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View pin on OpenStreetMap
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </section>

            {/* ── Contact ───────────────────────────────────────── */}
            <section className="space-y-4 border-t pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contact & media
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Contact phone"
                  error={errors.contactPhone?.message}
                >
                  <input
                    {...register("contactPhone")}
                    type="tel"
                    placeholder="+62 ..."
                    className={inputCls(errors.contactPhone)}
                  />
                </Field>
                <Field
                  label="Contact email"
                  error={errors.contactEmail?.message}
                >
                  <input
                    {...register("contactEmail")}
                    type="email"
                    placeholder="manager@example.com"
                    className={inputCls(errors.contactEmail)}
                  />
                </Field>
              </div>

              <Field
                label="Photo URL"
                hint="Single primary photo. Upload UI lands later."
                error={errors.photoUrl?.message}
              >
                <input
                  {...register("photoUrl")}
                  type="url"
                  placeholder="https://…"
                  className={inputCls(errors.photoUrl)}
                />
              </Field>
            </section>
          </div>

          {/* Sticky actions */}
          <footer className="flex justify-end gap-2 border-t bg-card px-6 py-3">
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
              {submitting ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

// ── Form-field primitives (local to this file — small, single-use) ───

function inputCls(error: { message?: string } | undefined) {
  return cn(
    "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40",
    error && "border-destructive",
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
