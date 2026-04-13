"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { usePermission } from "@/hooks/use-permission";

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
}

function Forbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-gray-300">403</h1>
      <p className="mt-4 text-lg text-gray-500">
        {"Forbidden"}
      </p>
    </div>
  );
}

function PermissionGate({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission: string;
}) {
  const hasPermission = usePermission(permission);

  if (!hasPermission) {
    return <Forbidden />;
  }

  return <>{children}</>;
}

export default function ProtectedRoute({
  children,
  permission,
}: ProtectedRouteProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [hydrated, setHydrated] = useState(false);

  // Wait for zustand persist hydration before checking auth
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    // If already hydrated (e.g. fast load)
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return () => unsub();
  }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace("/auth/login");
    }
  }, [hydrated, isAuthenticated, router]);

  // Show nothing while waiting for hydration
  if (!hydrated) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (permission) {
    return (
      <PermissionGate permission={permission}>{children}</PermissionGate>
    );
  }

  return <>{children}</>;
}
