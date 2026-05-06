"use client";

import ProtectedRoute from "@/components/shared/protected-route";
import AppSidebar from "@/components/shared/app-sidebar";
import NotificationBell from "@/components/shared/notification-bell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-end border-b bg-card px-4">
            <NotificationBell />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
