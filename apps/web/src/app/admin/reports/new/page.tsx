"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import type { ReportItem, ReportType, ReportSchedule } from "@/types/admin";

interface LocationOption {
  id: string;
  code: string;
  name: string;
  city: string | null;
}

// ── Schema ──────────────────────────────────────────────────────────
const reportSchema = z.object({
  name: z.string().min(1, "Report name is required"),
  type: z.enum(["ASSET_LIST", "MOVEMENT", "MAINTENANCE", "DEPRECIATION", "AUDIT", "CUSTOM"]),
  format: z.enum(["excel", "pdf"]),
  schedule: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
  // Simple text-based filter parameters (JSON-compatible)
  paramStartDate: z.string().optional(),
  paramEndDate: z.string().optional(),
  paramStatus: z.string().optional(),
  paramLocationId: z.string().optional(),
  paramNotes: z.string().optional(),
});

type ReportFormValues = z.infer<typeof reportSchema>;

// ── Type options ────────────────────────────────────────────────────
const TYPE_OPTIONS: Array<{ value: ReportType; label: string }> = [
  { value: "ASSET_LIST", label: "Asset List" },
  { value: "MOVEMENT", label: "Movement" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "DEPRECIATION", label: "Depreciation" },
  { value: "AUDIT", label: "Audit" },
  { value: "CUSTOM", label: "Custom" },
];

const SCHEDULE_OPTIONS: Array<{ value: ReportSchedule; label: string }> = [
  { value: "NONE", label: "No schedule" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

// ── Page ────────────────────────────────────────────────────────────
export default function NewReportPage() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);

  // Load locations once for the location-filter dropdown. Failure is
  // non-fatal — user can still create a report without a location filter.
  useEffect(() => {
    let cancelled = false;
    apiGet<LocationOption[]>("/api/locations")
      .then((data) => {
        if (!cancelled) setLocations(data);
      })
      .catch(() => {
        // Silent — empty list means the filter is unavailable, not broken.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      name: "",
      type: "ASSET_LIST",
      format: "excel",
      schedule: "NONE",
      paramStartDate: "",
      paramEndDate: "",
      paramStatus: "",
      paramLocationId: "",
      paramNotes: "",
    },
  });

  const selectedType = watch("type");

  const onSubmit = async (values: ReportFormValues) => {
    setSubmitError("");

    // Build parameters object from form fields
    const parameters: Record<string, unknown> = { format: values.format };
    if (values.paramStartDate) parameters.startDate = values.paramStartDate;
    if (values.paramEndDate) parameters.endDate = values.paramEndDate;
    if (values.paramStatus) parameters.status = values.paramStatus;
    if (values.paramLocationId) parameters.locationId = values.paramLocationId;
    if (values.paramNotes) parameters.notes = values.paramNotes;

    try {
      const report = await apiPost<ReportItem>("/api/reports", {
        name: values.name,
        type: values.type,
        parameters,
        schedule: values.schedule === "NONE" ? null : values.schedule,
      });
      router.push(`/admin/reports/${report.id}`);
    } catch (err: unknown) {
      setSubmitError(getApiErrorMessage(err, "Failed to create report. Please try again."));
    }
  };

  return (
    <div className="p-6" data-tour="report-create">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Create Report</h1>
        <Link
          href="/admin/reports"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to Reports
        </Link>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="max-w-lg space-y-5"
      >
        {/* Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Report Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            {...register("name")}
            placeholder="e.g. Monthly Asset Summary"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            data-tour="report-name-input"
          />
          {errors.name?.message && (
            <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>

        {/* Type */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Report Type <span className="text-destructive">*</span>
          </label>
          <select
            {...register("type")}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            data-tour="report-type-select"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {errors.type?.message && (
            <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>
          )}
        </div>

        {/* Format */}
        <div>
          <label className="mb-2 block text-sm font-medium">
            Output Format <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-4">
            {(["excel", "pdf"] as const).map((fmt) => (
              <label key={fmt} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value={fmt}
                  {...register("format")}
                  className="h-4 w-4"
                />
                {fmt === "excel" ? "Excel (.xlsx)" : "PDF"}
              </label>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div>
          <label className="mb-1 block text-sm font-medium">Schedule</label>
          <select
            {...register("schedule")}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {SCHEDULE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Parameters — dynamic per type */}
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <h3 className="text-sm font-semibold">
            Parameters for {selectedType.replace(/_/g, " ")}
          </h3>

          {/* Date range — for MOVEMENT, MAINTENANCE, AUDIT */}
          {["MOVEMENT", "MAINTENANCE", "AUDIT", "CUSTOM"].includes(selectedType) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Start Date
                </label>
                <input
                  type="date"
                  {...register("paramStartDate")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  End Date
                </label>
                <input
                  type="date"
                  {...register("paramEndDate")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {/* Status filter — for ASSET_LIST */}
          {["ASSET_LIST", "CUSTOM"].includes(selectedType) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Asset Status (leave blank for all)
              </label>
              <select
                {...register("paramStatus")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">All Statuses</option>
                {[
                  "ACTIVE",
                  "IDLE",
                  "IN_MAINTENANCE",
                  "DISPOSED",
                  "LOST",
                  "BORROWED",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Location (optional dropdown) */}
          {["ASSET_LIST", "MOVEMENT", "CUSTOM"].includes(selectedType) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Location (optional — leave as &quot;All Locations&quot; for no filter)
              </label>
              <select
                {...register("paramLocationId")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                    {loc.city ? ` — ${loc.city}` : ""}
                    {loc.code ? ` [${loc.code}]` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Notes / custom query */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Notes / Additional filters
            </label>
            <input
              type="text"
              {...register("paramNotes")}
              placeholder="Optional notes or extra context"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Error */}
        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Link
            href="/admin/reports"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            data-tour="save-report-btn"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create Report"}
          </button>
        </div>
      </form>
    </div>
  );
}
