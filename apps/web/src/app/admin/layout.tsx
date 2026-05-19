"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import ProtectedRoute from "@/components/shared/protected-route";
import AppSidebar from "@/components/shared/app-sidebar";
import NotificationBell from "@/components/shared/notification-bell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Mobile-only drawer state. Always closed on initial render so a fresh
  // page load on desktop doesn't briefly render an overlay before the
  // CSS media query takes effect.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ProtectedRoute>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
            {/* Hamburger — mobile only. Hidden on md+ where the sidebar is
                permanent. Sized as a comfortable tap target (40px). */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex-1" />
            <NotificationBell />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
