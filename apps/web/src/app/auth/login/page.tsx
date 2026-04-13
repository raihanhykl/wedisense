"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiPost } from "@/lib/api";
import { useAuthStore, type AuthUser } from "@/stores/auth.store";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(data: LoginFormValues) {
    setServerError(null);
    try {
      const res = await apiPost<LoginResponse>("/api/auth/login", data);
      setAuth(res.accessToken, res.user);
      router.push("/dashboard");
    } catch {
      setServerError("Invalid email or password");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            {"Login"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {"Sign in to your account"}
          </p>
        </div>

        <form
          data-tour="login-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              {"Email"}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register("email")}
              className="w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              {"Password"}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
              className="w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.password && (
              <p className="text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <p className="text-sm text-red-600">{serverError}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </main>
  );
}
