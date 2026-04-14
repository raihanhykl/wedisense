"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MaintenanceScheduleItem } from "@/types/admin";

// ── Option types ────────────────────────────────────────────────────
interface AssetOption {
  id: string;
  name: string;
  assetNumber: string;
}

interface UserOption {
  id: string;
  name: string;
}

// ── Frequency types ─────────────────────────────────────────────────
const FREQUENCY_TYPES = [
  "ONE_TIME",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const;

// ── Zod schema ──────────────────────────────────────────────────────
const scheduleSchema = z.object({
  assetId: z.string().min(1, "Asset is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  frequencyType: z.enum(FREQUENCY_TYPES),
  nextDueDate: z.string().min(1, "Next due date is required"),
  assignedToUserId: z.string().optional(),
  isActive: z.boolean(),
});

type ScheduleFormValues = z.infer<typeof scheduleSchema>;

// ── Props ───────────────────────────────────────────────────────────
interface MaintenanceScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  schedule?: MaintenanceScheduleItem | null;
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
export default function MaintenanceScheduleDialog({
  open,
  onClose,
  onSaved,
  schedule,
}: MaintenanceScheduleDialogProps) {
  const isEdit = !!schedule;
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      assetId: "",
      title: "",
      description: "",
      frequencyType: "MONTHLY",
      nextDueDate: "",
      assignedToUserId: "",
      isActive: true,
    },
  });

  const fetchOptions = useCallback(async () => {
    try {
      const [assetData, userData] = await Promise.all([
        apiGet<AssetOption[]>("/api/assets"),
        apiGet<UserOption[]>("/api/users"),
      ]);
      setAssets(assetData);
      setUsers(userData);
    } catch {
      // silently handle
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchOptions();
      if (schedule) {
        reset({
          assetId: schedule.asset.id,
          title: schedule.title,
          description: schedule.description ?? "",
          frequencyType: schedule.frequencyType as ScheduleFormValues["frequencyType"],
          nextDueDate: schedule.nextDueDate.split("T")[0],
          assignedToUserId: schedule.assignedTo?.id ?? "",
          isActive: schedule.isActive,
        });
      } else {
        reset({
          assetId: "",
          title: "",
          description: "",
          frequencyType: "MONTHLY",
          nextDueDate: "",
          assignedToUserId: "",
          isActive: true,
        });
      }
    }
  }, [open, schedule, reset, fetchOptions]);

  const onSubmit = async (data: ScheduleFormValues) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = {
        ...data,
        assignedToUserId: data.assignedToUserId || undefined,
        description: data.description || undefined,
      };
      if (isEdit) {
        await apiPut(`/api/maintenance/schedules/${schedule.id}`, payload);
      } else {
        await apiPost("/api/maintenance/schedules", payload);
      }
      onSaved();
      onClose();
    } catch {
      setSubmitError(
        isEdit
          ? "Failed to update schedule. Please try again."
          : "Failed to create schedule. Please try again.",
      );
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

  const userOptions = useMemo(
    () => users.map((u) => ({ id: u.id, display: u.name })),
    [users],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? "Edit Schedule" : "New Maintenance Schedule"}
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

          {/* Title */}
          <div>
            <label className="mb-1 block text-sm font-medium">Title</label>
            <input
              type="text"
              {...register("title")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Monthly oil change"
            />
            {errors.title?.message && (
              <p className="mt-1 text-xs text-destructive">
                {errors.title.message}
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

          {/* Frequency Type */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Frequency
            </label>
            <select
              {...register("frequencyType")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {FREQUENCY_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {ft.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Next Due Date */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Next Due Date
            </label>
            <input
              type="date"
              {...register("nextDueDate")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            {errors.nextDueDate?.message && (
              <p className="mt-1 text-xs text-destructive">
                {errors.nextDueDate.message}
              </p>
            )}
          </div>

          {/* Assigned To */}
          <Controller
            control={control}
            name="assignedToUserId"
            render={({ field }) => (
              <SearchableSelect
                label="Assigned To (optional)"
                options={userOptions}
                value={field.value ?? ""}
                onChange={field.onChange}
                placeholder="Search user..."
              />
            )}
          />

          {/* Is Active */}
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="isActive"
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
            <label className="text-sm font-medium">Active</label>
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
                  : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
