"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { value: number; positive: boolean };
  icon?: ReactNode;
  href?: string;
}

function CardInner({ label, value, delta, icon }: Omit<StatCardProps, "href">) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {delta !== undefined && (
        <p
          className={cn(
            "text-xs font-medium",
            delta.positive ? "text-emerald-600" : "text-red-500",
          )}
        >
          {delta.positive ? "↑" : "↓"} {Math.abs(delta.value).toFixed(1)}% vs
          last month
        </p>
      )}
    </div>
  );
}

export default function StatCard({ label, value, delta, icon, href }: StatCardProps) {
  const base =
    "rounded-lg border bg-card transition-shadow hover:shadow-md";

  if (href) {
    return (
      <Link href={href} className={cn(base, "block")}>
        <CardInner label={label} value={value} delta={delta} icon={icon} />
      </Link>
    );
  }

  return (
    <div className={base}>
      <CardInner label={label} value={value} delta={delta} icon={icon} />
    </div>
  );
}
