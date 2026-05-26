"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { apiGet, apiGetPaginated, apiDelete } from "@/lib/api";
import api from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetCategories } from "@/hooks/use-reference-data";
import { useSavedViews } from "@/hooks/use-saved-views";
import type { AssetListItem, SavedView, AssetListViewConfig } from "@/types/admin";
import PrintDialog from "@/components/shared/print-dialog";
import SavedViewsMenu from "@/components/shared/saved-views-menu";
import LocationTreePicker from "@/components/shared/location-tree-picker";
import BulkActionsBar from "@/components/shared/bulk-actions-bar";
import ColumnsMenu from "@/components/shared/columns-menu";
import DensityToggle from "@/components/shared/density-toggle";
import ShortcutsCheatSheet from "@/components/shared/shortcuts-cheat-sheet";
import { useColumnVisibility } from "@/hooks/use-column-visibility";
import { useDensity, type Density } from "@/hooks/use-density";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

// ── Sort state shape ────────────────────────────────────────────────
// Whitelist must match the backend `AssetSortField` enum exactly. Anything
// outside the whitelist falls back to the server default (createdAt desc).
const SORTABLE_FIELDS = [
  "assetNumber",
  "name",
  "status",
  "purchaseDate",
  "purchasePrice",
  "createdAt",
] as const;
type SortField = (typeof SORTABLE_FIELDS)[number];
type SortOrder = "asc" | "desc";

function isSortField(v: string | null): v is SortField {
  return v !== null && (SORTABLE_FIELDS as readonly string[]).includes(v);
}

// ── Skeleton row used while the list is loading. Column count matches the
//    real table so the layout doesn't shift when data arrives.
// Skeleton row matches whatever column count the live table is rendering.
// Caller passes `extraCells` for the variable middle section so the
// number of placeholders tracks the user's column-visibility prefs.
function AssetRowSkeleton({ extraCells }: { extraCells: number }) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-4" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-32" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-44" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-5 w-16 rounded-full" />
      </td>
      {Array.from({ length: extraCells }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </td>
      ))}
      <td className="px-4 py-3">
        <Skeleton className="ml-auto h-4 w-16" />
      </td>
    </tr>
  );
}

// ── Sortable header cell ────────────────────────────────────────────
interface SortableHeaderProps {
  label: string;
  field: SortField;
  currentSort: SortField | null;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}

