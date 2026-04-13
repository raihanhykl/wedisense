"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";

export default function HomePage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/dashboard");
    } else {
      router.replace("/auth/login");
    }
  }, [isAuthenticated, router]);

  return null;
}
