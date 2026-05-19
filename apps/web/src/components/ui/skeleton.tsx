import { cn } from "@/lib/utils";

/**
 * Minimal shadcn-style skeleton. Renders a pulsing placeholder of the given
 * shape. Composable: caller controls width/height via className.
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />
 *   <Skeleton className="h-10 w-full rounded-md" />
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
