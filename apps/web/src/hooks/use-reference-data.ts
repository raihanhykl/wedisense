"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, apiGetPaginated } from "@/lib/api";
import type { LocationTypeValue } from "@/lib/location-types";
import type { AssetCategoryOption } from "@/types/admin";

// ── Shape stubs ─────────────────────────────────────────────────────
// Kept local to the hook because nothing else in the app needs a generic
// "product reference" or "location reference" type — pages that need richer
// data fetch their own.

export interface ProductOption {
  id: string;
  name: string;
  brand: string | null;
}

export interface LocationOption {
  id: string;
  name: string;
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
}

// ── Query keys ──────────────────────────────────────────────────────
// Centralised so invalidations (e.g. after creating a new product) target
// the exact entry rather than blowing the entire cache.
export const referenceQueryKeys = {
  products: (search: string) => ["ref", "products", search] as const,
  locations: () => ["ref", "locations"] as const,
  users: () => ["ref", "users"] as const,
  categories: () => ["ref", "categories"] as const,
};

// ── Hooks ───────────────────────────────────────────────────────────

/**
 * Product autocomplete. Caches per search term — typing "lap" → "lapt" → "laptop"
 * creates three independent cache entries, each living 5 min after last use.
 * Empty string is the "all products" listing, which is what asset-form opens
 * with.
 */
export function useProducts(search: string) {
  return useQuery({
    queryKey: referenceQueryKeys.products(search),
    queryFn: async () => {
      const data = await apiGet<ProductOption[]>("/api/products", {
        search,
        limit: 50,
      });
      return data;
    },
  });
}

/**
 * Locations — small list, rarely changes. `apiGetPaginated` returns
 * `{ data, meta }`; we project to just the array for ergonomics.
 */
export function useLocations() {
  return useQuery({
    queryKey: referenceQueryKeys.locations(),
    queryFn: async () => {
      const result = await apiGetPaginated<LocationOption[]>("/api/locations", {
        limit: 100,
      });
      return result.data;
    },
  });
}

/**
 * Hierarchical view of the same locations, used by the tree picker. Same
 * data set as `useLocations` so the network cost is small; the shape
 * difference (nested vs flat) is what matters to consumers.
 */
export interface LocationTreeNode {
  id: string;
  name: string;
  code: string;
  type: LocationTypeValue;
  isActive: boolean;
  /** Assets pinned directly to this location (excludes descendants). */
  directAssetCount: number;
  /** Assets in this location plus the entire descendant subtree. */
  subtreeAssetCount: number;
  children: LocationTreeNode[];
}

export function useLocationTree() {
  return useQuery({
    queryKey: ["ref", "locations", "tree"] as const,
    queryFn: () => apiGet<LocationTreeNode[]>("/api/locations/tree"),
  });
}

/**
 * Users — population of available assignees. Refetched only when staleTime
 * elapses or after a manual invalidation (e.g. after creating a new user).
 */
export function useUsers() {
  return useQuery({
    queryKey: referenceQueryKeys.users(),
    queryFn: async () => {
      const data = await apiGet<UserOption[]>("/api/users", { limit: 100 });
      return data;
    },
  });
}

/**
 * Asset categories — drives the category filter on the asset list and the
 * required field in the new-product dialog.
 */
export function useAssetCategories() {
  return useQuery({
    queryKey: referenceQueryKeys.categories(),
    queryFn: async () => {
      const data = await apiGet<AssetCategoryOption[]>("/api/asset-categories");
      return data;
    },
  });
}
