"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import BarcodeScanner from "@/components/barcode/barcode-scanner";
import {
  useProducts,
  useLocations,
  useUsers,
  useAssetCategories,
  referenceQueryKeys,
  type ProductOption,
} from "@/hooks/use-reference-data";
import type { AssetCategoryOption } from "@/types/admin";

// ── Backend product-lookup response shape ──────────────────────────
// The /api/products/lookup endpoint returns a wrapper, NOT the product
// directly. `product` is the existing internal record when matched; if the
// EAN was only found in upstream EAN APIs, the data lives in `lookup` and
// the caller must create the product before linking it to an asset.
interface ProductLookupResult {
  product: { id: string; name: string; brand: string | null } | null;
  lookup: {
    name: string;
    brand: string | null;
    model: string | null;
  } | null;
  source: 'internal' | 'upcitemdb' | 'go-upc' | 'not_found' | string;
}

// ── Constants ──────────────────────────────────────────────────────
const MAX_ROWS = 100;
const STATUS_OPTIONS = [
  "ACTIVE",
  "IDLE",
  "IN_MAINTENANCE",
  "DISPOSED",
  "LOST",
  "BORROWED",
] as const;
const CONDITION_OPTIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

// ── Schema ─────────────────────────────────────────────────────────
const rowSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  serialNumber: z.string().optional().default(""),
});

const multiAssetSchema = z
  .object({
    productId: z.string().min(1, "Product is required"),
    locationId: z.string().min(1, "Location is required"),
    assignedToUserId: z.string().optional().default(""),
    status: z.enum(STATUS_OPTIONS),
    condition: z.enum(CONDITION_OPTIONS),
    purchaseDate: z.string().optional().default(""),
    purchasePrice: z.string().optional().default(""),
    vendor: z.string().optional().default(""),
    invoiceNumber: z.string().optional().default(""),
    warrantyStartDate: z.string().optional().default(""),
    warrantyEndDate: z.string().optional().default(""),
    usefulLifeMonths: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    rows: z.array(rowSchema).min(1, "At least one asset is required").max(MAX_ROWS),
  })
  .superRefine((data, ctx) => {
    // Within-batch serial uniqueness — duplicate across rows is invalid
    // because two rows can't claim the same physical asset.
    const seen = new Map<string, number>();
    data.rows.forEach((r, i) => {
      const s = r.serialNumber?.trim();
      if (!s) return;
      const first = seen.get(s.toLowerCase());
      if (first !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", i, "serialNumber"],
          message: `Same serial as row ${first + 1}`,
        });
      } else {
        seen.set(s.toLowerCase(), i);
      }
    });
  });

type MultiAssetFormValues = z.infer<typeof multiAssetSchema>;

// ── Reference data types ───────────────────────────────────────────
// ProductOption is re-exported from use-reference-data so the dialog +
// listbox + cache write below all share one shape.

interface CreatedAsset {
  id: string;
  assetNumber: string;
  name: string;
}

interface MultiAssetCreateFormProps {
  onAllCreated: (assets: CreatedAsset[]) => void;
}

// ── Helpers ────────────────────────────────────────────────────────
function emptyRow(): { name: string; serialNumber: string } {
  return { name: "", serialNumber: "" };
}

