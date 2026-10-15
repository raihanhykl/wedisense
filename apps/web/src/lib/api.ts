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

/**
 * Fetches a binary response (PDF) as a Blob.
 *
 * Needed because the handover-form PDF and its signed scan are behind
 * `authorize()`, so they can't be opened with a plain `window.open(url)` the
 * way public /uploads artifacts can — the browser would send no Authorization
 * header and get a 401. Callers wrap the result in `URL.createObjectURL()`
 * and MUST revoke it when done.
 */
export async function apiGetBlob(url: string): Promise<Blob> {
  const res = await api.get<Blob>(url, { responseType: "blob" });
  return res.data;
}

/**
 * Posts multipart form data.
 *
 * The `Content-Type: application/json` default on the axios instance MUST be
 * cleared here. Axios does not merely mislabel the request when that header
 * is present — it silently rewrites the body:
 *
 *   isFormData ? (hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data)
 *
 * so the file never leaves the browser and multer sees no multipart body at
 * all. Passing `null` removes the header, which makes axios detect the
 * FormData and let the browser set `multipart/form-data` with its boundary.
 */
export async function apiPostForm<T>(url: string, formData: FormData): Promise<T> {
  const res = await api.post<ApiEnvelope<T>>(url, formData, {
    headers: { "Content-Type": null },
  });
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
