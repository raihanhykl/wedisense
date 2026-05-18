"use client";

import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface StatusDonutProps {
  data: { status: string; count: number }[];
  loading: boolean;
  error: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#10b981",       // emerald-500
  IDLE: "#60a5fa",         // blue-400
  IN_MAINTENANCE: "#f59e0b", // amber-500
  BORROWED: "#6366f1",     // indigo-500
  DISPOSED: "#9ca3af",     // gray-400
  LOST: "#ef4444",         // red-500
};

const DEFAULT_COLOR = "#cbd5e1"; // slate-300

export default function StatusDonut({ data, loading, error }: StatusDonutProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Assets by Status
      </h3>

      {loading && (
        <div className="flex h-[280px] items-center justify-center">
          <div className="h-40 w-40 animate-pulse rounded-full bg-muted" />
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!loading && !error && (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="count"
              nameKey="status"
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={STATUS_COLORS[entry.status] ?? DEFAULT_COLOR}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [value, name]}
            />
            <Legend
              formatter={(value: string) =>
                value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
              }
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
