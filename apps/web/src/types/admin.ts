// ── Location types ────────────────────────────────────────────────────
export interface LocationNode {
  id: string;
  name: string;
  code: string;
  type: string;
  isActive: boolean;
  children: LocationNode[];
}

export interface LocationFormData {
  name: string;
  code: string;
  address: string;
  city: string;
  province: string;
  type: string;
  parentId: string | null;
  isActive: boolean;
}

export interface LocationFlat {
  id: string;
  name: string;
  code: string;
  type: string;
  address: string;
  city: string;
  province: string;
  parentId: string | null;
  isActive: boolean;
}

// ── User types ────────────────────────────────────────────────────────
export interface UserRoleAssignment {
  roleId: string;
  locationId: string | null;
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  phone: string | null;
  status: string;
  userRoles: {
    id: string;
    roleId: string;
    locationId: string | null;
    role: { id: string; name: string };
    location: { id: string; name: string } | null;
  }[];
}

export interface UserFormData {
  name: string;
  email: string;
  password?: string;
  employeeId: string;
  phone: string;
  status: string;
}

// ── Role & Permission types ──────────────────────────────────────────
export interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissionCount: number;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string;
}
