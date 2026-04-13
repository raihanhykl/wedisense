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
  children: LocationTreeNode[];
}

export interface LocationListFilters {
  type?: LocationType;
  isActive?: boolean;
  search?: string;
}
