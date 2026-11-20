"use client";

import { ShowroomProvider, useShowroom } from "@/components/sms/showroom-context";

/**
 * Shell for every Stock Management screen: resolves which showrooms the
 * user can work in before any page renders, so pages can assume a selected
 * showroom and never flash data for the wrong one.
 */
function StockAccessGate({ children }: { children: React.ReactNode }) {
  const { isLoading, error, showrooms, showroom } = useShowroom();

  // Also wait for the remembered showroom to be restored: pages rely on a
  // selected showroom from their very first render (e.g. as a form default).
  const isRestoringSelection = !error && showrooms.length > 0 && !showroom;

  if (isLoading || isRestoringSelection) {
    return (
      <div className="p-4 md:p-6">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error || showrooms.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-lg rounded-lg border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">No stock access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ??
              "Your account is not assigned to a showroom for stock management yet. Ask an administrator to give you a stock role with a showroom scope."}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function SmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShowroomProvider>
      <StockAccessGate>{children}</StockAccessGate>
    </ShowroomProvider>
  );
}
