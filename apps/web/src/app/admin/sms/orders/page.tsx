"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetPaginated, type PaginationMeta } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";
import { formatDate, formatDateTime } from "@/lib/sms/labels";
import { useShowroom, ShowroomSwitcher } from "@/components/sms/showroom-context";
import type { OrderListRow } from "@/lib/sms/orders-types";

type StatusFilter = "open" | "all";

function summarySentence(summary: OrderListRow["summary"]): string {
  const { total, booked, sold, pickedUp, cancelled } = summary;
  if (total === 0) return "No units";
  const parts: string[] = [];
  if (booked > 0) parts.push(`${booked} booked`);
  if (sold > 0) parts.push(`${sold} sold`);
  if (pickedUp > 0) parts.push(`${pickedUp} of ${total - cancelled} picked up`);
  if (cancelled > 0) parts.push(`${cancelled} cancelled`);
  return parts.length > 0 ? `${total} unit${total !== 1 ? "s" : ""}: ${parts.join(", ")}` : `${total} unit${total !== 1 ? "s" : ""}`;
}

function summaryChips(summary: OrderListRow["summary"]) {
  const { total, booked, sold, pickedUp, cancelled } = summary;
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {booked > 0 && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{booked} booked</span>
      )}
      {sold > 0 && (
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800">{sold} sold</span>
      )}
      {pickedUp > 0 && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
          {pickedUp} of {total - cancelled} picked up
        </span>
      )}
      {cancelled > 0 && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{cancelled} cancelled</span>
      )}
    </div>
  );
}

// ── Inner component ────────────────────────────────────────────────────

function OrderListInner() {
  const { showroom, can } = useShowroom();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlStatus = (searchParams.get("status") ?? "open") as StatusFilter;
  const urlSearch = searchParams.get("search") ?? "";
  const urlPage = Number(searchParams.get("page") ?? "1");

  const [status, setStatus] = useState<StatusFilter>(urlStatus);
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [search, setSearch] = useState(urlSearch);
  const [page, setPage] = useState(urlPage > 0 ? urlPage : 1);

  const [orders, setOrders] = useState<OrderListRow[]>([]);
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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput, search]);

  const pushUrl = useCallback(
    (params: { status: StatusFilter; search: string; page: number; showroomId: string }) => {
      const qs = new URLSearchParams();
      qs.set("status", params.status);
      if (params.search) qs.set("search", params.search);
      if (params.page > 1) qs.set("page", String(params.page));
      qs.set("showroomId", params.showroomId);
      router.replace(`?${qs.toString()}`, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (!showroom) return;
    pushUrl({ status, search, page, showroomId: showroom.id });
  }, [status, search, page, showroom, pushUrl]);

  const fetchOrders = useCallback(async () => {
    if (!showroom) return;
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        showroomId: showroom.id,
        status,
        page,
        limit: 20,
      };
      if (search) params.search = search;
      const result = await apiGetPaginated<OrderListRow[]>("/api/sms/orders", params);
      setOrders(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(smsErrorMessage(err, "Failed to load orders."));
    } finally {
      setLoading(false);
    }
  }, [showroom, status, page, search]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  if (!showroom) return null;

  return (
    <div className="p-4 md:p-6" data-tour="sms-orders-list">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Orders (SPK)</h1>
            <ShowroomSwitcher />
          </div>
          {!loading && (
            <p className="mt-1 text-sm text-muted-foreground">
              {meta.total} SPK{meta.total !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        {can("sms-orders:manage") && (
          <Link
            href="/admin/sms/orders/new"
            data-tour="sms-orders-new"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New SPK
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Status tabs */}
        <div className="flex overflow-hidden rounded-md border">
          {(["open", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {s === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search SPK, customer, VIN"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="sms-orders-search"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
        ) : orders.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No orders match the current filters.
          </div>
        ) : (
          orders.map((order) => (
            <Link
              key={order.id}
              href={`/admin/sms/orders/${order.id}`}
              className="block rounded-lg border bg-card p-3 hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{order.spkNumber}</span>
                <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
              </div>
              <div className="mt-1 text-sm font-medium">{order.customerName}</div>
              {order.sales && (
                <div className="mt-0.5 text-xs text-muted-foreground">Sales: {order.sales.name}</div>
              )}
              <div className="mt-2">{summaryChips(order.summary)}</div>
            </Link>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">SPK</th>
              <th className="px-4 py-3 text-left font-medium">Customer</th>
              <th className="px-4 py-3 text-left font-medium">Sales</th>
              <th className="px-4 py-3 text-left font-medium">Units</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                  onClick={() => router.push(`/admin/sms/orders/${order.id}`)}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono font-semibold">{order.spkNumber}</span>
                  </td>
                  <td className="px-4 py-3">{order.customerName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {order.sales?.name ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-muted-foreground">{summarySentence(order.summary)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDateTime(order.createdAt)}
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

export default function OrdersPage() {
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
      <OrderListInner />
    </Suspense>
  );
}
