"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, Controller, type FieldValues, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Movement types ──────────────────────────────────────────────────
const MOVEMENT_TYPES = [
  "ASSIGNMENT",
  "UNASSIGNMENT",
  "LOCATION_TRANSFER",
  "LOAN_OUT",
  "LOAN_RETURN",
  "SWAP",
  "SEND_TO_MAINTENANCE",
  "RETURN_FROM_MAINTENANCE",
  "DISPOSAL",
  "LOST",
  "FOUND",
  "RESIGNATION_RETURN",
] as const;

type MovementType = (typeof MOVEMENT_TYPES)[number];

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

interface LocationOption {
  id: string;
  name: string;
}

// ── Dynamic Zod schema ──────────────────────────────────────────────
function buildSchema(movementType: MovementType) {
  const base = {
    movementType: z.enum(MOVEMENT_TYPES),
    notes: z.string().optional(),
  };

  switch (movementType) {
    case "ASSIGNMENT":
      return z.object({
        ...base,
        assetId: z.string().min(1, "Asset is required"),
        toUserId: z.string().min(1, "User is required"),
      });
    case "UNASSIGNMENT":
    case "LOAN_RETURN":
    case "SEND_TO_MAINTENANCE":
    case "RETURN_FROM_MAINTENANCE":
    case "LOST":
    case "FOUND":
      return z.object({
        ...base,
        assetId: z.string().min(1, "Asset is required"),
      });
    case "LOCATION_TRANSFER":
      return z.object({
        ...base,
        assetId: z.string().min(1, "Asset is required"),
        toLocationId: z.string().min(1, "Location is required"),
      });
    case "LOAN_OUT":
      return z.object({
        ...base,
        assetId: z.string().min(1, "Asset is required"),
        toUserId: z.string().min(1, "User is required"),
        expectedReturnDate: z.string().min(1, "Expected return date is required"),
      });
    case "SWAP":
      return z.object({
        ...base,
        assetId: z.string().min(1, "Asset is required"),
        swapWithAssetId: z.string().min(1, "Swap asset is required"),
      });
    case "DISPOSAL":
      return z.object({
        ...base,
        assetId: z.string().min(1, "Asset is required"),
        notes: z.string().min(1, "Reason is required for disposal"),
      });
    case "RESIGNATION_RETURN":
      return z.object({
        ...base,
        userId: z.string().min(1, "User is required"),
      });
  }
}

// ── Form values type ────────────────────────────────────────────────
interface MovementFormValues {
  movementType: MovementType;
  notes?: string;
  assetId?: string;
  toUserId?: string;
  toLocationId?: string;
  expectedReturnDate?: string;
  swapWithAssetId?: string;
  userId?: string;
}

