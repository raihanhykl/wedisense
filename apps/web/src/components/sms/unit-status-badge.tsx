import { cn } from "@/lib/utils";
import { UNIT_STATUS_STYLE, unitStatusLabel, type SmsUnitStatus } from "@/lib/sms/labels";

/** Status pill used wherever a unit is listed or shown. */
export function UnitStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        UNIT_STATUS_STYLE[status as SmsUnitStatus] ?? "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {unitStatusLabel(status)}
    </span>
  );
}

/** Small marker for units that have been on a rent-to-own contract before. */
export function ExRtoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700",
        className,
      )}
      title="This unit has been on a rent-to-own contract before"
    >
      Ex-RTO
    </span>
  );
}
