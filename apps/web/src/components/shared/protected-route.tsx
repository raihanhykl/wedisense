"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/auth/login");
    }
  }, [isAuthenticated, router]);

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
