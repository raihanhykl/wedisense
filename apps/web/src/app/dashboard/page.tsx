"use client";

import ProtectedRoute from "@/components/shared/protected-route";
import AppSidebar from "@/components/shared/app-sidebar";
import { useAuthStore } from "@/stores/auth.store";

function DashboardContent() {
  const userName = useAuthStore((s) => s.user?.name ?? "");

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main
        data-tour="dashboard"
        className="flex flex-1 flex-col items-center justify-center p-8"
      >
        <h1 className="text-3xl font-bold tracking-tight">
          {"Welcome, "}{userName}
        </h1>
      </main>
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
