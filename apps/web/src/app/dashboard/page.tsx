"use client";

import ProtectedRoute from "@/components/shared/protected-route";
import AppSidebar from "@/components/shared/app-sidebar";
import NotificationBell from "@/components/shared/notification-bell";
import { useAuthStore } from "@/stores/auth.store";

function DashboardContent() {
  const userName = useAuthStore((s) => s.user?.name ?? "");

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-end border-b bg-card px-4">
          <NotificationBell />
        </header>
        <main
          data-tour="dashboard"
          className="flex flex-1 flex-col items-center justify-center p-8"
        >
          <h1 className="text-3xl font-bold tracking-tight">
            {"Welcome, "}{userName}
          </h1>
        </main>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