function SortableHeader({
  label,
  field,
  currentSort,
  currentOrder,
  onSort,
  align = "left",
}: SortableHeaderProps) {
  const isActive = currentSort === field;
  // Visual indicator: bullet for inactive, arrow for active.
  const indicator = isActive ? (currentOrder === "asc" ? "↑" : "↓") : "↕";
  // aria-sort belongs on the column header (<th>) per WAI-ARIA; placing it
  // on the inner button conflicts with the implicit role of <button>.
  return (
    <th
      className={cn(
        "px-4 py-3 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
      aria-sort={
        isActive ? (currentOrder === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className="text-xs opacity-60">{indicator}</span>
      </button>
    </th>
  );
}

// ── Status badge helpers ────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  IDLE: "bg-gray-100 text-gray-800",
  IN_MAINTENANCE: "bg-yellow-100 text-yellow-800",
  DISPOSED: "bg-red-100 text-red-800",
  LOST: "bg-red-100 text-red-800",
  BORROWED: "bg-blue-100 text-blue-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Density → table className map ───────────────────────────────────
// Tailwind arbitrary descendant selectors (`[&_td]:...`) reach every
// <td>/<th> inside the table without per-cell churn. The `!` (important)
// prefix is required because each cell already carries a static padding
// utility from the original layout; we want the table-level density
// override to win regardless of CSS declaration order.
function densityTableClasses(density: Density): string {
  if (density === "compact") {
    return [
      "text-xs",
      "[&_td]:!px-3 [&_td]:!py-1.5",
      "[&_th]:!px-3 [&_th]:!py-2",
    ].join(" ");
  }
  if (density === "spacious") {
    return [
      "text-base",
      "[&_td]:!px-4 [&_td]:!py-5",
      "[&_th]:!px-4 [&_th]:!py-4",
    ].join(" ");
  }
  // Default: matches the original hand-tuned layout.
  return "text-sm";
}

// ── Toggleable column config ────────────────────────────────────────
// Source of truth for which columns the user can hide/show, in display
// order. The picker menu iterates this same array. Defaults reflect the
// columns that were always-visible before column customisation — adding a
// new column with `default: false` is the canonical way to introduce an
// off-by-default column without breaking existing users' preferences.
const TOGGLEABLE_COLUMNS = [
  { key: "condition", label: "Condition", default: true },
  { key: "category", label: "Category", default: true },
  { key: "location", label: "Location", default: true },
  { key: "assignedTo", label: "Assigned To", default: true },
  { key: "po", label: "PO", default: true },
  { key: "purchasePrice", label: "Purchase Price", default: true },
  { key: "serialNumber", label: "Serial Number", default: false },
  { key: "brand", label: "Brand", default: false },
  { key: "purchaseDate", label: "Purchase Date", default: false },
  { key: "warrantyEndDate", label: "Warranty End", default: false },
  { key: "currentBookValue", label: "Book Value", default: false },
] as const;

type ToggleableColumnKey = (typeof TOGGLEABLE_COLUMNS)[number]["key"];

const DEFAULT_VISIBLE_COLUMNS: Record<ToggleableColumnKey, boolean> =
  TOGGLEABLE_COLUMNS.reduce(
    (acc, col) => {
      acc[col.key] = col.default;
      return acc;
    },
    {} as Record<ToggleableColumnKey, boolean>,
  );

// ── Currency formatter ──────────────────────────────────────────────
const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Indonesian short date — matches the form input format and is unambiguous
// to local users. Empty / unparseable values return the standard dash so
// the table grid stays aligned.
function formatLocalDate(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatIDR(value: string | null): string {
  if (!value) return "-";
  const num = Number(value);
  if (isNaN(num)) return "-";
  return idrFormatter.format(num);
}

// ── Page ────────────────────────────────────────────────────────────
export default function AssetsPage() {
  const canCreate = usePermission("assets:create");
  const canUpdate = usePermission("assets:update");
  const canDelete = usePermission("assets:delete");
  const canPrint = usePermission("assets:print");
  const canExport = usePermission("assets:export");
  const canImport = usePermission("assets:import");

  const router = useRouter();
  const searchParams = useSearchParams();

  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  // `searchInput` mirrors the textbox value (re-renders on every keystroke
  // for snappy typing). `search` is the debounced value actually sent to the
  // API — without this, every keystroke triggers a request which both wastes
  // server time and creates an out-of-order response race.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  // Phase 17 v2 — filter by parent PO. UUID from the PO list endpoint;
  // backend translates to `procurementBatch.purchaseOrderId = X`.
  const [poFilter, setPoFilter] = useState("");
  // Lazy-loaded PO options for the filter dropdown — top 100 most recent
  // (no-arg paginate). For very large fleets we'd swap to autocomplete,
  // but typing the PO number into the global Search box already works
  // (backend matches it via the OR clause in service.buildWhereClause).
  const [poOptions, setPoOptions] = useState<
    Array<{ id: string; poNumber: string; name: string | null }>
  >([]);
  const [page, setPage] = useState(1);

  // Reference data via TanStack Query — cached for the whole session via
  // the QueryProvider's 5-min staleTime, so list → detail → list no longer
  // re-fetches these. Locations themselves come in via the tree picker
  // which has its own (cached) endpoint, so we don't fetch them flat here.
  const { data: categories = [] } = useAssetCategories();
  // Saved views — shared cache with SavedViewsMenu (same query key) so the
  // dropdown reflects the same data we use for the default-view-apply
  // effect below.
  const { views: savedViews } = useSavedViews("assets");

  // Sort state — initialised from URL so a bookmarked link reproduces the
  // exact same view. Falls back to server default (createdAt desc) when the
  // URL has no `sort` param.
  const initialSort = useMemo<{ field: SortField | null; order: SortOrder }>(
    () => {
      const s = searchParams.get("sort");
      const o = searchParams.get("order");
      return {
        field: isSortField(s) ? s : null,
        order: o === "asc" ? "asc" : "desc",
      };
    },
    // Read once at mount; subsequent URL updates flow back via our own
    // handleSort handler so a circular effect is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [sortField, setSortField] = useState<SortField | null>(initialSort.field);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialSort.order);

  // Column visibility — see TOGGLEABLE_COLUMNS below for the menu order.
  // Stored per-device in localStorage (key carved out so different list
  // pages don't share). Structural columns (checkbox, asset #, name,
  // status, actions) are NOT in here — they're always visible.
  const { visible: visibleColumns, toggle: toggleColumn, reset: resetColumns } =
    useColumnVisibility("wedisense:columns:assets", DEFAULT_VISIBLE_COLUMNS);

  // Row density preference, per-device.
  const { density, setDensity } = useDensity("wedisense:density:assets");

  // ── Keyboard-navigation state ─────────────────────────────────────
  // `focusedRowIndex` is the row currently highlighted via j/k navigation
  // (null = no row, pointer-only browsing). The ref to the search input
  // lets the "/" shortcut focus it without prop-drilling. Cheat sheet
  // visibility is a separate concern from the shortcuts hook itself.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  // Selection state for bulk print
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);

  // Export state
  const [exportLoading, setExportLoading] = useState(false);
  const [exportBanner, setExportBanner] = useState<string | null>(null);

  // Saved view tracking. `activeViewId` is the id of the view currently
  // applied (so the menu can mark it active and "Save current" can detect
  // an unchanged view). Cleared on every manual filter/sort change so the
  // UI doesn't lie about which view is active after the user diverges.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  // One-shot flag: the page tries to apply the user's default view once,
  // on the first render, only when the URL is empty (so a shared link
  // always overrides a personal default).
  const [defaultViewApplied, setDefaultViewApplied] = useState(false);

  // Build the snapshot the saved-views menu persists on "Save current".
  // Empty fields aren't dropped — the absence of a key means "no override",
  // which differs from "explicitly empty" semantically.
  const currentViewConfig: AssetListViewConfig = useMemo(
    () => ({
      ...(search && { search }),
      ...(statusFilter && { statusFilter }),
      ...(locationFilter && { locationFilter }),
      ...(categoryFilter && { categoryFilter }),
      ...(sortField && { sortField, sortOrder }),
    }),
    [search, statusFilter, locationFilter, categoryFilter, sortField, sortOrder],
  );

  // Apply a view's config to the page state. Resets pagination so the
  // user lands on page 1 of the new view's results.
  const applyView = useCallback((view: SavedView) => {
    const cfg = view.config as AssetListViewConfig;
    setSearchInput(cfg.search ?? "");
    setSearch(cfg.search ?? "");
    setStatusFilter(cfg.statusFilter ?? "");
    setLocationFilter(cfg.locationFilter ?? "");
    setCategoryFilter(cfg.categoryFilter ?? "");
    setSortField(
      cfg.sortField && (SORTABLE_FIELDS as readonly string[]).includes(cfg.sortField)
        ? (cfg.sortField as SortField)
        : null,
    );
    setSortOrder(cfg.sortOrder ?? "desc");
    setPage(1);
    setActiveViewId(view.id);
  }, []);

  // Clear all filters → corresponds to "Default (no saved view)" in the menu.
  const clearActiveView = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setStatusFilter("");
    setLocationFilter("");
    setCategoryFilter("");
    setSortField(null);
    setSortOrder("desc");
    setPage(1);
    setActiveViewId(null);
  }, []);

  // (Esc clearing selection is now handled by the keyboard-shortcuts hook
  //  further down, alongside cheat-sheet dismissal and row-focus clearing.
  //  Kept here only as a marker so the old behaviour stays discoverable.)

  // One-shot: on first render after savedViews loads, if the user has a
  // default view AND the URL is empty, apply it. Shared links (which carry
  // sort/filter params) always win — we don't want a bookmark to land on
  // a different view than the link target.
  useEffect(() => {
    if (defaultViewApplied) return;
    if (savedViews.length === 0) return;
    const hasUrlParams = searchParams.toString().length > 0;
    if (hasUrlParams) {
      setDefaultViewApplied(true);
      return;
    }
    const def = savedViews.find((v) => v.isDefault);
    if (def) applyView(def);
    setDefaultViewApplied(true);
  }, [savedViews, defaultViewApplied, searchParams, applyView]);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 10 };
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (locationFilter) params.locationId = locationFilter;
      if (categoryFilter) params.categoryId = categoryFilter;
      if (poFilter) params.purchaseOrderId = poFilter;
      if (sortField) {
        params.sort = sortField;
        params.order = sortOrder;
      }

      const result = await apiGetPaginated<AssetListItem[]>(
        "/api/assets",
        params,
      );
      setAssets(result.data);
      setMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, locationFilter, categoryFilter, poFilter, sortField, sortOrder]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // Fetch PO options for the filter dropdown — one-shot on mount.
  // No need to re-fetch when filters change; the PO list is small and
  // stable enough that staleness here doesn't bite.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet<
          Array<{ id: string; poNumber: string; name: string | null }>
        >("/api/purchase-orders", { limit: 100 });
        if (!cancelled) setPoOptions(rows);
      } catch {
        /* dropdown stays empty; user can still search by PO number */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce search keystrokes → committed `search` state. 300ms is the
  // sweet spot per NN/G — fast enough that the result feels live, slow
  // enough to skip most intermediate states while typing.
  useEffect(() => {
    if (searchInput === search) return;
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, search]);

  // Push sort + filter state into URL search params so the view is
  // bookmarkable / shareable. We only mirror sort (the hottest piece of
  // shared context); filters are intentionally not in the URL to avoid
  // overwhelming param noise. This can be extended in Tier 4 (saved views).
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (sortField) {
      next.set("sort", sortField);
      next.set("order", sortOrder);
    } else {
      next.delete("sort");
      next.delete("order");
    }
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortField, sortOrder]);

  // Reset to page 1 when filters change
  // Any manual change to filter/sort diverges from the saved view, so we
  // drop `activeViewId`. The view itself isn't deleted — the user can
  // re-apply it via the menu, or update it via "Save current as new view".
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    setActiveViewId(null);
  };
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
    setActiveViewId(null);
  };
  const handleLocationChange = (value: string) => {
    setLocationFilter(value);
    setPage(1);
    setActiveViewId(null);
  };
  const handleCategoryChange = (value: string) => {
    setCategoryFilter(value);
    setPage(1);
    setActiveViewId(null);
  };
  const handlePoChange = (value: string) => {
    setPoFilter(value);
    setPage(1);
    setActiveViewId(null);
  };

  // Sort toggle: clicking the active column flips order; clicking a fresh
  // column resets order to desc (most useful default for amounts/dates).
  const handleSort = (field: SortField) => {
    setPage(1);
    setActiveViewId(null);
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this asset?")) return;
    try {
      await apiDelete(`/api/assets/${id}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success("Asset deleted.");
      void fetchAssets();
    } catch (err: unknown) {
      // Surface the failure — silent swallow previously made deletes
      // look successful even when the API rejected them.
      toast.error(
        getApiErrorMessage(err, "Failed to delete asset. Please try again."),
      );
    }
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)));
    }
  };

  const allSelected = assets.length > 0 && selectedIds.size === assets.length;

  // ── Keyboard shortcuts wiring ─────────────────────────────────────
  // The cheat sheet itself is rendered below — when it's open we disable
  // shortcuts so the user can read the list without their keystrokes
  // re-triggering actions. Esc closes the sheet via the modal's own
  // click-outside / X button (also handled here for completeness).
  useKeyboardShortcuts(
    [
      {
        key: "/",
        preventDefault: true,
        run: () => searchInputRef.current?.focus(),
      },
      {
        key: "n",
        run: () => {
          if (canCreate) router.push("/admin/assets/new");
        },
      },
      {
        key: "j",
        run: () => {
          if (assets.length === 0) return;
          setFocusedRowIndex((prev) => {
            const next = prev === null ? 0 : Math.min(prev + 1, assets.length - 1);
            return next;
          });
        },
      },
      {
        key: "k",
        run: () => {
          if (assets.length === 0) return;
          setFocusedRowIndex((prev) => {
            const next = prev === null ? 0 : Math.max(prev - 1, 0);
            return next;
          });
        },
      },
      {
        key: "Enter",
        run: () => {
          if (focusedRowIndex === null) return;
          const asset = assets[focusedRowIndex];
          if (asset) router.push(`/admin/assets/${asset.id}`);
        },
      },
      {
        key: "?",
        preventDefault: true,
        run: () => setCheatSheetOpen(true),
      },
      {
        key: "Escape",
        run: () => {
          // Cascade by priority: dismiss modal first, then row focus, then
          // multi-select. Only one of these clears per Esc press so a user
          // who built up state can unwind it stepwise instead of losing
          // everything in one press.
          if (cheatSheetOpen) {
            setCheatSheetOpen(false);
          } else if (focusedRowIndex !== null) {
            setFocusedRowIndex(null);
          } else if (selectedIds.size > 0) {
            setSelectedIds(new Set());
          }
        },
      },
    ],
    !cheatSheetOpen,
  );

  // Scroll the j/k-focused row into view when it changes. The `nearest`
  // block keeps the row visible without yanking the page on every step,
  // which would be disorienting for fast j/j/j sequences.
  useEffect(() => {
    if (focusedRowIndex === null) return;
    const row = tableRef.current?.querySelectorAll("tbody tr")[focusedRowIndex];
    row?.scrollIntoView({ block: "nearest" });
  }, [focusedRowIndex]);

  // Reset row focus whenever the underlying list changes — otherwise a
  // previously-focused index might now point to a different asset.
  useEffect(() => {
    setFocusedRowIndex(null);
  }, [assets]);

  const handleExport = async () => {
    setExportLoading(true);
    setExportBanner(null);
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (locationFilter) params.locationId = locationFilter;
      if (categoryFilter) params.categoryId = categoryFilter;

      const queryString = new URLSearchParams(params).toString();
      const url = `/api/assets/export${queryString ? `?${queryString}` : ""}`;

      const response = await api.get<Blob>(url, { responseType: "blob" });

      // Backend can return EITHER the xlsx file OR a JSON envelope
      // { success, data: { mode: 'async', reportId, ... } } for large exports.
      // We sniff Content-Type to discriminate.
      const contentType = response.headers["content-type"] as string | undefined;
      if (contentType && contentType.includes("application/json")) {
        const text = await response.data.text();
        const json = JSON.parse(text) as {
          data?: { mode?: string; reportId?: string; message?: string };
        };
        if (json.data?.mode === "async") {
          setExportBanner(
            json.data.message ??
              "Export queued — you'll be notified when the report is ready.",
          );
          return;
        }
        // Unexpected JSON — surface as error
        setExportBanner("Unexpected response from server. Please try again.");
        return;
      }

      // Blob download
      const blobUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = blobUrl;
      anchor.download = `wedisense-assets-${date}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setExportBanner(getApiErrorMessage(err, "Export failed. Please try again."));
    } finally {
      setExportLoading(false);
    }
  };

  const statusOptions = useMemo(
    () => ["ACTIVE", "IDLE", "IN_MAINTENANCE", "DISPOSED", "LOST", "BORROWED"],
    [],
  );

  return (
    <div className="p-4 md:p-6" data-tour="asset-list">
      {/* Header — stacks on mobile so the title + Export/Add buttons don't
          overflow the row. */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Assets</h1>
        <div className="-mx-1 flex flex-wrap items-center gap-2 sm:mx-0">
          {/* "Print Labels (N)" used to live here, but the sticky
              BulkActionsBar at the bottom now handles every selection-
              dependent action (move/assign/condition/print/delete). Keep
              the header clean for top-level actions. */}
          {canExport && (
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exportLoading}
              data-tour="export-assets-btn"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {exportLoading ? "Exporting..." : "Export Excel"}
            </button>
          )}
          {canCreate && (
            <Link
              href="/admin/assets/new"
              data-tour="add-asset-btn"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add Asset
            </Link>
          )}
        </div>
      </div>

      {/* Export async banner */}
      {exportBanner && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span>{exportBanner}</span>
          <button
            type="button"
            onClick={() => setExportBanner(null)}
            className="ml-4 text-blue-600 hover:text-blue-800"
          >
            &times;
          </button>
        </div>
      )}

      {/* Import link */}
      {canImport && (
        <div className="mb-4 flex items-center gap-2">
          <Link
            href="/admin/assets/import"
            data-tour="import-assets-btn"
            className="text-sm text-primary hover:underline"
          >
            Import from Excel
          </Link>
        </div>
      )}

      {/* Filters bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SavedViewsMenu
          resource="assets"
          activeViewId={activeViewId}
          currentConfig={currentViewConfig as unknown as Record<string, unknown>}
          onApply={applyView}
          onClear={clearActiveView}
        />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search by name, asset #, or serial... (/)"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="asset-search"
        />
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="status-filter"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <LocationTreePicker
          value={locationFilter || null}
          onChange={(id) => handleLocationChange(id ?? "")}
          placeholder="All Locations"
        />
        <select
          value={categoryFilter}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="category-filter"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={poFilter}
          onChange={(e) => handlePoChange(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="po-filter"
          title="Filter by Purchase Order"
        >
          <option value="">All POs</option>
          {poOptions.map((po) => (
            <option key={po.id} value={po.id}>
              {po.poNumber}
              {po.name ? ` — ${po.name}` : ""}
            </option>
          ))}
        </select>

        {/* Density + Columns controls only affect the desktop table layout,
            so they're hidden on mobile (which uses cards). `ml-auto` pushes
            them to the right edge of the filter row on md+ screens. */}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <DensityToggle value={density} onChange={setDensity} />
          <ColumnsMenu
            columns={TOGGLEABLE_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visible={visibleColumns}
            onToggle={(k) => toggleColumn(k as ToggleableColumnKey)}
            onReset={resetColumns}
          />
        </div>
      </div>

      {/* Selection count + clear action used to live here inline; the sticky
          BulkActionsBar at the bottom now owns that affordance plus the
          per-action triggers, so this block is gone to avoid duplication. */}

      {/* Mobile card list — only shown below md (768px). Same data + same
          selection state as the desktop table, just rendered as cards so
          thumb-scrolling beats horizontal-scrolling on small screens. */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-4"
            >
              <Skeleton className="mb-2 h-4 w-32" />
              <Skeleton className="mb-1 h-5 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))
        ) : assets.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No assets found.
          </div>
        ) : (
          assets.map((asset) => {
            const selected = selectedIds.has(asset.id);
            return (
              <div
                key={asset.id}
                className={cn(
                  "rounded-lg border bg-card p-3",
                  selected && "border-primary bg-primary/5",
                )}
              >
                <div className="mb-2 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(asset.id)}
                    className="mt-1 h-4 w-4 rounded border-gray-300"
                    aria-label={`Select ${asset.assetNumber}`}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/assets/${asset.id}`}
                      className="block text-xs font-mono text-primary hover:underline"
                    >
                      {asset.assetNumber}
                    </Link>
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {asset.name}
                    </p>
                  </div>
                  <StatusBadge status={asset.status} />
                </div>

                {/* Detail rows — only the fields that matter at-a-glance on
                    mobile. Hidden when empty so the card stays compact. */}
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Location</dt>
                    <dd className="truncate text-right">{asset.location.name}</dd>
                  </div>
                  {asset.product?.category?.name && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Category</dt>
                      <dd className="truncate text-right">{asset.product.category.name}</dd>
                    </div>
                  )}
                  {asset.assignedTo && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Assigned to</dt>
                      <dd className="truncate text-right">{asset.assignedTo.name}</dd>
                    </div>
                  )}
                  {asset.purchasePrice && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Price</dt>
                      <dd className="text-right">{formatIDR(asset.purchasePrice)}</dd>
                    </div>
                  )}
                </dl>

                {/* Inline actions row. Edit + Delete live here rather than
                    relying on the sticky bar so a single-asset action
                    doesn't require the user to select-then-act. */}
                <div className="mt-3 flex items-center gap-1 border-t pt-2">
                  <Link
                    href={`/admin/assets/${asset.id}`}
                    className="rounded px-2 py-1 text-xs text-primary hover:bg-accent"
                  >
                    View
                  </Link>
                  {canUpdate && (
                    <Link
                      href={`/admin/assets/${asset.id}/edit`}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Edit
                    </Link>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(asset.id)}
                      className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table — md+ only. Wrapper enables horizontal scroll for
          when 10+ columns are visible at once. The density classes
          propagate into every td/th via Tailwind's arbitrary descendant
          selector. */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table
          ref={tableRef}
          className={cn(
            "w-full min-w-[720px]",
            densityTableClasses(density),
          )}
        >
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300"
                  aria-label="Select all on this page"
                />
              </th>
              <SortableHeader
                label="Asset #"
                field="assetNumber"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHeader
                label="Name"
                field="name"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHeader
                label="Status"
                field="status"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              {visibleColumns.condition && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Condition
                </th>
              )}
              {visibleColumns.category && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Category
                </th>
              )}
              {visibleColumns.location && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Location
                </th>
              )}
              {visibleColumns.assignedTo && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Assigned To
                </th>
              )}
              {visibleColumns.po && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  PO
                </th>
              )}
              {visibleColumns.serialNumber && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Serial #
                </th>
              )}
              {visibleColumns.brand && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Brand
                </th>
              )}
              {visibleColumns.purchaseDate && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Purchase Date
                </th>
              )}
              {visibleColumns.warrantyEndDate && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Warranty End
                </th>
              )}
              {visibleColumns.purchasePrice && (
                <SortableHeader
                  label="Purchase Price"
                  field="purchasePrice"
                  currentSort={sortField}
                  currentOrder={sortOrder}
                  onSort={handleSort}
                  align="right"
                />
              )}
              {visibleColumns.currentBookValue && (
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Book Value
                </th>
              )}
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <AssetRowSkeleton
                    key={i}
                    extraCells={
                      (Object.values(visibleColumns) as boolean[]).filter(Boolean)
                        .length
                    }
                  />
                ))}
              </>
            ) : assets.length === 0 ? (
              <tr>
                {/* 5 structural columns (checkbox, asset#, name, status,
                    actions) plus however many toggleable columns are
                    currently visible. */}
                <td
                  colSpan={
                    5 +
                    (Object.values(visibleColumns) as boolean[]).filter(Boolean).length
                  }
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No assets found.
                </td>
              </tr>
            ) : (
              assets.map((asset, idx) => (
                <tr
                  key={asset.id}
                  className={cn(
                    "border-b last:border-b-0",
                    selectedIds.has(asset.id) && "bg-primary/5",
                    // Visual ring for the row currently focused via j/k.
                    // Inset shadow rather than outline keeps the row's
                    // height stable across selection states.
                    focusedRowIndex === idx &&
                      "shadow-[inset_0_0_0_2px_hsl(var(--primary))]",
                  )}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(asset.id)}
                      onChange={() => toggleSelect(asset.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/assets/${asset.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {asset.assetNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium">{asset.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={asset.status} />
                  </td>
                  {visibleColumns.condition && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.condition}
                    </td>
                  )}
                  {visibleColumns.category && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.product?.category?.name ?? "-"}
                    </td>
                  )}
                  {visibleColumns.location && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.location.name}
                    </td>
                  )}
                  {visibleColumns.assignedTo && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.assignedTo?.name ?? "-"}
                    </td>
                  )}
                  {visibleColumns.po && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.procurementBatch ? (
                        <Link
                          href={`/admin/purchase-orders/${asset.procurementBatch.purchaseOrder.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {asset.procurementBatch.purchaseOrder.poNumber}
                        </Link>
                      ) : (
                        <span className="text-xs">-</span>
                      )}
                    </td>
                  )}
                  {visibleColumns.serialNumber && (
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {asset.serialNumber ?? "-"}
                    </td>
                  )}
                  {visibleColumns.brand && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.product?.brand ?? "-"}
                    </td>
                  )}
                  {visibleColumns.purchaseDate && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatLocalDate(asset.purchaseDate)}
                    </td>
                  )}
                  {visibleColumns.warrantyEndDate && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatLocalDate(asset.warrantyEndDate)}
                    </td>
                  )}
                  {visibleColumns.purchasePrice && (
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatIDR(asset.purchasePrice)}
                    </td>
                  )}
                  {visibleColumns.currentBookValue && (
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatIDR(asset.currentBookValue)}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    {canUpdate && (
                      <Link
                        href={`/admin/assets/${asset.id}/edit`}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Edit
                      </Link>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(asset.id)}
                        className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                      >
                        Delete
                      </button>
                    )}
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
          <p className="text-muted-foreground">
            Showing page {meta.page} of {meta.totalPages} ({meta.total} total
            assets)
          </p>
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

      {/* Print Dialog */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => {
          setPrintDialogOpen(false);
          setSelectedIds(new Set());
        }}
        assetIds={Array.from(selectedIds)}
      />

      {/* Sticky bulk-actions bar. Renders nothing when selection is empty,
          so we always mount it — toggling visibility via component-internal
          early-return keeps animation hooks (future) intact. */}
      <BulkActionsBar
        selectedIds={Array.from(selectedIds)}
        onClearSelection={() => setSelectedIds(new Set())}
        onMutated={() => void fetchAssets()}
        onPrint={() => setPrintDialogOpen(true)}
        canUpdate={canUpdate}
        canDelete={canDelete}
        canPrint={canPrint}
      />

      {/* Discoverability: a permanent tiny "?" floating in the corner.
          Cheap insurance that users find the shortcuts at all — pressing
          "?" alone won't help if they don't know the shortcut exists. */}
      <button
        type="button"
        onClick={() => setCheatSheetOpen(true)}
        title="Keyboard shortcuts (?)"
        aria-label="Show keyboard shortcuts"
        className="fixed bottom-4 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border bg-card text-sm font-medium text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
      >
        ?
      </button>

      <ShortcutsCheatSheet
        open={cheatSheetOpen}
        onClose={() => setCheatSheetOpen(false)}
        shortcuts={[
          { keys: ["/"], description: "Focus search" },
          { keys: ["n"], description: "Add new asset" },
          { keys: ["j"], description: "Next row" },
          { keys: ["k"], description: "Previous row" },
          { keys: ["Enter"], description: "Open focused row" },
          { keys: ["Esc"], description: "Clear focus / selection" },
          { keys: ["?"], description: "Show this cheat sheet" },
        ]}
      />
    </div>
  );
}
