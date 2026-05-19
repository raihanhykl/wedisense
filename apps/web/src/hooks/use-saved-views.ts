"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { SavedView } from "@/types/admin";

// ── Query key conventions ────────────────────────────────────────────
// Single namespace per resource so invalidating after a mutation is a
// one-liner. Resource is part of the key so a future "movements" list
// adding saved views doesn't fight for cache slots with the asset list.

const savedViewsKey = (resource: string) =>
  ["saved-views", resource] as const;

interface CreateInput {
  resource: string;
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
}

interface UpdateInput {
  id: string;
  name?: string;
  config?: Record<string, unknown>;
  isDefault?: boolean;
}

/**
 * Manages saved views for one resource (e.g. "assets"). The query refetches
 * on mount and after each mutation; we don't poll because views are user-
 * owned and rarely change from outside the user's own actions.
 */
export function useSavedViews(resource: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: savedViewsKey(resource),
    queryFn: () =>
      apiGet<SavedView[]>(`/api/saved-views`, { resource }),
    // Saved views are tiny and rarely change — a generous staleTime keeps
    // navigation snappy.
    staleTime: 60_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: savedViewsKey(resource) });

  const create = useMutation({
    mutationFn: (input: CreateInput) => apiPost<SavedView>("/api/saved-views", input),
    onSuccess: () => void invalidate(),
  });

  const update = useMutation({
    mutationFn: ({ id, ...rest }: UpdateInput) =>
      apiPut<SavedView>(`/api/saved-views/${id}`, rest),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ deleted: true }>(`/api/saved-views/${id}`),
    onSuccess: () => void invalidate(),
  });

  return {
    views: query.data ?? [],
    isLoading: query.isLoading,
    create,
    update,
    remove,
  };
}
