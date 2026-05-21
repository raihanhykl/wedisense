"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Edit2,
  MapPin,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { apiGet, apiGetPaginated, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import LocationFormDialog from "@/components/shared/location-form-dialog";
import LocationArchiveDialog from "@/components/shared/location-archive-dialog";
import { getLocationTypeLabel } from "@/lib/location-types";
import { useLocationTree } from "@/hooks/use-reference-data";
import type { LocationFlat, LocationNode } from "@/types/admin";

// ── Types ────────────────────────────────────────────────────────────

interface AssetSummaryByStatus {
  direct: number;
  subtree: number;
}

interface AssetSummary {
  locationId: string;
  direct: { total: number; byStatus: Record<string, AssetSummaryByStatus> };
  subtree: { total: number; byStatus: Record<string, AssetSummaryByStatus> };
}

interface Ancestor {
  id: string;
  name: string;
  code: string;
  type: string;
  parent_id: string | null;
  is_active: boolean;
  depth: number;
}

interface AssetRow {
  id: string;
  name: string;
  assetNumber: string;
  status: string;
  condition: string;
  location: { id: string; name: string; code: string } | null;
}

interface MovementRow {
  id: string;
  movementType: string;
  status: string;
  referenceNumber: string;
  notes: string | null;
  createdAt: string;
  asset: { id: string; name: string; assetNumber: string };
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  fromLocation: { id: string; name: string; code: string } | null;
  toLocation: { id: string; name: string; code: string } | null;
  performedBy: { id: string; name: string } | null;
}

// ── Status badge palette (mirrors dashboard/status-donut) ────────────

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#10b981",
  IDLE: "#60a5fa",
  IN_MAINTENANCE: "#f59e0b",
  BORROWED: "#6366f1",
  DISPOSED: "#9ca3af",
  LOST: "#ef4444",
};
const DEFAULT_COLOR = "#cbd5e1";

const STATUS_BADGE_CLASS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  IDLE: "bg-blue-100 text-blue-800",
  IN_MAINTENANCE: "bg-yellow-100 text-yellow-800",
  BORROWED: "bg-indigo-100 text-indigo-800",
  DISPOSED: "bg-gray-100 text-gray-800",
  LOST: "bg-red-100 text-red-800",
};

function humaniseStatus(s: string): string {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w|\s\w/g, (c) => c.toUpperCase());
}

// ── Helpers ──────────────────────────────────────────────────────────

// Walk the global tree to extract the subtree rooted at the given id.
// Returns null if the id isn't present (e.g. soft-deleted).
function findSubtree(nodes: LocationNode[], id: string): LocationNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findSubtree(n.children, id);
    if (found !== null) return found;
  }
  return null;
}

// ── Tab definition ───────────────────────────────────────────────────

type TabKey = "overview" | "assets" | "sublocations" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "assets", label: "Assets" },
  { key: "sublocations", label: "Sub-locations" },
  { key: "activity", label: "Activity" },
];

// ── Page ─────────────────────────────────────────────────────────────

