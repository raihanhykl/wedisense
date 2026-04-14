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

// ── Asset types ──────────────────────────────────────────────────────
export interface AssetListItem {
  id: string;
  assetNumber: string;
  name: string;
  status: string;
  condition: string;
  serialNumber: string | null;
  barcodeValue: string;
  purchaseDate: string | null;
  purchasePrice: string | null;
  warrantyEndDate: string | null;
  currentBookValue: string | null;
  product: { id: string; name: string; brand: string | null } | null;
  location: { id: string; name: string; code: string };
  assignedTo: { id: string; name: string; email: string } | null;
}

export interface AssetDetail extends AssetListItem {
  barcodeType: string;
  barcodeImageUrl: string | null;
  currency: string;
  vendor: string | null;
  invoiceNumber: string | null;
  warrantyStartDate: string | null;
  usefulLifeMonths: number | null;
  notes: string | null;
  customFields: Record<string, unknown> | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetFormData {
  productId: string;
  name: string;
  serialNumber: string;
  locationId: string;
  assignedToUserId: string;
  status: string;
  condition: string;
  purchaseDate: string;
  purchasePrice: string;
  vendor: string;
  invoiceNumber: string;
  warrantyStartDate: string;
  warrantyEndDate: string;
  usefulLifeMonths: string;
  notes: string;
}

// ── Movement types ──────────────────────────────────────────────────
export interface MovementListItem {
  id: string;
  movementType: string;
  referenceNumber: string;
  status: string;
  notes: string | null;
  expectedReturnDate: string | null;
  actualReturnDate: string | null;
  createdAt: string;
  asset: { id: string; name: string; assetNumber: string };
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  fromLocation: { id: string; name: string } | null;
  toLocation: { id: string; name: string } | null;
  performedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
}

// ── Maintenance types ──────────────────────────────────────────────
export interface MaintenanceScheduleItem {
  id: string;
  title: string;
  description: string | null;
  frequencyType: string;
  nextDueDate: string;
  lastDoneDate: string | null;
  isActive: boolean;
  asset: { id: string; name: string; assetNumber: string };
  assignedTo: { id: string; name: string } | null;
}

export interface MaintenanceLogItem {
  id: string;
  description: string;
  findings: string | null;
  actionTaken: string | null;
  cost: string | null;
  vendorName: string | null;
  conditionBefore: string;
  conditionAfter: string;
  performedAt: string;
  createdAt: string;
  asset: { id: string; name: string; assetNumber: string };
  schedule: { id: string; title: string } | null;
  performedBy: { id: string; name: string };
}
