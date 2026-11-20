"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiGetPaginated, type PaginationMeta } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatBusinessDate, variantLabel } from "@/lib/sms/labels";
import { useShowroom } from "@/components/sms/showroom-context";
import { UnitStatusBadge, ExRtoBadge } from "@/components/sms/unit-status-badge";
import type { UnitListRow, VehicleModelRow, VehicleVariantRow } from "@/lib/sms/types";

type UnitView =
  | "physical"
  | "ready"
  | "booked"
  | "sold_pending_pickup"
  | "inspection"
  | "custody"
  | "identity_mismatch"
  | "outside"
  | "all";

const VIEWS: { value: UnitView; label: string }[] = [
  { value: "physical", label: "Physical" },
  { value: "ready", label: "Ready" },
  { value: "booked", label: "Booked" },
  { value: "sold_pending_pickup", label: "Sold · awaiting pickup" },
  { value: "inspection", label: "Inspection" },
  { value: "custody", label: "In custody" },
  { value: "identity_mismatch", label: "Identity mismatch" },
  { value: "outside", label: "Outside" },
  { value: "all", label: "All" },
];

function isValidView(v: string | null): v is UnitView {
  return v !== null && VIEWS.some((x) => x.value === v);
}

// ── Inner component (uses useSearchParams) ────────────────────────────

function UnitListInner() {
  const { showroom } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL state
  const urlView = searchParams.get("view");
  const urlVariantId = searchParams.get("variantId") ?? "";
  const urlModelId = searchParams.get("modelId") ?? "";
  const urlSearch = searchParams.get("search") ?? "";
  const urlPage = Number(searchParams.get("page") ?? "1");

  const [view, setView] = useState<UnitView>(isValidView(urlView) ? urlView : "physical");
  const [variantId, setVariantId] = useState(urlVariantId);
  const [modelId, setModelId] = useState(urlModelId);
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [search, setSearch] = useState(urlSearch);
  const [page, setPage] = useState(urlPage > 0 ? urlPage : 1);

  const [units, setUnits] = useState<UnitListRow[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter options
  const [models, setModels] = useState<VehicleModelRow[]>([]);
  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchInput === search) return;
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput, search]);

  // Load filter options once
  useEffect(() => {
    void (async () => {
      try {
        const [m, v] = await Promise.all([
          apiGet<VehicleModelRow[]>("/api/sms/master/vehicle-models"),
          apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants"),
        ]);
        setModels(m);
        setVariants(v);
      } catch {
        // filter dropdowns stay empty
      }
    })();
  }, []);

  // Sync URL
  const pushUrl = useCallback(
    (params: {
      view: UnitView;
      variantId: string;
      modelId: string;
      search: string;
      page: number;
      showroomId: string;
    }) => {
      const qs = new URLSearchParams();
      qs.set("view", params.view);
      if (params.variantId) qs.set("variantId", params.variantId);
      if (params.modelId) qs.set("modelId", params.modelId);
      if (params.search) qs.set("search", params.search);
      if (params.page > 1) qs.set("page", String(params.page));
      qs.set("showroomId", params.showroomId);
      router.replace(`?${qs.toString()}`, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (!showroom) return;
    pushUrl({ view, variantId, modelId, search, page, showroomId: showroom.id });
  }, [view, variantId, modelId, search, page, showroom, pushUrl]);

  // Fetch units
  const fetchUnits = useCallback(async () => {
    if (!showroom) return;
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        showroomId: showroom.id,
        view,
        page,
        limit: 20,
        sortBy: "vin",
        sortOrder: "asc",
      };
      if (search) params.search = search;
      if (variantId) params.variantId = variantId;
      if (modelId) params.modelId = modelId;
      const result = await apiGetPaginated<UnitListRow[]>("/api/sms/units", params);
      setUnits(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load units."));
    } finally {
      setLoading(false);
    }
  }, [showroom, view, page, search, variantId, modelId]);

  useEffect(() => {
    void fetchUnits();
  }, [fetchUnits]);

  if (!showroom) return null;

  const filteredVariantsForModel = modelId
    ? variants.filter((v) => v.modelId === modelId)
    : variants;

  const handleViewChange = (v: UnitView) => {
    setView(v);
    setPage(1);
  };

  const handleModelChange = (id: string) => {
    setModelId(id);
    setVariantId("");
    setPage(1);
  };

  return (
    <div className="p-4 md:p-6" data-tour="sms-unit-list">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Units — {showroom.name}</h1>
        {!loading && (
          <p className="mt-1 text-sm text-muted-foreground">{meta.total} unit{meta.total !== 1 ? "s" : ""}</p>
        )}
      </div>

      {/* View tabs — desktop */}
      <div className="mb-4 hidden overflow-x-auto md:block">
        <div className="flex gap-1 border-b">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => handleViewChange(v.value)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                view === v.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* View select — mobile */}
      <div className="mb-4 md:hidden">
        <select
          value={view}
          onChange={(e) => handleViewChange(e.target.value as UnitView)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {VIEWS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search VIN, engine number or plate"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="sms-unit-search"
        />
        <select
          value={modelId}
          onChange={(e) => handleModelChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {filteredVariantsForModel.length > 0 && (
          <select
            value={variantId}
            onChange={(e) => { setVariantId(e.target.value); setPage(1); }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">All variants</option>
            {filteredVariantsForModel.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.color}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : units.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No units match the current filters.
          </div>
        ) : (
          units.map((unit) => (
            <Link
              key={unit.id}
              href={`/admin/sms/units/${unit.id}`}
              className="block rounded-lg border bg-card p-3 hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-sm font-semibold tracking-tight">{unit.vin}</span>
                <UnitStatusBadge status={unit.status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{variantLabel(unit.variant)}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {unit.wasRto && <ExRtoBadge />}
                {unit.isOpeningBalance && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Opening balance</span>
                )}
                <span>{unit.physicalLocation?.name ?? "Not in a showroom"}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">VIN</th>
              <th className="px-4 py-3 text-left font-medium">Variant</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Location</th>
              <th className="px-4 py-3 text-left font-medium">Responsible</th>
              <th className="px-4 py-3 text-left font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : units.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No units match the current filters.
                </td>
              </tr>
            ) : (
              units.map((unit) => (
                <tr
                  key={unit.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                  onClick={() => router.push(`/admin/sms/units/${unit.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold tracking-tight">{unit.vin}</span>
                      {unit.wasRto && <ExRtoBadge />}
                      {unit.isOpeningBalance && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Opening balance</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{variantLabel(unit.variant)}</td>
                  <td className="px-4 py-3">
                    <UnitStatusBadge status={unit.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {unit.physicalLocation?.name ?? <span className="italic">Not in a showroom</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{unit.responsibleShowroom.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {unit.receivedAt ? formatBusinessDate(unit.receivedAt) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} ({meta.total} total)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page export with Suspense boundary ───────────────────────────────

export default function UnitsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 md:p-6">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="mb-4 h-10 w-full" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <UnitListInner />
    </Suspense>
  );
}
