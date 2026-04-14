"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiGet } from "@/lib/api";
import type { AssetFormData } from "@/types/admin";

// ── Zod schema ──────────────────────────────────────────────────────
const assetSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  name: z.string().min(1, "Name is required"),
  serialNumber: z.string().optional().default(""),
  locationId: z.string().min(1, "Location is required"),
  assignedToUserId: z.string().optional().default(""),
  status: z.string().min(1, "Status is required"),
  condition: z.string().min(1, "Condition is required"),
  purchaseDate: z.string().optional().default(""),
  purchasePrice: z.string().optional().default(""),
  vendor: z.string().optional().default(""),
  invoiceNumber: z.string().optional().default(""),
  warrantyStartDate: z.string().optional().default(""),
  warrantyEndDate: z.string().optional().default(""),
  usefulLifeMonths: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

type AssetSchemaValues = z.infer<typeof assetSchema>;

// ── Option types ────────────────────────────────────────────────────
interface ProductOption {
  id: string;
  name: string;
  brand: string | null;
}

interface LocationOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

// ── Status & condition options ──────────────────────────────────────
const STATUS_OPTIONS = [
  "ACTIVE",
  "IDLE",
  "IN_MAINTENANCE",
  "DISPOSED",
  "LOST",
  "BORROWED",
];

const CONDITION_OPTIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];

// ── Props ───────────────────────────────────────────────────────────
interface AssetFormProps {
  defaultValues?: AssetFormData;
  onSubmit: (data: AssetFormData) => Promise<void>;
  submitLabel: string;
}

// ── Component ───────────────────────────────────────────────────────
export default function AssetForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: AssetFormProps) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AssetSchemaValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: defaultValues ?? {
      productId: "",
      name: "",
      serialNumber: "",
      locationId: "",
      assignedToUserId: "",
      status: "ACTIVE",
      condition: "NEW",
      purchaseDate: "",
      purchasePrice: "",
      vendor: "",
      invoiceNumber: "",
      warrantyStartDate: "",
      warrantyEndDate: "",
      usefulLifeMonths: "",
      notes: "",
    },
  });

  const selectedProductId = watch("productId");

  // Fetch reference data
  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiGet<ProductOption[]>("/api/products", {
        search: productSearch,
        limit: 50,
      });
      setProducts(data);
    } catch {
      // handle error
    }
  }, [productSearch]);

  const fetchLocations = useCallback(async () => {
    try {
      const data = await apiGet<LocationOption[]>("/api/locations", {
        limit: 100,
      });
      setLocations(data);
    } catch {
      // handle error
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiGet<UserOption[]>("/api/users", { limit: 100 });
      setUsers(data);
    } catch {
      // handle error
    }
  }, []);

  useEffect(() => {
    void fetchLocations();
    void fetchUsers();
  }, [fetchLocations, fetchUsers]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  // Auto-fill name from product
  useEffect(() => {
    if (!defaultValues && selectedProductId) {
      const product = products.find((p) => p.id === selectedProductId);
      if (product) {
        setValue("name", product.name);
      }
    }
  }, [selectedProductId, products, setValue, defaultValues]);

  const onFormSubmit = async (data: AssetSchemaValues) => {
    setSubmitting(true);
    try {
      await onSubmit(data as AssetFormData);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelClass = "mb-1 block text-sm font-medium";
  const errorClass = "mt-1 text-xs text-destructive";

  return (
    <form
      onSubmit={(e) => void handleSubmit(onFormSubmit)(e)}
      className="space-y-8"
    >
      {/* Product & Basic */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Basic Info</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Product search */}
          <div>
            <label htmlFor="productSearch" className={labelClass}>
              Product
            </label>
            <input
              id="productSearch"
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className={fieldClass}
            />
            <select
              {...register("productId")}
              className={`${fieldClass} mt-2`}
              size={4}
            >
              <option value="">-- Select a product --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.brand ? ` (${p.brand})` : ""}
                </option>
              ))}
            </select>
            {errors.productId && (
              <p className={errorClass}>{errors.productId.message}</p>
            )}
          </div>

          {/* Name */}
          <div>
            <label htmlFor="name" className={labelClass}>
              Name
            </label>
            <input id="name" {...register("name")} className={fieldClass} />
            {errors.name && (
              <p className={errorClass}>{errors.name.message}</p>
            )}
          </div>

          {/* Serial Number */}
          <div>
            <label htmlFor="serialNumber" className={labelClass}>
              Serial Number
            </label>
            <input
              id="serialNumber"
              {...register("serialNumber")}
              className={fieldClass}
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="locationId" className={labelClass}>
              Location
            </label>
            <select
              id="locationId"
              {...register("locationId")}
              className={fieldClass}
            >
              <option value="">-- Select location --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            {errors.locationId && (
              <p className={errorClass}>{errors.locationId.message}</p>
            )}
          </div>

          {/* Assigned To */}
          <div>
            <label htmlFor="assignedToUserId" className={labelClass}>
              Assigned To
            </label>
            <select
              id="assignedToUserId"
              {...register("assignedToUserId")}
              className={fieldClass}
            >
              <option value="">-- Unassigned --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select
              id="status"
              {...register("status")}
              className={fieldClass}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {errors.status && (
              <p className={errorClass}>{errors.status.message}</p>
            )}
          </div>

          {/* Condition */}
          <div>
            <label htmlFor="condition" className={labelClass}>
              Condition
            </label>
            <select
              id="condition"
              {...register("condition")}
              className={fieldClass}
            >
              {CONDITION_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {errors.condition && (
              <p className={errorClass}>{errors.condition.message}</p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Financial */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Financial</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="purchaseDate" className={labelClass}>
              Purchase Date
            </label>
            <input
              id="purchaseDate"
              type="date"
              {...register("purchaseDate")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="purchasePrice" className={labelClass}>
              Purchase Price (IDR)
            </label>
            <input
              id="purchasePrice"
              type="number"
              step="1"
              {...register("purchasePrice")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="vendor" className={labelClass}>
              Vendor
            </label>
            <input
              id="vendor"
              {...register("vendor")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="invoiceNumber" className={labelClass}>
              Invoice Number
            </label>
            <input
              id="invoiceNumber"
              {...register("invoiceNumber")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="usefulLifeMonths" className={labelClass}>
              Useful Life (months)
            </label>
            <input
              id="usefulLifeMonths"
              type="number"
              {...register("usefulLifeMonths")}
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* Warranty */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Warranty</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="warrantyStartDate" className={labelClass}>
              Warranty Start Date
            </label>
            <input
              id="warrantyStartDate"
              type="date"
              {...register("warrantyStartDate")}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="warrantyEndDate" className={labelClass}>
              Warranty End Date
            </label>
            <input
              id="warrantyEndDate"
              type="date"
              {...register("warrantyEndDate")}
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* Notes */}
      <fieldset className="rounded-lg border bg-card p-5">
        <legend className="px-2 text-lg font-semibold">Notes</legend>
        <div className="mt-4">
          <textarea
            id="notes"
            rows={4}
            {...register("notes")}
            className={fieldClass}
            placeholder="Additional notes..."
          />
        </div>
      </fieldset>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
