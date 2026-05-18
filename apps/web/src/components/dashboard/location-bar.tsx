"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AssetsByLocation } from "@/types/admin";

interface LocationBarProps {
  data: AssetsByLocation[];
  loading: boolean;
  error: string;
}

export default function LocationBar({ data, loading, error }: LocationBarProps) {
  const chartData = data.map((d) => ({
    name: d.locationName,
    count: d.count,
  }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Assets by Location (Top 10)
      </h3>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-muted" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!loading && !error && (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12 }}
              width={120}
              tickFormatter={(v: string) =>
                v.length > 16 ? `${v.slice(0, 15)}…` : v
              }
            />
            <Tooltip />
            <Bar dataKey="count" name="Assets" fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