// ── Props ───────────────────────────────────────────────────────────
interface MovementFormDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// ── Searchable Select ───────────────────────────────────────────────
function SearchableSelect({
  label,
  options,
  value,
  onChange,
  displayFn,
  error,
}: {
  label: string;
  options: { id: string; display: string }[];
  value: string;
  onChange: (val: string) => void;
  displayFn?: (opt: { id: string; display: string }) => string;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.display.toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = options.find((o) => o.id === value)?.display ?? "";

  const getDisplay = displayFn ?? ((opt: { id: string; display: string }) => opt.display);

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        type="text"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder={`Search ${label.toLowerCase()}...`}
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
          // Delay to allow click on option
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
                {getDisplay(opt)}
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
export default function MovementFormDialog({
  open,
  onClose,
  onCreated,
}: MovementFormDialogProps) {
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [selectedType, setSelectedType] = useState<MovementType>("ASSIGNMENT");

  const schema = useMemo(() => buildSchema(selectedType), [selectedType]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors },
  } = useForm<MovementFormValues>({
    resolver: zodResolver(schema as z.ZodType<MovementFormValues>),
    defaultValues: {
      movementType: "ASSIGNMENT",
      notes: "",
    },
  });

  const fetchOptions = useCallback(async () => {
    try {
      const [assetData, userData, locationData] = await Promise.all([
        apiGet<AssetOption[]>("/api/assets"),
        apiGet<UserOption[]>("/api/users"),
        apiGet<LocationOption[]>("/api/locations"),
      ]);
      setAssets(assetData);
      setUsers(userData);
      setLocations(locationData);
    } catch {
      // silently handle
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchOptions();
    }
  }, [open, fetchOptions]);

  const handleTypeChange = (type: MovementType) => {
    setSelectedType(type);
    reset({
      movementType: type,
      notes: "",
    });
  };

  const onSubmit = async (data: MovementFormValues) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await apiPost("/api/movements", data);
      onCreated();
      onClose();
      reset({ movementType: "ASSIGNMENT", notes: "" });
      setSelectedType("ASSIGNMENT");
    } catch {
      setSubmitError("Failed to create movement. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Fields that need asset
  const needsAsset = selectedType !== "RESIGNATION_RETURN";
  // Fields that need toUser
  const needsToUser =
    selectedType === "ASSIGNMENT" || selectedType === "LOAN_OUT";
  // Fields that need toLocation
  const needsToLocation = selectedType === "LOCATION_TRANSFER";
  // Fields that need expectedReturnDate
  const needsReturnDate = selectedType === "LOAN_OUT";
  // Fields that need swapWithAssetId
  const needsSwapAsset = selectedType === "SWAP";
  // Fields that need userId (no asset)
  const needsUserId = selectedType === "RESIGNATION_RETURN";
  // Disposal needs required notes
  const notesRequired = selectedType === "DISPOSAL";

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

  const locationOptions = useMemo(
    () => locations.map((l) => ({ id: l.id, display: l.name })),
    [locations],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Movement</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Movement Type */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Movement Type
            </label>
            <select
              {...register("movementType")}
              value={selectedType}
              onChange={(e) =>
                handleTypeChange(e.target.value as MovementType)
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {MOVEMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Asset (searchable) */}
          {needsAsset && (
            <Controller
              control={control}
              name="assetId"
              render={({ field }) => (
                <SearchableSelect
                  label="Asset"
                  options={assetOptions}
                  value={field.value ?? ""}
                  onChange={(val) => {
                    field.onChange(val);
                    setValue("assetId", val);
                  }}
                  error={errors.assetId?.message}
                />
              )}
            />
          )}

          {/* Swap Asset (searchable) */}
          {needsSwapAsset && (
            <Controller
              control={control}
              name="swapWithAssetId"
              render={({ field }) => (
                <SearchableSelect
                  label="Swap With Asset"
                  options={assetOptions}
                  value={field.value ?? ""}
                  onChange={(val) => {
                    field.onChange(val);
                    setValue("swapWithAssetId", val);
                  }}
                  error={errors.swapWithAssetId?.message}
                />
              )}
            />
          )}

          {/* To User */}
          {needsToUser && (
            <Controller
              control={control}
              name="toUserId"
              render={({ field }) => (
                <SearchableSelect
                  label="To User"
                  options={userOptions}
                  value={field.value ?? ""}
                  onChange={(val) => {
                    field.onChange(val);
                    setValue("toUserId", val);
                  }}
                  error={errors.toUserId?.message}
                />
              )}
            />
          )}

          {/* User (for resignation return) */}
          {needsUserId && (
            <Controller
              control={control}
              name="userId"
              render={({ field }) => (
                <SearchableSelect
                  label="User"
                  options={userOptions}
                  value={field.value ?? ""}
                  onChange={(val) => {
                    field.onChange(val);
                    setValue("userId", val);
                  }}
                  error={errors.userId?.message}
                />
              )}
            />
          )}

          {/* To Location */}
          {needsToLocation && (
            <Controller
              control={control}
              name="toLocationId"
              render={({ field }) => (
                <SearchableSelect
                  label="To Location"
                  options={locationOptions}
                  value={field.value ?? ""}
                  onChange={(val) => {
                    field.onChange(val);
                    setValue("toLocationId", val);
                  }}
                  error={errors.toLocationId?.message}
                />
              )}
            />
          )}

          {/* Expected Return Date */}
          {needsReturnDate && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Expected Return Date
              </label>
              <input
                type="date"
                {...register("expectedReturnDate")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {errors.expectedReturnDate?.message && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.expectedReturnDate.message}
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Notes{notesRequired && " (required)"}
            </label>
            <textarea
              {...register("notes")}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={
                notesRequired
                  ? "Provide reason for disposal..."
                  : "Optional notes..."
              }
            />
            {errors.notes?.message && (
              <p className="mt-1 text-xs text-destructive">
                {errors.notes.message}
              </p>
            )}
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
              {submitting ? "Creating..." : "Create Movement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
