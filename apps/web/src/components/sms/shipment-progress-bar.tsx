import { cn } from "@/lib/utils";
import type { ShipmentCounts } from "@/lib/sms/shipments-types";

interface ShipmentProgressBarProps {
  counts: ShipmentCounts;
  className?: string;
}

/**
 * Compact progress summary plus a bar, e.g.
 * "9 of 10 arrived · 1 damaged · 1 pending · 1 unexpected".
 *
 * Progress is measured against the manifest: `expected` counts the VINs that
 * were listed, and a unit has "arrived" once it is no longer pending
 * (received fit, received damaged, or arrived with a different identity).
 * Motorcycles that turned up without being listed are extra and shown
 * separately — they never push the bar to 100%.
 */
export function ShipmentProgressBar({ counts, className }: ShipmentProgressBarProps) {
  const { expected, receivedDamaged, discrepancy, pending } = counts;
  const unexpected = counts.unexpected ?? 0;
  const arrived = Math.max(0, expected - pending);
  const pct = expected > 0 ? Math.min(100, Math.round((arrived / expected) * 100)) : 0;
  const identityDiffers = Math.max(0, discrepancy - unexpected);

  const parts: string[] = [`${arrived} of ${expected} arrived`];
  if (receivedDamaged > 0) parts.push(`${receivedDamaged} damaged`);
  if (identityDiffers > 0) parts.push(`${identityDiffers} identity differs`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (unexpected > 0) parts.push(`${unexpected} unexpected`);

  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pending === 0 && expected > 0 ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
