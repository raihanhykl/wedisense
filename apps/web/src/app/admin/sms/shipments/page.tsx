"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGetPaginated, type PaginationMeta } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatBusinessDate, formatDate } from "@/lib/sms/labels";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import { ShipmentProgressBar } from "@/components/sms/shipment-progress-bar";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import type { ShipmentListItem } from "@/lib/sms/shipments-types";

type ShipmentState = "open" | "complete" | "all";

const STATE_TABS: { value: ShipmentState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "complete", label: "Complete" },
  { value: "all", label: "All" },
];

function ShipmentsInner() {
  const { showroom, can } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlState = searchParams.get("state");
  const initState: ShipmentState =
    urlState === "complete" || urlState === "open" || urlState === "all" ? urlState : "open";

  const [state, setState] = useState<ShipmentState>(initState);
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const [search, setSearch] = useState(searchInput);
  const [page, setPage] = useState(1);

  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchInput === search) return;
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput, search]);

  const load = useCallback(async () => {
    if (!showroom) return;
    setLoading(true);
    setError(null);
    try {
      const { data, meta: m } = await apiGetPaginated<ShipmentListItem[]>(
        "/api/sms/shipments",
        {
          destinationLocationId: showroom.id,
          state,
          search: search || undefined,
          page,
          limit: 20,
        },
      );
      setShipments(data);
      setMeta(m);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load shipments."));
    } finally {
      setLoading(false);
    }
  }, [showroom, state, search, page]);

  useEffect(() => { void load(); }, [load]);

  // Update URL without navigation
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("state", state);
    if (search) params.set("search", search);
    if (page > 1) params.set("page", String(page));
    router.replace(`/admin/sms/shipments?${params.toString()}`, { scroll: false });
  }, [state, search, page, router]);

  const canImport = can(SMS_PERMISSIONS.RECEIVING_MANAGE);

  return (
    <div className="p-4 md:p-6" data-tour="sms-shipments-page">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">Shipments</h1>
          <ShowroomSwitcher />
        </div>
        {canImport && (
          <Link
            href="/admin/sms/shipments/import"
            data-tour="sms-import-manifest"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Import manifest
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* State tabs */}
        <div
          role="tablist"
          aria-label="Filter by state"
          className="inline-flex rounded-md border bg-card p-0.5"
        >
          {STATE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={state === t.value}
              onClick={() => { setState(t.value); setPage(1); }}
              className={
                state === t.value
                  ? "rounded-sm px-3 py-1 text-xs font-medium bg-primary text-primary-foreground"
                  : "rounded-sm px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search batch or delivery note…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && shipments.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm font-medium">No shipments found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === "open"
              ? "No open shipments for this showroom. Import a manifest to start receiving."
              : "No shipments match your search."}
          </p>
          {canImport && state === "open" && (
            <Link
              href="/admin/sms/shipments/import"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Import manifest
            </Link>
          )}
        </div>
      )}

      {/* Table — desktop */}
      {!loading && shipments.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium">Batch</th>
                  <th className="px-4 py-3 text-left font-medium">Delivery note</th>
                  <th className="px-4 py-3 text-left font-medium">Dispatched</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                  <th className="px-4 py-3 text-left font-medium min-w-[200px]">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shipments.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => router.push(`/admin/sms/shipments/${s.id}`)}
                    className="cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">{s.batchNumber}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.deliveryNoteNumber || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatBusinessDate(s.dispatchDate)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(s.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <ShipmentProgressBar counts={s.counts} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards — mobile */}
          <div className="space-y-3 md:hidden">
            {shipments.map((s) => (
              <Link
                key={s.id}
                href={`/admin/sms/shipments/${s.id}`}
                className="block rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="font-medium">{s.batchNumber}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDate(s.createdAt)}
                  </span>
                </div>
                {s.deliveryNoteNumber && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    DN: {s.deliveryNoteNumber}
                  </p>
                )}
                {s.dispatchDate && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Dispatched: {formatBusinessDate(s.dispatchDate)}
                  </p>
                )}
                <ShipmentProgressBar counts={s.counts} />
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Page {meta.page} of {meta.totalPages} · {meta.total} shipments
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={meta.page >= meta.totalPages}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ShipmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 md:p-6">
          <div className="mb-4 h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      }
    >
      <ShipmentsInner />
    </Suspense>
  );
}
