"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart2, Boxes, TrendingUp, AlertTriangle } from "lucide-react";
import ProtectedRoute from "@/components/shared/protected-route";
import AppSidebar from "@/components/shared/app-sidebar";
import NotificationBell from "@/components/shared/notification-bell";
import StatCard from "@/components/dashboard/stat-card";
import StatusDonut from "@/components/dashboard/status-donut";
import CategoryBar from "@/components/dashboard/category-bar";
import LocationBar from "@/components/dashboard/location-bar";
import DepreciationChart from "@/components/dashboard/depreciation-chart";
import RecentMovements from "@/components/dashboard/recent-movements";
import AlertsPanel from "@/components/dashboard/alerts-panel";
import { apiGet } from "@/lib/api";
import { formatIDR } from "@/lib/utils";
import type {
  DashboardSummary,
  DashboardAlerts,
  RecentMovement,
  AssetsByLocation,
  AssetsByCategory,
  DepreciationSummary,
} from "@/types/admin";

// ── per-widget state helpers ────────────────────────────────────────────────
interface WidgetState<T> {
  data: T;
  loading: boolean;
  error: string;
}

function makeWidget<T>(initial: T): WidgetState<T> {
  return { data: initial, loading: true, error: "" };
}

// ── Dashboard content ────────────────────────────────────────────────────────
function DashboardContent() {
  // Refresh trigger — increment to re-fetch all widgets
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const [summary, setSummary] = useState<WidgetState<DashboardSummary | null>>(
    makeWidget(null),
  );
  const [alerts, setAlerts] = useState<WidgetState<DashboardAlerts | null>>(
    makeWidget(null),
  );
  const [movements, setMovements] = useState<WidgetState<RecentMovement[]>>(
    makeWidget([]),
  );
  const [byLocation, setByLocation] = useState<WidgetState<AssetsByLocation[]>>(
    makeWidget([]),
  );
  const [byCategory, setByCategory] = useState<WidgetState<AssetsByCategory[]>>(
    makeWidget([]),
  );
  const [depreciation, setDepreciation] = useState<
    WidgetState<DepreciationSummary | null>
  >(makeWidget(null));

  // ── Fetch functions (all independent) ──────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiGet<DashboardSummary>("/api/dashboard/summary");
      setSummary({ data, loading: false, error: "" });
    } catch {
      setSummary({ data: null, loading: false, error: "Failed to load summary" });
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    setAlerts((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiGet<DashboardAlerts>("/api/dashboard/alerts");
      setAlerts({ data, loading: false, error: "" });
    } catch {
      setAlerts({ data: null, loading: false, error: "Failed to load alerts" });
    }
  }, []);

  const fetchMovements = useCallback(async () => {
    setMovements((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiGet<RecentMovement[]>("/api/dashboard/movements/recent");
      setMovements({ data, loading: false, error: "" });
    } catch {
      setMovements({ data: [], loading: false, error: "Failed to load movements" });
    }
  }, []);

  const fetchByLocation = useCallback(async () => {
    setByLocation((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiGet<AssetsByLocation[]>("/api/dashboard/assets/by-location");
      setByLocation({ data, loading: false, error: "" });
    } catch {
      setByLocation({ data: [], loading: false, error: "Failed to load location data" });
    }
  }, []);

  const fetchByCategory = useCallback(async () => {
    setByCategory((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiGet<AssetsByCategory[]>("/api/dashboard/assets/by-category");
      setByCategory({ data, loading: false, error: "" });
    } catch {
      setByCategory({ data: [], loading: false, error: "Failed to load category data" });
    }
  }, []);

  const fetchDepreciation = useCallback(async () => {
    setDepreciation((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await apiGet<DepreciationSummary>("/api/dashboard/depreciation/summary");
      setDepreciation({ data, loading: false, error: "" });
    } catch {
      setDepreciation({
        data: null,
        loading: false,
        error: "Failed to load depreciation data",
      });
    }
  }, []);

  // ── Kick off all fetches in parallel on mount + refresh ────────────────────
  useEffect(() => {
    void fetchSummary();
    void fetchAlerts();
    void fetchMovements();
    void fetchByLocation();
    void fetchByCategory();
    void fetchDepreciation();
    setLastRefreshed(new Date());
  }, [
    refreshKey,
    fetchSummary,
    fetchAlerts,
    fetchMovements,
    fetchByLocation,
    fetchByCategory,
    fetchDepreciation,
  ]);

  // ── Derived stat card values ───────────────────────────────────────────────
  const totalAssetsDelta: { value: number; positive: boolean } | undefined =
    summary.data && summary.data.totalAssetsLastMonth > 0
      ? {
          value:
            ((summary.data.totalAssets - summary.data.totalAssetsLastMonth) /
              summary.data.totalAssetsLastMonth) *
            100,
          positive:
            summary.data.totalAssets >= summary.data.totalAssetsLastMonth,
        }
      : undefined;

  const bookValueDelta: { value: number; positive: boolean } | undefined =
    summary.data && Number(summary.data.totalBookValueLastMonth) > 0
      ? {
          value:
            ((Number(summary.data.totalBookValue) -
              Number(summary.data.totalBookValueLastMonth)) /
              Number(summary.data.totalBookValueLastMonth)) *
            100,
          positive:
            Number(summary.data.totalBookValue) >=
            Number(summary.data.totalBookValueLastMonth),
        }
      : undefined;

  const totalAlerts = alerts.data
    ? alerts.data.warrantyExpiring +
      alerts.data.loanOverdue +
      alerts.data.maintenanceDue
    : 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header strip */}
        <header className="flex h-14 shrink-0 items-center justify-end border-b bg-card px-4">
          <NotificationBell />
        </header>

        {/* Scrollable main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Page heading */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-xs text-muted-foreground">
                Last refreshed:{" "}
                {lastRefreshed.toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <TrendingUp className="h-4 w-4" />
              Refresh
            </button>
          </div>

          {/* Row 1 — Stat cards */}
          <section
            data-tour="dashboard-summary"
            className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <StatCard
              label="Total Assets"
              value={
                summary.loading
                  ? "—"
                  : (summary.data?.totalAssets ?? 0).toLocaleString("id-ID")
              }
              delta={totalAssetsDelta}
              icon={<Boxes className="h-4 w-4" />}
              href="/admin/assets"
            />
            <StatCard
              label="Total Book Value"
              value={
                summary.loading
                  ? "—"
                  : summary.data
                  ? formatIDR(summary.data.totalBookValue)
                  : "—"
              }
              delta={bookValueDelta}
              icon={<BarChart2 className="h-4 w-4" />}
            />
            <StatCard
              label="New This Month"
              value={
                summary.loading
                  ? "—"
                  : (summary.data?.newAssetsThisMonth ?? 0).toLocaleString(
                      "id-ID",
                    )
              }
              icon={<TrendingUp className="h-4 w-4" />}
              href="/admin/assets"
            />
            <StatCard
              label="Open Alerts"
              value={alerts.loading ? "—" : totalAlerts.toLocaleString("id-ID")}
              icon={<AlertTriangle className="h-4 w-4" />}
              href="/admin/notifications"
            />
          </section>

          {/* Row 2 — Alerts panel */}
          <section data-tour="dashboard-alerts" className="mb-6">
            <AlertsPanel
              data={alerts.data}
              loading={alerts.loading}
              error={alerts.error}
            />
          </section>

          {/* Row 3 — Status donut + Category bar */}
          <section
            data-tour="dashboard-charts"
            className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <StatusDonut
              data={summary.data?.byStatus ?? []}
              loading={summary.loading}
              error={summary.error}
            />
            <CategoryBar
              data={byCategory.data}
              loading={byCategory.loading}
              error={byCategory.error}
            />
          </section>

          {/* Row 4 — Location bar */}
          <section className="mb-6">
            <LocationBar
              data={byLocation.data}
              loading={byLocation.loading}
              error={byLocation.error}
            />
          </section>

          {/* Row 5 — Depreciation chart */}
          <section className="mb-6">
            <DepreciationChart
              data={depreciation.data}
              loading={depreciation.loading}
              error={depreciation.error}
            />
          </section>

          {/* Row 6 — Recent movements */}
          <section data-tour="dashboard-recent-movements" className="mb-6">
            <RecentMovements
              data={movements.data}
              loading={movements.loading}
              error={movements.error}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
