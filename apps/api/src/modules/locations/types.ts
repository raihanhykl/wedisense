import type { LocationType } from '@prisma/client';

export interface LocationTreeNode {
  id: string;
  name: string;
  code: string;
  type: LocationType;
  parentId: string | null;
  isActive: boolean;
  address: string | null;
  city: string | null;
  province: string | null;
  /** Assets pinned to this exact location (not descendants). */
  directAssetCount: number;
  /** Assets in this location plus the entire descendant subtree. */
  subtreeAssetCount: number;
  children: LocationTreeNode[];
}

export interface LocationListFilters {
  type?: LocationType;
  isActive?: boolean;
  search?: string;
}
