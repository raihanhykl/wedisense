"use client";

import ProtectedRoute from "@/components/shared/protected-route";
import { useAuthStore } from "@/stores/auth.store";

function DashboardContent() {
  const userName = useAuthStore((s) => s.user?.name ?? "");

  return (
    <main
      data-tour="dashboard"
      className="flex min-h-screen flex-col items-center justify-center p-8"
    >
      <h1 className="text-3xl font-bold tracking-tight">
        {"Welcome, "}{userName}
      </h1>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