export default function LocationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tab is URL-backed so deep-links and back-button work. Falls back to
  // "overview" when the param is absent or unknown.
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = TABS.some((t) => t.key === tabParam)
    ? (tabParam as TabKey)
    : "overview";

  const [location, setLocation] = useState<LocationFlat | null>(null);
  const [ancestors, setAncestors] = useState<Ancestor[]>([]);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  // We also pull the global tree so the Sub-locations tab can render the
  // subtree rooted here without a second endpoint. Cached via TanStack
  // Query so the read is cheap if the user came from the list page.
  const { data: tree = [] } = useLocationTree();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loc, ancRaw, summ] = await Promise.all([
        apiGet<LocationFlat>(`/api/locations/${id}`),
        apiGet<Ancestor[]>(`/api/locations/${id}/ancestors`),
        apiGet<AssetSummary>(`/api/locations/${id}/asset-summary`),
      ]);
      setLocation(loc);
      // Ancestors come root-first from the API. The current node is included
      // (depth 0) — drop it from the breadcrumb to avoid duplicating the
      // header title.
      setAncestors(ancRaw.filter((a) => a.id !== id));
      setSummary(summ);
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to load location"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const subtree = useMemo(() => findSubtree(tree, id), [tree, id]);

  const setTab = (key: TabKey) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (key === "overview") sp.delete("tab");
    else sp.set("tab", key);
    router.replace(`?${sp.toString()}`, { scroll: false });
  };

  const handleReactivate = async () => {
    if (!location) return;
    setReactivating(true);
    try {
      const updated = await apiPost<LocationFlat>(
        `/api/locations/${id}/reactivate`,
        {},
      );
      setLocation(updated);
      toast.success("Location reactivated");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Reactivate failed"));
    } finally {
      setReactivating(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (error || !location) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error ?? "Location not found"}
        </p>
        <Link
          href="/admin/locations"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to locations
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      {/* Breadcrumb. Last segment (current location) is rendered as the
          page title below, so we stop the trail at the parent. */}
      <nav
        aria-label="Breadcrumb"
        className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/admin/locations" className="hover:text-foreground">
          Locations
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/admin/locations/${a.id}`}
              className="hover:text-foreground"
            >
              {a.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Header */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-2xl font-bold tracking-tight">
              {location.name}
            </h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
              {location.code}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
              {getLocationTypeLabel(location.type)}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                location.isActive
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800",
              )}
            >
              {location.isActive ? "Active" : "Archived"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Edit2 className="h-3.5 w-3.5" /> Edit
          </button>
          {location.isActive ? (
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-destructive/10 hover:text-destructive"
            >
              <PowerOff className="h-3.5 w-3.5" />
              Archive
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReactivate}
              disabled={reactivating}
              className="inline-flex items-center gap-1.5 rounded-md border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Power className="h-3.5 w-3.5" />
              {reactivating ? "Reactivating…" : "Reactivate"}
            </button>
          )}
        </div>
      </header>

      {/* Tab nav */}
      <div className="mb-4 border-b">
        <nav className="flex gap-1 overflow-x-auto" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                activeTab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.key === "assets" && summary && summary.subtree.total > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                  {summary.subtree.total}
                </span>
              )}
              {t.key === "sublocations" && subtree && subtree.children.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                  {subtree.children.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          location={location}
          summary={summary}
          subtree={subtree}
          onLocationChange={setLocation}
        />
      )}
      {activeTab === "assets" && <AssetsTab locationId={id} />}
      {activeTab === "sublocations" && <SubLocationsTab subtree={subtree} />}
      {activeTab === "activity" && <ActivityTab locationId={id} />}

      {/* Edit dialog reuses the existing form. */}
      <LocationFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editingLocation={location}
        onSuccess={() => {
          setEditOpen(false);
          void fetchAll();
        }}
      />

      {/* Archive flow — handles both 'no assets' and 'must migrate first'. */}
      <LocationArchiveDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        location={location}
        onArchived={() => void fetchAll()}
      />
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="p-4 md:p-6">
      <Skeleton className="mb-3 h-4 w-48" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <Skeleton className="mb-4 h-9 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({
  location,
  summary,
  subtree,
  onLocationChange,
}: {
  location: LocationFlat;
  summary: AssetSummary | null;
  subtree: LocationNode | null;
  onLocationChange: (loc: LocationFlat) => void;
}) {
  // Donut data. Filter to non-zero subtree slices so the donut isn't padded
  // with empty status segments. Sort by count descending so the largest
  // slice anchors the chart's top.
  const donutData = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.subtree.byStatus)
      .map(([status, counts]) => ({ status, count: counts.subtree }))
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [summary]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Info card */}
      <section className="rounded-lg border bg-card p-4 md:p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Location info
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Address</dt>
          <dd>{location.address || "—"}</dd>
          <dt className="text-muted-foreground">City</dt>
          <dd>{location.city || "—"}</dd>
          <dt className="text-muted-foreground">Province</dt>
          <dd>{location.province || "—"}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{getLocationTypeLabel(location.type)}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{location.isActive ? "Active" : "Archived"}</dd>
          {(location.contactPhone || location.contactEmail) && (
            <>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="space-y-0.5">
                {location.contactPhone && (
                  <div>
                    <a
                      href={`tel:${location.contactPhone}`}
                      className="hover:text-primary hover:underline"
                    >
                      {location.contactPhone}
                    </a>
                  </div>
                )}
                {location.contactEmail && (
                  <div>
                    <a
                      href={`mailto:${location.contactEmail}`}
                      className="hover:text-primary hover:underline"
                    >
                      {location.contactEmail}
                    </a>
                  </div>
                )}
              </dd>
            </>
          )}
          {location.latitude !== null && location.longitude !== null && (
            <>
              <dt className="text-muted-foreground">Coordinates</dt>
              <dd>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=18/${location.latitude}/${location.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary hover:underline"
                >
                  {location.latitude}, {location.longitude} ↗
                </a>
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Asset donut */}
      <section className="rounded-lg border bg-card p-4 md:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assets by status (subtree)
          </h2>
          {summary && (
            <span className="text-xs text-muted-foreground">
              {summary.subtree.total} total
              {summary.direct.total !== summary.subtree.total && (
                <> · {summary.direct.total} direct</>
              )}
            </span>
          )}
        </div>
        {!summary || donutData.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">
            No assets at this location yet.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="count"
                nameKey="status"
              >
                {donutData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={STATUS_COLORS[entry.status] ?? DEFAULT_COLOR}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(v: number, n: string) => [v, humaniseStatus(n)]} />
              <Legend formatter={(v: string) => humaniseStatus(v)} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* QR code card. Full row so the image renders large enough to scan
          from a desktop screen without zooming. */}
      <section className="rounded-lg border bg-card p-4 md:col-span-2 md:p-5">
        <QrCodeCard
          location={location}
          onLocationChange={onLocationChange}
        />
      </section>

      {/* Sub-locations quick preview */}
      <section className="rounded-lg border bg-card p-4 md:p-5 md:col-span-2">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sub-locations
          </h2>
          {subtree && subtree.children.length > 5 && (
            <Link
              href={`/admin/locations/${location.id}?tab=sublocations`}
              className="text-xs text-primary hover:underline"
            >
              View all {subtree.children.length}
            </Link>
          )}
        </div>
        {!subtree || subtree.children.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No sub-locations under this location.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {subtree.children.slice(0, 6).map((child) => (
              <li key={child.id}>
                <Link
                  href={`/admin/locations/${child.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{child.name}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({child.code})
                    </span>
                  </span>
                  {child.subtreeAssetCount > 0 && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {child.subtreeAssetCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Assets tab ───────────────────────────────────────────────────────

function AssetsTab({ locationId }: { locationId: string }) {
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGetPaginated<AssetRow[]>(`/api/assets`, { locationId, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data);
        setTotal(res.meta.total);
      })
      .catch((e) => {
        if (!cancelled) setError(getApiErrorMessage(e, "Failed to load assets"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No assets at this location subtree yet.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        Showing {rows.length} of {total} assets in this location subtree
      </div>
      <ul role="list">
        {rows.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent/30"
          >
            <Link
              href={`/admin/assets/${a.id}`}
              className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary"
            >
              {a.name}
            </Link>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {a.assetNumber}
            </span>
            {a.location && (
              <span className="hidden text-xs text-muted-foreground md:inline">
                {a.location.name}
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                STATUS_BADGE_CLASS[a.status] ?? "bg-gray-100 text-gray-800",
              )}
            >
              {humaniseStatus(a.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Sub-locations tab ────────────────────────────────────────────────

function SubLocationsTab({ subtree }: { subtree: LocationNode | null }) {
  if (!subtree) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Location data unavailable.
      </p>
    );
  }
  if (subtree.children.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No sub-locations under this location.
      </p>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-2">
      <ul role="tree">
        {subtree.children.map((child) => (
          <SubLocationRow key={child.id} node={child} depth={0} />
        ))}
      </ul>
    </div>
  );
}

// ── QR code card ─────────────────────────────────────────────────────

function QrCodeCard({
  location,
  onLocationChange,
}: {
  location: LocationFlat;
  onLocationChange: (loc: LocationFlat) => void;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // The QR encodes the location's detail-page URL — useful as a sanity
  // check so the admin can read where a scan will land before printing.
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
  const qrSrc = location.qrCodeImageUrl
    ? `${apiBase}${location.qrCodeImageUrl}`
    : null;

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const updated = await apiPost<LocationFlat>(
        `/api/locations/${location.id}/qrcode/regenerate`,
        {},
      );
      onLocationChange(updated);
      toast.success("QR code regenerated");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Regenerate failed"));
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!qrSrc) return;
    setDownloading(true);
    try {
      // Same auth-bearing fetch pattern the Import page uses — protected
      // static files need the Authorization header that a plain anchor
      // can't provide.
      const { useAuthStore } = await import("@/stores/auth.store");
      const accessToken = useAuthStore.getState().accessToken ?? "";
      const res = await fetch(qrSrc, {
        credentials: "include",
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Slug the location code so the file is identifiable in the user's
      // downloads folder without opening it.
      a.download = `location-${location.code}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Download failed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <div className="shrink-0">
        {qrSrc ? (
          <img
            src={qrSrc}
            alt={`QR code for ${location.name}`}
            className="h-40 w-40 rounded-md border bg-white p-2"
          />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center rounded-md border border-dashed text-muted-foreground">
            <QrCode className="h-8 w-8" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            QR code
          </h2>
          <p className="mt-1 text-sm">
            {qrSrc
              ? "Scan this code on a phone camera to jump straight to this location's detail page. Print and stick on-site for quick mobile audits."
              : "QR code not yet generated. Click Regenerate to create one."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!qrSrc || downloading}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Downloading…" : "Download PNG"}
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", regenerating && "animate-spin")}
            />
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Activity tab ─────────────────────────────────────────────────────

function ActivityTab({ locationId }: { locationId: string }) {
  const [rows, setRows] = useState<MovementRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGetPaginated<MovementRow[]>(`/api/movements`, {
      locationId,
      limit: 50,
      sort: "createdAt",
      order: "desc",
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data);
        setTotal(res.meta.total);
      })
      .catch((e) => {
        if (!cancelled) setError(getApiErrorMessage(e, "Failed to load activity"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!rows || rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No activity involving this location yet.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        Showing {rows.length} of {total} movements involving this location
      </div>
      <ul role="list">
        {rows.map((m) => (
          <li key={m.id} className="border-b px-4 py-3 last:border-b-0 hover:bg-accent/30">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {m.movementType.replace(/_/g, " ")}
              </span>
              <Link
                href={`/admin/assets/${m.asset.id}`}
                className="text-sm font-medium hover:text-primary"
              >
                {m.asset.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {m.asset.assetNumber}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(m.createdAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {m.fromLocation && (
                <Link
                  href={`/admin/locations/${m.fromLocation.id}`}
                  className="hover:text-primary"
                >
                  {m.fromLocation.name}
                </Link>
              )}
              {m.fromLocation && m.toLocation && (
                <ChevronRight className="h-3 w-3" />
              )}
              {m.toLocation && (
                <Link
                  href={`/admin/locations/${m.toLocation.id}`}
                  className="hover:text-primary"
                >
                  {m.toLocation.name}
                </Link>
              )}
              {m.performedBy && (
                <span className="ml-2">
                  · by{" "}
                  <span className="font-medium text-foreground">
                    {m.performedBy.name}
                  </span>
                </span>
              )}
              <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium">
                {m.referenceNumber}
              </span>
            </div>
            {m.notes && (
              <p className="mt-1 text-xs italic text-muted-foreground">
                “{m.notes}”
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubLocationRow({ node, depth }: { node: LocationNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && setExpanded(!expanded)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground",
            !hasChildren && "invisible",
          )}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <Link
          href={`/admin/locations/${node.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary"
        >
          {node.name}
        </Link>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {getLocationTypeLabel(node.type)}
        </span>
        {node.subtreeAssetCount > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {node.subtreeAssetCount}
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => (
            <SubLocationRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
