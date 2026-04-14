"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { MaintenanceScheduleItem } from "@/types/admin";

// ── Option types ────────────────────────────────────────────────────
interface AssetOption {
  id: string;
  name: string;
  assetNumber: string;
}

interface ScheduleOption {
  id: string;
  title: string;
}

// ── Condition options ───────────────────────────────────────────────
const CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

// ── Zod schema ──────────────────────────────────────────────────────
const logSchema = z.object({
  assetId: z.string().min(1, "Asset is required"),
  maintenanceScheduleId: z.string().optional(),
  performedAt: z.string().min(1, "Performed at is required"),
  description: z.string().min(1, "Description is required"),
  findings: z.string().optional(),
  actionTaken: z.string().optional(),
  cost: z.string().optional(),
  vendorName: z.string().optional(),
  conditionBefore: z.enum(CONDITIONS),
  conditionAfter: z.enum(CONDITIONS),
});

type LogFormValues = z.infer<typeof logSchema>;

// ── Props ───────────────────────────────────────────────────────────
interface MaintenanceLogDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  prefillSchedule?: MaintenanceScheduleItem | null;
}

// ── Searchable Select ───────────────────────────────────────────────
function SearchableSelect({
  label,
  options,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  options: { id: string; display: string }[];
  value: string;
  onChange: (val: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.display.toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = options.find((o) => o.id === value)?.display ?? "";

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        type="text"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder={placeholder ?? `Search ${label.toLowerCase()}...`}
        value={isOpen ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
          setQuery("");
        }}
        onBlur={() => {
          setTimeout(() => setIsOpen(false), 200);
        }}
      />
      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-card shadow-md">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm hover:bg-accent",
                  opt.id === value && "bg-accent font-medium",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.id);
                  setIsOpen(false);
                }}
              >
                {opt.display}
              </button>
            ))
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────
export default function MaintenanceLogDialog({
  open,
  onClose,
  onSaved,
  prefillSchedule,
}: MaintenanceLogDialogProps) {
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<LogFormValues>({
    resolver: zodResolver(logSchema),
    defaultValues: {
      assetId: "",
      maintenanceScheduleId: "",
      performedAt: "",
      description: "",
      findings: "",
      actionTaken: "",
      cost: "",
      vendorName: "",
      conditionBefore: "GOOD",
      conditionAfter: "GOOD",
    },
  });

  const fetchOptions = useCallback(async () => {
    try {
      const [assetData, scheduleData] = await Promise.all([
        apiGet<AssetOption[]>("/api/assets"),
        apiGet<ScheduleOption[]>("/api/maintenance/schedules"),
      ]);
      setAssets(assetData);
      setSchedules(scheduleData);
    } catch {
      // silently handle
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchOptions();
      if (prefillSchedule) {
        reset({
          assetId: prefillSchedule.asset.id,
          maintenanceScheduleId: prefillSchedule.id,
          performedAt: new Date().toISOString().slice(0, 16),
          description: "",
          findings: "",
          actionTaken: "",
          cost: "",
          vendorName: "",
          conditionBefore: "GOOD",
          conditionAfter: "GOOD",
        });
      } else {
        reset({
          assetId: "",
          maintenanceScheduleId: "",
          performedAt: "",
          description: "",
          findings: "",
          actionTaken: "",
          cost: "",
          vendorName: "",
          conditionBefore: "GOOD",
          conditionAfter: "GOOD",
        });
      }
    }
  }, [open, prefillSchedule, reset, fetchOptions]);

  const onSubmit = async (data: LogFormValues) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = {
        ...data,
        maintenanceScheduleId: data.maintenanceScheduleId || undefined,
        findings: data.findings || undefined,
        actionTaken: data.actionTaken || undefined,
        cost: data.cost || undefined,
        vendorName: data.vendorName || undefined,
      };
      await apiPost("/api/maintenance/logs", payload);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setSubmitError(getApiErrorMessage(err, "Failed to create log. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const assetOptions = useMemo(
    () =>
      assets.map((a) => ({
        id: a.id,
        display: `${a.assetNumber} - ${a.name}`,
      })),
    [assets],
  );

  const scheduleOptions = useMemo(
    () => schedules.map((s) => ({ id: s.id, display: s.title })),
    [schedules],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Log Maintenance</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Asset */}
          <Controller
            control={control}
            name="assetId"
            render={({ field }) => (
              <SearchableSelect
                label="Asset"
                options={assetOptions}
                value={field.value}
                onChange={field.onChange}
                error={errors.assetId?.message}
              />
            )}
          />

          {/* Schedule (optional) */}
          <Controller
            control={control}
            name="maintenanceScheduleId"
            render={({ field }) => (
              <SearchableSelect
                label="Schedule (optional)"
                options={scheduleOptions}
                value={field.value ?? ""}
                onChange={field.onChange}
                placeholder="Search schedule..."
              />
            )}
          />

          {/* Performed At */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Performed At
            </label>
            <input
              type="datetime-local"
              {...register("performedAt")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            {errors.performedAt?.message && (
              <p className="mt-1 text-xs text-destructive">
                {errors.performedAt.message}
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
              placeholder="What maintenance was performed..."
            />
            {errors.description?.message && (
              <p className="mt-1 text-xs text-destructive">
                {errors.description.message}
              </p>
            )}
          </div>

          {/* Findings */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Findings (optional)
            </label>
            <textarea
              {...register("findings")}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Any findings during maintenance..."
            />
          </div>

          {/* Action Taken */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Action Taken (optional)
            </label>
            <textarea
              {...register("actionTaken")}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Actions taken to resolve..."
            />
          </div>

          {/* Condition Before / After */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Condition Before
              </label>
              <select
                {...register("conditionBefore")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Condition After
              </label>
              <select
                {...register("conditionAfter")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cost */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Cost (optional)
            </label>
            <input
              type="text"
              {...register("cost")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="e.g. 150000"
            />
          </div>

          {/* Vendor Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Vendor Name (optional)
            </label>
            <input
              type="text"
              {...register("vendorName")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="e.g. PT Servis Jaya"
            />
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
              {submitting ? "Saving..." : "Save Log"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
