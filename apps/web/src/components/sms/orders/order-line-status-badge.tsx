"use client";

import { cn } from "@/lib/utils";
import { ORDER_LINE_STATUS_STYLE, orderLineStatusLabel } from "@/lib/sms/labels";

export function OrderLineStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        ORDER_LINE_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {orderLineStatusLabel(status)}
    </span>
  );
}
