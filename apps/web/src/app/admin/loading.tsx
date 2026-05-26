import { Skeleton } from "@/components/ui/skeleton";

// Route-segment loading fallback for /admin/**. Renders instantly when
// Next.js starts a route transition into any admin page and the new
// page's data hasn't resolved yet. Combined with the NavigationProgress
// top bar in the root layout, this gives the user two signals at once:
// the bar at the very top (continuous motion) + a structured skeleton
// (so the next page's shape is already familiar before paint).
//
// We don't try to match every page's specific layout here — that's the
// job of per-route loading.tsx overrides. This is the generic fallback
// that's still useful enough not to look "blank".

export default function AdminLoading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true">
      {/* Breadcrumb stub */}
      <Skeleton className="h-4 w-48" />

      {/* Header block: title + action buttons cluster */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Two-column content stub — close enough to most admin layouts
          (list + filter sidebar, detail + meta panel, etc.) that the
          transition reads as "almost there" instead of "starting over". */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-lg border bg-card p-5 lg:col-span-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="space-y-3 rounded-lg border bg-card p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>

      {/* Long-row block — covers list pages where the next thing the
          user sees is a table of rows. */}
      <div className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
