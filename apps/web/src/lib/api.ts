import axios, {
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { useAuthStore } from "@/stores/auth.store";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// ── Request interceptor ────────────────────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — handle 401 + token refresh ──────────────────
let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      // Deduplicate concurrent refresh calls
      if (!refreshPromise) {
        refreshPromise = axios
          .post<{ success: boolean; data: { accessToken: string } }>(
            `${process.env.NEXT_PUBLIC_API_URL}/api/auth/refresh`,
            {},
            { withCredentials: true },
          )
          .then((res) => res.data.data.accessToken)
          .finally(() => {
            refreshPromise = null;
          });
      }

      const newToken = await refreshPromise;
      const { user } = useAuthStore.getState();
      if (user) {
        useAuthStore.getState().setAuth(newToken, user);
      }
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch {
      useAuthStore.getState().logout();
      if (typeof window !== "undefined") {
        window.location.href = "/auth/login";
      }
      return Promise.reject(error);
    }
  },
);

// ── API envelope type ─────────────────────────────────────────────────
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}

// ── Typed helpers ──────────────────────────────────────────────────────
export async function apiGet<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await api.get<ApiEnvelope<T>>(url, { params });
  return res.data.data;
}

export async function apiPost<T>(
  url: string,
  data?: unknown,
): Promise<T> {
  const res = await api.post<ApiEnvelope<T>>(url, data);
  return res.data.data;
}

export async function apiPut<T>(
  url: string,
  data?: unknown,
  /** Custom request headers — used by safety-guard flows that need to
   *  attach a sentinel header (e.g. x-self-demote-confirm). Auth header
   *  is still injected by the interceptor; this merges on top. */
  headers?: Record<string, string>,
): Promise<T> {
  const res = await api.put<ApiEnvelope<T>>(url, data, headers ? { headers } : undefined);
  return res.data.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await api.delete<ApiEnvelope<T>>(url);
  return res.data.data;
}

export type PaginationMeta = NonNullable<ApiEnvelope<unknown>["meta"]>;

export async function apiGetPaginated<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<{ data: T; meta: PaginationMeta }> {
  const res = await api.get<ApiEnvelope<T>>(url, { params });
  return {
    data: res.data.data,
    meta: res.data.meta ?? { page: 1, limit: 10, total: 0, totalPages: 1 },
  };
}

export default api;
