"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Single shared QueryClient mounted at the app root. Defaults are tuned for
 * an internal tool: data that rarely changes mid-session gets a generous
 * `staleTime` so navigating list ↔ detail ↔ list doesn't re-fetch lookup
 * tables. Individual queries can override this for hot data.
 *
 * `useState` so React mounts a single client per page instance — without it,
 * a server-rendered fast-refresh re-instantiates the client every render and
 * the cache is effectively gone.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 5 minutes — fits the typical internal-tool session pattern
            // where users open many pages but reference data (locations,
            // categories, users, etc.) is essentially static.
            staleTime: 5 * 60 * 1000,
            // Garbage-collect cache entries 30 minutes after the last
            // subscriber drops; keeps memory bounded without thrashing
            // recently-visited pages.
            gcTime: 30 * 60 * 1000,
            // Don't auto-refetch on every window focus — that's the
            // single biggest source of unexpected network noise in
            // internal-tool dashboards.
            refetchOnWindowFocus: false,
            // Retry once on transient network errors; a long retry loop
            // just hides real outages.
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
