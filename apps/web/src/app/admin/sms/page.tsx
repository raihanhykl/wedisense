"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import { UnitStatusBadge } from "@/components/sms/unit-status-badge";
import type {
  DashboardSummary,
  DashboardTasks,
  DashboardVariantRow,
  UnitSearchResult,
  StaleBookingTask,
  AwaitingPickupTask,
  OverdueShowUnitTask,
} from "@/lib/sms/types";

// ── Stat tile ─────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: number;
  href: string;
  highlight?: boolean;
  warn?: boolean;
}

function StatTile({ label, value, href, highlight, warn }: StatTileProps) {
  return (
    <Link
      href={href}
      className={`group flex flex-col gap-1 rounded-xl border p-4 transition-colors hover:border-primary/60 hover:bg-accent/50 ${
        highlight ? "border-emerald-200 bg-emerald-50" : warn && value > 0 ? "border-amber-200 bg-amber-50" : "bg-card"
      }`}
    >
      <span className="text-2xl font-bold leading-none">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </Link>
  );
}

// ── Search results ────────────────────────────────────────────────────

function SearchResultItem({ result }: { result: UnitSearchResult }) {
  if (result.kind === "expected") {
    return (
      <Link
        href={`/admin/sms/shipments/${result.shipmentId}`}
        className="flex flex-col gap-0.5 rounded-md px-3 py-2.5 hover:bg-accent"
      >
        <span className="font-mono text-sm font-medium">{result.vin}</span>
        <span className="text-xs text-muted-foreground">
          Expected in batch {result.batchNumber} → {result.destination.name}
        </span>
      </Link>
    );
  }
  return (
    <Link
      href={`/admin/sms/units/${result.id}`}
      className="flex flex-col gap-0.5 rounded-md px-3 py-2.5 hover:bg-accent"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium">{result.vin}</span>
        <UnitStatusBadge status={result.status} />
      </div>
      <span className="text-xs text-muted-foreground">
        {result.variant.model.name} · {result.variant.name} · {result.variant.color}
        {result.physicalLocation ? ` — ${result.physicalLocation.name}` : " — Not in a showroom"}
      </span>
    </Link>
  );
}

// ── Variant table row ─────────────────────────────────────────────────