// Empty-string-aware coercion used when building the API payload. Mirrors
// the helper used by the single-asset form so backend Zod parsing of
// numeric/date fields doesn't 422 on blank values.
function toNullableNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toNullableInt(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function toNullableString(raw: string): string | null {
  return raw.trim() === "" ? null : raw.trim();
}

// ── Component ──────────────────────────────────────────────────────
export default function MultiAssetCreateForm({
  onAllCreated,
}: MultiAssetCreateFormProps) {
  // The text the user typed; mirrors keystrokes. `debouncedSearch` is the
  // value actually fed into the products query so we don't fire one request
  // per keystroke (the previous behaviour generated 6+ requests for "Laptop").
  const [productSearch, setProductSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Form state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Scanner targets — either the product field or a specific row's serial.
  const [scannerTarget, setScannerTarget] = useState<
    { kind: "product" } | { kind: "serial"; rowIndex: number } | null
  >(null);

  // Inline "create new product" dialog state. Opened by the [+ New product]
  // button or by an EAN scan that found data upstream but no matching
  // internal product. Pre-fillable so the EAN-scan flow can pre-populate
  // name/brand/model/EAN before showing the dialog to the user for category.
  const [newProductDialog, setNewProductDialog] = useState<{
    open: boolean;
    initial: { name: string; brand: string; model: string; eanCode: string };
  }>({
    open: false,
    initial: { name: "", brand: "", model: "", eanCode: "" },
  });

  // Reference data via TanStack Query. Each hook caches independently with
  // the 5-min staleTime configured at the QueryProvider — so navigating
  // away and back doesn't re-fetch.
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts(debouncedSearch);
  const { data: locations = [] } = useLocations();
  const { data: users = [] } = useUsers();
  const { data: categories = [] } = useAssetCategories();

  // 300ms debounce between the visible input and the query key — matches the
  // asset-list pattern. Without this, every keystroke creates a new
  // queryKey, blowing past the staleTime cache entirely.
  useEffect(() => {
    if (productSearch === debouncedSearch) return;
    const handle = window.setTimeout(() => {
      setDebouncedSearch(productSearch);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [productSearch, debouncedSearch]);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    getValues,
    formState: { errors, isDirty },
  } = useForm<MultiAssetFormValues>({
    resolver: zodResolver(multiAssetSchema),
    defaultValues: {
      productId: "",
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
      rows: [emptyRow()],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "rows",
  });

  const selectedProductId = watch("productId");
  // Live derivation from the current products fetch — used to render the
  // selected-product label and to drive the auto-fill effect below.
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  // Sticky cache of the most recently selected product. Necessary because
  // `selectedProduct` above goes null whenever the products query refetches
  // with a search that doesn't match the picked item — which happens right
  // after picking (the productSearch effect below sets the search to
  // "Name (Brand)" and the backend's partial-match may exclude it).
  // The cache survives those refetches so `handleAddRow` and any other
  // downstream consumer can still read the picked product's name.
  const [pickedProduct, setPickedProduct] = useState<ProductOption | null>(null);

  // ── Auto-suffix Name when product changes ─────────────────────────
  // We only fill empty rows so we never overwrite user-typed names.
  useEffect(() => {
    if (!selectedProduct) return;
    // Promote the live selection into the sticky cache. Once stored, it
    // outlives transient `selectedProduct === null` windows during refetch.
    setPickedProduct(selectedProduct);
    const rows = getValues("rows");
    rows.forEach((row, i) => {
      if (!row.name.trim()) {
        setValue(`rows.${i}.name`, `${selectedProduct.name} - Unit ${i + 1}`, {
          shouldDirty: true,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  // ── Reflect the selected product in the search input ──────────────
  // Without this, the input keeps showing whatever the user last typed (or
  // the empty placeholder) even after they pick a product from the listbox —
  // confusing because the field looks unselected.
  useEffect(() => {
    if (selectedProduct) {
      const label = selectedProduct.brand
        ? `${selectedProduct.name} (${selectedProduct.brand})`
        : selectedProduct.name;
      setProductSearch(label);
    }
  }, [selectedProduct]);

  // ── Unsaved-changes guard ─────────────────────────────────────────
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleCancel = () => {
    if (isDirty) {
      const ok = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them?",
      );
      if (!ok) return;
    }
    window.history.back();
  };

  // ── Row operations ────────────────────────────────────────────────
  const handleAddRow = () => {
    if (fields.length >= MAX_ROWS) {
      toast.warning(
        `Maximum ${MAX_ROWS} assets per batch. Use Excel import for larger batches.`,
      );
      return;
    }
    // Prefer the live selection but fall back to the sticky cache so a
    // newly-appended row still gets "<Product> - Unit N" even when the
    // products query is mid-refetch and `selectedProduct` is null.
    const productName = selectedProduct?.name ?? pickedProduct?.name ?? "";
    const nextIndex = fields.length; // before append, index will equal current length
    append({
      name: productName ? `${productName} - Unit ${nextIndex + 1}` : "",
      serialNumber: "",
    });
  };

  const handleRemoveRow = (index: number) => {
    if (fields.length <= 1) return; // never allow zero rows
    remove(index);
  };

  // ── Scanner result handler ────────────────────────────────────────
  // Different behaviour per target:
  //  - product: lookup against /api/products/lookup. The response wraps a
  //    nullable `product` (internal match) and a nullable `lookup` (upstream
  //    EAN data when not yet cataloged). Three cases:
  //      a) `product` set → select it directly.
  //      b) only `lookup` set → pop the "create new product" dialog with the
  //         scan data prefilled so the user just picks a category.
  //      c) neither set → show an error toast.
  //  - serial: just paste the scanned value into the row's serial field.
  // EAN → product lookup + form prefill. Extracted from handleScanResult
  // so the same three-branch logic (existing product / external lookup
  // only / not found) can also drive the ?ean= URL prefill on mount —
  // when the user lands here from the /scan page's "Create Asset" CTA.
  const lookupAndApplyEan = useCallback(
    async (ean: string) => {
      try {
        const result = await apiPost<ProductLookupResult>(
          "/api/products/lookup",
          { ean },
        );
        if (result.product) {
          // (a) Existing internal product — select directly. Seed the cache
          // entry for the empty-search key so the product is in the listbox
          // even if the user hasn't typed anything matching.
          const matched = result.product;
          queryClient.setQueryData<ProductOption[]>(
            referenceQueryKeys.products(""),
            (prev) =>
              prev?.some((p) => p.id === matched.id)
                ? prev
                : [matched, ...(prev ?? [])],
          );
          setValue("productId", matched.id, { shouldDirty: true });
          toast.success(`Product matched: ${matched.name}`);
        } else if (result.lookup) {
          // (b) Upstream EAN data only — open the create dialog prefilled.
          setNewProductDialog({
            open: true,
            initial: {
              name: result.lookup.name,
              brand: result.lookup.brand ?? "",
              model: result.lookup.model ?? "",
              eanCode: ean,
            },
          });
          toast.info(
            `EAN ${ean} matched an external catalog. Pick a category to add it to your products.`,
          );
        } else {
          // (c) Nothing found anywhere.
          toast.error(`No product found for EAN ${ean}. Add it manually.`);
        }
      } catch (err: unknown) {
        toast.error(
          getApiErrorMessage(
            err,
            `Lookup failed for EAN ${ean}. Try again or add manually.`,
          ),
        );
      }
    },
    [setValue, queryClient],
  );

  // ── EAN query-param prefill ───────────────────────────────────────
  // The /scan page navigates here with `?ean=<value>` after a successful
  // product-scan. Run the same three-branch lookup on mount and feed the
  // result into the form (select existing / open create-new dialog /
  // show error toast). One-shot guard prevents re-runs from React
  // StrictMode's dev double-mount or unrelated state changes refiring
  // the effect.
  const [eanPrefillDone, setEanPrefillDone] = useState(false);
  useEffect(() => {
    if (eanPrefillDone) return;
    if (typeof window === "undefined") return;
    const ean = new URLSearchParams(window.location.search).get("ean");
    if (!ean) return;
    setEanPrefillDone(true);
    void lookupAndApplyEan(ean);
  }, [eanPrefillDone, lookupAndApplyEan]);

  const handleScanResult = useCallback(
    async (value: string) => {
      if (!scannerTarget) return;
      if (scannerTarget.kind === "serial") {
        setValue(`rows.${scannerTarget.rowIndex}.serialNumber`, value, {
          shouldDirty: true,
        });
        setScannerTarget(null);
        toast.success(`Serial captured for row ${scannerTarget.rowIndex + 1}`);
        return;
      }
      // Product scan — delegate to the shared lookup + apply path.
      try {
        await lookupAndApplyEan(value);
      } finally {
        setScannerTarget(null);
      }
    },
    [scannerTarget, setValue, lookupAndApplyEan],
  );

  // ── New product creation handler ──────────────────────────────────
  // Called by the inline dialog (either from the [+ New product] button or
  // the EAN-scan fallback). POSTs to /api/products with the chosen category,
  // seeds the empty-search cache so the product shows up in the listbox
  // immediately, and auto-selects it.
  const handleCreateProduct = useCallback(
    async (input: {
      name: string;
      categoryId: string;
      brand: string;
      model: string;
      eanCode: string;
    }): Promise<boolean> => {
      try {
        const payload: Record<string, unknown> = {
          name: input.name.trim(),
          categoryId: input.categoryId,
          source: "MANUAL" as const,
        };
        if (input.brand.trim()) payload['brand'] = input.brand.trim();
        if (input.model.trim()) payload['model'] = input.model.trim();
        if (input.eanCode.trim()) payload['eanCode'] = input.eanCode.trim();

        const created = await apiPost<ProductOption>("/api/products", payload);
        // Optimistically prepend to every cached search variant. Without
        // this, the listbox would not show the new product until the user
        // re-types into the search field (which would key a different
        // cache entry).
        queryClient.setQueriesData<ProductOption[]>(
          { queryKey: ["ref", "products"] },
          (prev) =>
            prev && !prev.some((p) => p.id === created.id)
              ? [created, ...prev]
              : prev,
        );
        // Also invalidate so any background refresh aligns with the server
        // truth (catches the case where two users add products simultaneously).
        void queryClient.invalidateQueries({ queryKey: ["ref", "products"] });
        setValue("productId", created.id, { shouldDirty: true });
        toast.success(`Product created: ${created.name}`);
        setNewProductDialog((s) => ({ ...s, open: false }));
        return true;
      } catch (err: unknown) {
        toast.error(getApiErrorMessage(err, "Failed to create product."));
        return false;
      }
    },
    [setValue, queryClient],
  );

  // ── Submit ────────────────────────────────────────────────────────
  const onFormSubmit = async (data: MultiAssetFormValues) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Fan-out: shared metadata × each row → N full asset payloads.
      const sharedPayload = {
        productId: data.productId,
        locationId: data.locationId,
        status: data.status,
        condition: data.condition,
        assignedToUserId: toNullableString(data.assignedToUserId),
        purchaseDate: data.purchaseDate === "" ? null : data.purchaseDate,
        purchasePrice: toNullableNumber(data.purchasePrice),
        vendor: toNullableString(data.vendor),
        invoiceNumber: toNullableString(data.invoiceNumber),
        warrantyStartDate: data.warrantyStartDate === "" ? null : data.warrantyStartDate,
        warrantyEndDate: data.warrantyEndDate === "" ? null : data.warrantyEndDate,
        usefulLifeMonths: toNullableInt(data.usefulLifeMonths),
        notes: toNullableString(data.notes),
      };

      const assets = data.rows.map((row) => ({
        ...sharedPayload,
        name: row.name.trim(),
        serialNumber: toNullableString(row.serialNumber),
      }));

      // POST /api/assets/bulk is atomic — all rows create or none. The
      // backend uses a single transaction with serial-cleanup pre-pass so
      // soft-deleted assets don't conflict.
      const created = await apiPost<CreatedAsset[]>("/api/assets/bulk", {
        assets,
      });

      // Mark form as no-longer-dirty so the unsaved-changes guard doesn't
      // trip on the navigation away.
      reset(data);

      toast.success(
        `${created.length} asset${created.length !== 1 ? "s" : ""} created.`,
      );
      onAllCreated(created);
    } catch (err: unknown) {
      // Backend rejections (e.g. SERIAL_NUMBER_EXISTS, location not found)
      // surface here. Show as inline banner — toast would be too ephemeral
      // for a blocking error.
      setSubmitError(
        getApiErrorMessage(err, "Failed to create assets. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelClass = "mb-1 block text-sm font-medium";
  const errorClass = "mt-1 text-xs text-destructive";

  return (
    <>
      <form
        onSubmit={(e) => void handleSubmit(onFormSubmit)(e)}
        className="space-y-8"
      >
        {/* ── Shared metadata ──────────────────────────────────────── */}
        <fieldset className="rounded-lg border bg-card p-5">
          <legend className="px-2 text-lg font-semibold">Basic Info</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Product picker — text search + listbox + EAN scan + manual create.
                Search input doubles as: (1) the filter that re-fetches the
                listbox below, and (2) a friendly label of the currently
                selected product (kept in sync via the effect above). */}
            <div className="sm:col-span-2">
              <label htmlFor="productSearch" className={labelClass}>
                Product <span className="text-destructive">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="productSearch"
                  type="text"
                  placeholder="Search products..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className={`${fieldClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => setScannerTarget({ kind: "product" })}
                  className="shrink-0 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
                  title="Scan EAN barcode"
                  data-tour="scan-product-btn"
                >
                  Scan EAN
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setNewProductDialog({
                      open: true,
                      initial: {
                        name: productSearch.trim(),
                        brand: "",
                        model: "",
                        eanCode: "",
                      },
                    })
                  }
                  className="shrink-0 rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
                  title="Create a new product"
                  data-tour="new-product-btn"
                >
                  + New product
                </button>
              </div>
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
              {products.length === 0 && productSearch.trim() && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No products match &ldquo;{productSearch}&rdquo;.{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setNewProductDialog({
                        open: true,
                        initial: {
                          name: productSearch.trim(),
                          brand: "",
                          model: "",
                          eanCode: "",
                        },
                      })
                    }
                    className="text-primary hover:underline"
                  >
                    Create &ldquo;{productSearch}&rdquo; as a new product
                  </button>
                </p>
              )}
              {errors.productId && (
                <p className={errorClass}>{errors.productId.message}</p>
              )}
            </div>

            {/* Location */}
            <div>
              <label htmlFor="locationId" className={labelClass}>
                Location <span className="text-destructive">*</span>
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

            {/* Assigned to */}
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
                Status <span className="text-destructive">*</span>
              </label>
              <select id="status" {...register("status")} className={fieldClass}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Condition */}
            <div>
              <label htmlFor="condition" className={labelClass}>
                Condition <span className="text-destructive">*</span>
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
            </div>
          </div>
        </fieldset>

        {/* ── Financial ─────────────────────────────────────────────── */}
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
                min="0"
                {...register("purchasePrice")}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="vendor" className={labelClass}>
                Vendor
              </label>
              <input id="vendor" {...register("vendor")} className={fieldClass} />
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
                step="1"
                min="1"
                {...register("usefulLifeMonths")}
                className={fieldClass}
              />
            </div>
          </div>
        </fieldset>

        {/* ── Warranty ──────────────────────────────────────────────── */}
        <fieldset className="rounded-lg border bg-card p-5">
          <legend className="px-2 text-lg font-semibold">Warranty</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="warrantyStartDate" className={labelClass}>
                Warranty Start
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
                Warranty End
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

        {/* ── Notes ─────────────────────────────────────────────────── */}
        <fieldset className="rounded-lg border bg-card p-5">
          <legend className="px-2 text-lg font-semibold">Notes</legend>
          <div className="mt-4">
            <textarea
              rows={3}
              {...register("notes")}
              className={fieldClass}
              placeholder="Notes shared across all assets in this batch..."
            />
          </div>
        </fieldset>

        {/* ── Per-row assets ────────────────────────────────────────── */}
        <fieldset className="rounded-lg border bg-card p-5" data-tour="asset-rows">
          <legend className="px-2 text-lg font-semibold">
            Assets in this batch ({fields.length})
          </legend>
          <p className="mt-1 text-sm text-muted-foreground">
            Each row creates one asset. Name is required; serial number is optional.
            All rows share the metadata above.
          </p>

          <div className="mt-4 space-y-3">
            {fields.map((field, index) => {
              const rowErrors = errors.rows?.[index];
              return (
                <div
                  key={field.id}
                  className={cn(
                    "grid grid-cols-[2rem_1fr_1fr_auto_2rem] items-start gap-3 rounded-md border p-3",
                    "bg-background",
                    rowErrors && "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <span className="mt-2 text-sm font-medium text-muted-foreground">
                    #{index + 1}
                  </span>
                  <div>
                    <Controller
                      control={control}
                      name={`rows.${index}.name`}
                      render={({ field: f }) => (
                        <input
                          {...f}
                          placeholder="Name"
                          className={fieldClass}
                          aria-label={`Asset ${index + 1} name`}
                        />
                      )}
                    />
                    {rowErrors?.name && (
                      <p className={errorClass}>{rowErrors.name.message}</p>
                    )}
                  </div>
                  <div>
                    <Controller
                      control={control}
                      name={`rows.${index}.serialNumber`}
                      render={({ field: f }) => (
                        <input
                          {...f}
                          placeholder="Serial number (optional)"
                          className={fieldClass}
                          aria-label={`Asset ${index + 1} serial number`}
                        />
                      )}
                    />
                    {rowErrors?.serialNumber && (
                      <p className={errorClass}>{rowErrors.serialNumber.message}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setScannerTarget({ kind: "serial", rowIndex: index })}
                    className="shrink-0 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
                    title="Scan serial number"
                    aria-label={`Scan serial for asset ${index + 1}`}
                  >
                    Scan
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    disabled={fields.length <= 1}
                    className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                    title="Remove this row"
                    aria-label={`Remove asset ${index + 1}`}
                  >
                    {/* X icon */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Generic row-level error (rare — superRefine usually puts errors on a specific row) */}
          {errors.rows && !Array.isArray(errors.rows) && errors.rows.message && (
            <p className={errorClass}>{errors.rows.message}</p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={handleAddRow}
              disabled={fields.length >= MAX_ROWS}
              className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              data-tour="add-row-btn"
            >
              + Add another asset
            </button>
            {fields.length >= MAX_ROWS && (
              <span className="text-xs text-muted-foreground">
                Max {MAX_ROWS} per batch. Use Excel import for larger sets.
              </span>
            )}
          </div>
        </fieldset>

        {/* ── Submit error banner ───────────────────────────────────── */}
        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {submitError}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────── */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting
              ? "Creating..."
              : `Create ${fields.length} asset${fields.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </form>

      {/* Barcode scanner overlay (full-screen). Rendered outside the form so
          submitting from inside doesn't accidentally close the camera. */}
      {scannerTarget && (
        <BarcodeScanner
          onScan={(value) => void handleScanResult(value)}
          onClose={() => setScannerTarget(null)}
        />
      )}

      {/* New-product dialog (inline). Mounted alongside the scanner so EAN
          lookups that need a category pick can hand off cleanly. */}
      {newProductDialog.open && (
        <NewProductDialog
          initial={newProductDialog.initial}
          categories={categories}
          onCancel={() =>
            setNewProductDialog((s) => ({ ...s, open: false }))
          }
          onSubmit={handleCreateProduct}
        />
      )}
    </>
  );
}

// ── New product dialog ──────────────────────────────────────────────
// Small modal for adding a product the user couldn't find in the catalog.
// Returning a boolean from onSubmit lets the parent close-on-success or
// leave the dialog open on validation failure so the user can correct.
interface NewProductDialogProps {
  initial: { name: string; brand: string; model: string; eanCode: string };
  categories: AssetCategoryOption[];
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    categoryId: string;
    brand: string;
    model: string;
    eanCode: string;
  }) => Promise<boolean>;
}

function NewProductDialog({
  initial,
  categories,
  onCancel,
  onSubmit,
}: NewProductDialogProps) {
  const [name, setName] = useState(initial.name);
  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState(initial.brand);
  const [model, setModel] = useState(initial.model);
  const [eanCode, setEanCode] = useState(initial.eanCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!categoryId) {
      setError("Category is required.");
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit({ name, categoryId, brand, model, eanCode });
    setSubmitting(false);
    if (!ok) {
      // onSubmit already toasted; just keep the dialog open so the user can retry.
      setError("Save failed. See the toast for details.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-product-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="new-product-title" className="mb-1 text-lg font-semibold">
          New product
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Add this product to the catalog so you can link it to assets.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-name">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-cat">
              Category <span className="text-destructive">*</span>
            </label>
            <select
              id="np-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">-- Select category --</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {categories.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No categories available. Ask an admin to create one first.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="np-brand">
                Brand
              </label>
              <input
                id="np-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="np-model">
                Model
              </label>
              <input
                id="np-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-ean">
              EAN code
            </label>
            <input
              id="np-ean"
              value={eanCode}
              onChange={(e) => setEanCode(e.target.value)}
              placeholder="13-digit barcode"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create product"}
          </button>
        </div>
      </div>
    </div>
  );
}
