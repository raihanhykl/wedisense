"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { DepreciationSummary } from "@/types/admin";
import { formatIDR } from "@/lib/utils";

interface DepreciationChartProps {
  data: DepreciationSummary | null;
  loading: boolean;
  error: string;
}

export default function DepreciationChart({
  data,
  loading,
  error,
}: DepreciationChartProps) {
  const chartData =
    data?.byCategory.map((c) => ({
      name: c.categoryName.length > 12 ? `${c.categoryName.slice(0, 11)}…` : c.categoryName,
      fullName: c.categoryName,
      purchase: Number(c.purchasePrice),
      bookValue: Number(c.currentBookValue),
      depreciated: c.depreciationPercent,
    })) ?? [];

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Depreciation by Category
      </h3>

      {loading && (
        <div className="space-y-3">
          <div className="h-[240px] animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!loading && !error && data && (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) =>
                  v >= 1_000_000_000
                    ? `${(v / 1_000_000_000).toFixed(1)}B`
                    : v >= 1_000_000
                    ? `${(v / 1_000_000).toFixed(0)}M`
                    : `${(v / 1_000).toFixed(0)}K`
                }
              />
              <Tooltip
                formatter={(value: number, name: string, props: { payload?: { fullName?: string; depreciated?: number } }) => {
                  const label =
                    name === "purchase" ? "Purchase Price" : "Book Value";
                  const pct = props.payload?.depreciated;
                  return [
                    formatIDR(value),
                    `${label}${pct !== undefined ? ` (${pct.toFixed(1)}% depreciated)` : ""}`,
                  ];
                }}
                labelFormatter={(label: string, payload: { payload?: { fullName?: string } }[]) =>
                  payload?.[0]?.payload?.fullName ?? label
                }
              />
              <Legend
                formatter={(value: string) =>
                  value === "purchase" ? "Purchase Price" : "Book Value"
                }
              />
              <Bar
                dataKey="purchase"
                fill="#6366f1"
                fillOpacity={0.4}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="bookValue"
                fill="#6366f1"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total Purchase</p>
              <p className="mt-0.5 text-sm font-bold">
                {formatIDR(data.totalPurchasePrice)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total Book Value</p>
              <p className="mt-0.5 text-sm font-bold text-emerald-600">
                {formatIDR(data.totalCurrentBookValue)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total Depreciation</p>
              <p className="mt-0.5 text-sm font-bold text-red-500">
                {formatIDR(data.totalDepreciation)}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