function VariantTableRow({ row, showroomId }: { row: DashboardVariantRow; showroomId: string }) {
  const link = (view: string, count: number) =>
    count > 0 ? (
      <Link
        href={`/admin/sms/units?view=${view}&variantId=${row.variantId}&showroomId=${showroomId}`}
        className="font-medium text-primary hover:underline"
      >
        {count}
      </Link>
    ) : (
      <span className="text-muted-foreground">0</span>
    );

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3 font-medium">{row.modelName}</td>
      <td className="px-4 py-3 text-sm">{row.variantName}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{row.color}</td>
      <td className="px-4 py-3 text-right">{link("physical", row.physical)}</td>
      <td className="px-4 py-3 text-right">{link("ready", row.ready)}</td>
      <td className="px-4 py-3 text-right">{link("booked", row.booked)}</td>
      <td className="px-4 py-3 text-right">{link("sold_pending_pickup", row.soldPendingPickup)}</td>
      <td className="px-4 py-3 text-right">{link("inspection", row.inspection)}</td>
      <td className="px-4 py-3 text-right">{link("custody", row.custody)}</td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function SmsHomePage() {
  const { showroom } = useShowroom();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [tasks, setTasks] = useState<DashboardTasks | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<UnitSearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Model filter for the variant table
  const [modelFilter, setModelFilter] = useState<string>("");

  const fetchDashboard = useCallback(async () => {
    if (!showroom) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const [summaryData, tasksData] = await Promise.all([
        apiGet<DashboardSummary>("/api/sms/dashboard/summary", { showroomId: showroom.id }),
        apiGet<DashboardTasks>("/api/sms/dashboard/tasks", { showroomId: showroom.id }),
      ]);
      setSummary(summaryData);
      setTasks(tasksData);
    } catch (err) {
      setSummaryError(smsErrorMessage(err, "Failed to load dashboard."));
    } finally {
      setSummaryLoading(false);
      setTasksLoading(false);
    }
  }, [showroom]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (searchInput.length < 3) {
      setSearchResults(null);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await apiGet<UnitSearchResult[]>("/api/sms/units/search", { q: searchInput });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchInput]);

  if (!showroom) return null;

  const totals = summary?.totals;
  const allModels = summary
    ? Array.from(new Map(summary.byVariant.map((r) => [r.modelId, r.modelName])).entries())
    : [];

  const filteredVariants = summary
    ? (modelFilter ? summary.byVariant.filter((r) => r.modelId === modelFilter) : summary.byVariant)
    : [];

  const hasNoTasks =
    tasks &&
    tasks.openShipments.total === 0 &&
    tasks.inspections.total === 0 &&
    tasks.identityMismatches.total === 0 &&
    tasks.staleBookings.total === 0 &&
    tasks.awaitingPickup.total === 0 &&
    tasks.overdueShowUnits.total === 0;

  return (
    <div className="p-4 md:p-6" data-tour="sms-dashboard">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">My Showroom Stock</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Track your physical units and availability</p>
        </div>
        <ShowroomSwitcher />
      </div>

      {/* Search */}
      <div className="relative mb-8">
        <input
          type="search"
          placeholder="Search VIN, engine number or plate (min 3 characters)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full rounded-lg border bg-background px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="sms-stock-search"
          autoComplete="off"
        />
        {(searchResults !== null || searchLoading) && searchInput.length >= 3 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover shadow-lg">
            {searchLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Searching…</div>
            ) : searchResults && searchResults.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No matches found.</div>
            ) : (
              <div className="p-1">
                {searchResults?.map((r, idx) => (
                  <SearchResultItem
                    key={r.kind === "unit" ? r.id : `${r.vin}-${idx}`}
                    result={r}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {summaryError && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {summaryError}
        </div>
      )}

      {/* Totals tiles */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Overview — {showroom.name}
        </h2>
        {summaryLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : totals ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Physical"
              value={totals.physical}
              href={`/admin/sms/units?view=physical&showroomId=${showroom.id}`}
              highlight
            />
            <StatTile
              label="Ready"
              value={totals.ready}
              href={`/admin/sms/units?view=ready&showroomId=${showroom.id}`}
              highlight
            />
            <StatTile
              label="Booked"
              value={totals.booked}
              href={`/admin/sms/units?view=booked&showroomId=${showroom.id}`}
            />
            <StatTile
              label="Sold · awaiting pickup"
              value={totals.soldPendingPickup}
              href={`/admin/sms/units?view=sold_pending_pickup&showroomId=${showroom.id}`}
            />
            <StatTile
              label="In inspection"
              value={totals.inspection}
              href={`/admin/sms/units?view=inspection&showroomId=${showroom.id}`}
              warn
            />
            <StatTile
              label="In custody"
              value={totals.custody}
              href={`/admin/sms/units?view=custody&showroomId=${showroom.id}`}
            />
            <StatTile
              label="Identity mismatch"
              value={totals.identityMismatch}
              href={`/admin/sms/units?view=identity_mismatch&showroomId=${showroom.id}`}
              warn
            />
            <StatTile
              label="Outside (RTO + events)"
              value={totals.outside}
              href={`/admin/sms/units?view=outside&showroomId=${showroom.id}`}
            />
            <StatTile
              label="Out on show"
              value={totals.showUnit}
              href={`/admin/sms/show-units?showroomId=${showroom.id}`}
            />
            <StatTile
              label="Expected (not arrived)"
              value={totals.expected}
              href={`/admin/sms/shipments?state=open`}
            />
          </div>
        ) : null}
      </section>

      {/* Variant table */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Stock by model, variant and colour
          </h2>
          {allModels.length > 0 && (
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All models</option>
              {allModels.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Mobile cards */}
        {summaryLoading ? (
          <div className="space-y-2 md:hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : filteredVariants.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground md:hidden">
            No variants to show.
          </div>
        ) : (
          <div className="space-y-2 md:hidden">
            {filteredVariants.map((row) => (
              <div key={row.variantId} className="rounded-lg border bg-card p-3 text-sm">
                <div className="font-medium">
                  {row.modelName} · {row.variantName}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{row.color}</div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                  {[
                    ["Physical", "physical", row.physical],
                    ["Ready", "ready", row.ready],
                    ["Booked", "booked", row.booked],
                    ["Inspection", "inspection", row.inspection],
                  ].map(([label, view, count]) => (
                    <div key={String(view)} className="rounded bg-muted/50 py-1">
                      <div className="font-semibold">
                        {Number(count) > 0 ? (
                          <Link
                            href={`/admin/sms/units?view=${view}&variantId=${row.variantId}&showroomId=${showroom.id}`}
                            className="text-primary hover:underline"
                          >
                            {String(count)}
                          </Link>
                        ) : (
                          "0"
                        )}
                      </div>
                      <div className="text-muted-foreground">{String(label)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Desktop table */}
        <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Model</th>
                <th className="px-4 py-3 text-left font-medium">Variant</th>
                <th className="px-4 py-3 text-left font-medium">Colour</th>
                <th className="px-4 py-3 text-right font-medium">Physical</th>
                <th className="px-4 py-3 text-right font-medium">Ready</th>
                <th className="px-4 py-3 text-right font-medium">Booked</th>
                <th className="px-4 py-3 text-right font-medium">Sold·pickup</th>
                <th className="px-4 py-3 text-right font-medium">Inspection</th>
                <th className="px-4 py-3 text-right font-medium">Custody</th>
              </tr>
            </thead>
            <tbody>
              {summaryLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-16" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredVariants.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No variants to show.
                  </td>
                </tr>
              ) : (
                filteredVariants.map((row) => (
                  <VariantTableRow key={row.variantId} row={row} showroomId={showroom.id} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Needs follow-up panel */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Needs follow-up
        </h2>

        {tasksLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : hasNoTasks ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Nothing needs follow-up right now.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Open shipments */}
            {tasks && tasks.openShipments.total > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">
                  Open shipments ({tasks.openShipments.total})
                </h3>
                <div className="space-y-2">
                  {tasks.openShipments.data.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-4 text-sm">
                      <div>
                        <Link
                          href={`/admin/sms/shipments/${s.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.batchNumber}
                        </Link>
                        <span className="ml-2 text-muted-foreground">{s.deliveryNoteNumber}</span>
                      </div>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {s.receivedCount} of {s.expectedCount} received
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Units in inspection */}
            {tasks && tasks.inspections.total > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">
                  In inspection ({tasks.inspections.total})
                </h3>
                <div className="space-y-2">
                  {tasks.inspections.data.map((item) => (
                    <div key={item.unitId} className="flex items-center justify-between gap-4 text-sm">
                      <div>
                        <Link
                          href={`/admin/sms/units/${item.unitId}`}
                          className="font-mono font-medium text-primary hover:underline"
                        >
                          {item.vin}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">{item.variantLabel}</span>
                      </div>
                      {item.latestInspectionResult && (
                        <span className="text-xs text-muted-foreground capitalize">
                          {item.latestInspectionResult.toLowerCase()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Identity mismatches */}
            {tasks && tasks.identityMismatches.total > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-amber-900">
                  Identity mismatches ({tasks.identityMismatches.total})
                </h3>
                <div className="space-y-2">
                  {tasks.identityMismatches.data.map((item) => (
                    <div key={item.unitId} className="text-sm">
                      <Link
                        href={`/admin/sms/units/${item.unitId}`}
                        className="font-mono font-medium text-primary hover:underline"
                      >
                        {item.vin}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{item.variantLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stale bookings */}
            {tasks && tasks.staleBookings.total > 0 && (
              <div className="rounded-lg border bg-card p-4" data-tour="sms-dashboard-follow-up">
                <h3 className="mb-3 text-sm font-semibold">
                  Stale bookings ({tasks.staleBookings.total})
                </h3>
                <div className="space-y-2">
                  {tasks.staleBookings.data.map((item: StaleBookingTask) => (
                    <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                      <div>
                        <Link
                          href={`/admin/sms/orders/${item.orderId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {item.spk}
                        </Link>
                        <span className="ml-2 font-mono text-xs">{item.vin}</span>
                        {item.salesName && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {item.salesName}
                          </span>
                        )}
                      </div>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {item.daysSinceBooking}d ago
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Awaiting pickup */}
            {tasks && tasks.awaitingPickup.total > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">
                  Sold · awaiting pickup ({tasks.awaitingPickup.total})
                </h3>
                <div className="space-y-2">
                  {tasks.awaitingPickup.data.map((item: AwaitingPickupTask) => (
                    <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                      <div>
                        <Link
                          href={`/admin/sms/orders/${item.orderId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {item.spk}
                        </Link>
                        <span className="ml-2 font-mono text-xs">{item.vin}</span>
                      </div>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {item.daysWaiting}d waiting
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overdue show units */}
            {tasks && tasks.overdueShowUnits.total > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-red-900">
                  Overdue show units ({tasks.overdueShowUnits.total})
                </h3>
                <div className="space-y-2">
                  {tasks.overdueShowUnits.data.map((item: OverdueShowUnitTask) => (
                    <div key={item.loanId} className="flex items-center justify-between gap-4 text-sm">
                      <div>
                        <Link
                          href={`/admin/sms/show-units`}
                          className="font-mono font-medium text-primary hover:underline"
                        >
                          {item.vin}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">{item.eventName}</span>
                        {item.pic && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            PIC: {item.pic.name}
                          </span>
                        )}
                      </div>
                      <span className="whitespace-nowrap text-xs font-medium text-red-700">
                        {item.daysOverdue}d overdue
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );
}
