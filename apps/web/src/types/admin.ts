// ── Location types ────────────────────────────────────────────────────
import type { LocationTypeValue } from "@/lib/location-types";

export interface LocationNode {
  id: string;
  name: string;
  code: string;
  type: LocationTypeValue;
  isActive: boolean;
  /** Assets pinned directly to this location (excludes descendants). */
  directAssetCount: number;
  /** Assets in this location plus the entire descendant subtree. */
  subtreeAssetCount: number;
  children: LocationNode[];
}

export interface LocationFormData {
  name: string;
  code: string;
  address: string;
  city: string;
  province: string;
  type: LocationTypeValue;
  parentId: string | null;
  isActive: boolean;
}

/** Day-of-week hours. `null` (or absent key) = unspecified; `"closed"` =
 *  explicitly closed; object = open with hh:mm bounds. Matches the
 *  Zod schema in apps/api/src/modules/locations/schema.ts. */
export type LocationDayHours =
  | { open: string; close: string }
  | "closed"
  | null;

export interface LocationOperatingHours {
  mon?: LocationDayHours;
  tue?: LocationDayHours;
  wed?: LocationDayHours;
  thu?: LocationDayHours;
  fri?: LocationDayHours;
  sat?: LocationDayHours;
  sun?: LocationDayHours;
}

export interface LocationFlat {
  id: string;
  name: string;
  code: string;
  type: LocationTypeValue;
  address: string | null;
  city: string | null;
  province: string | null;
  parentId: string | null;
  isActive: boolean;
  // Metadata added in Tier 4. All nullable on the DB side; the frontend
  // treats undefined === null (forms reset() will set defaults regardless).
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  qrCodeImageUrl: string | null;
  contactUserId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  operatingHours: LocationOperatingHours | null;
  customFields: Record<string, unknown> | null;
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
  product: {
    id: string;
    name: string;
    brand: string | null;
    category: { id: string; name: string } | null;
  } | null;
  location: { id: string; name: string; code: string };
  assignedTo: { id: string; name: string; email: string } | null;
}

export interface AssetCategoryOption {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
}

// ── Saved views ──────────────────────────────────────────────────────
// Per-user filter/sort/column configurations for list pages. Server stores
// the config blob as opaque JSON; each list page documents and validates
// its own expected shape.

export interface SavedView {
  id: string;
  userId: string;
  resource: string;
  name: string;
  // Server returns JSON; consumers narrow to their page-specific shape.
  config: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Shape stored in `config` for the asset list. Optional everywhere because
// a partial view is a meaningful concept ("just save my filters, not
// search"). The page's `applyViewConfig` reader treats missing keys as "no
// override".
export interface AssetListViewConfig {
  search?: string;
  statusFilter?: string;
  locationFilter?: string;
  categoryFilter?: string;
  sortField?: string;
  sortOrder?: "asc" | "desc";
}

// Full category record returned by GET /api/asset-categories on the
// management page. The dropdown stub above is a subset of this for old
// callers that only need id/name/code.
export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'NONE';

export interface AssetCategoryDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  parent: { id: string; name: string; code: string } | null;
  depreciationMethod: DepreciationMethod;
  defaultDepreciationRate: number | null;
  defaultUsefulLifeMonths: number | null;
  icon: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  // Aggregated count of products referencing this category. Surfaced
  // alongside the row so admins can see "X products in this category"
  // before deciding whether to delete.
  _count: { products: number };
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

// ── Notification types ──────────────────────────────────────────────
export type NotificationType =
  | "WARRANTY_EXPIRING"
  | "LOAN_OVERDUE"
  | "MAINTENANCE_DUE"
  | "ASSET_LOST"
  | "ASSET_DISPOSED"
  | "REPORT_READY"
  | "PRINT_READY"
  | "IMPORT_COMPLETE"
  | "TOUR_UPDATED";

export interface NotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data: { url?: string; assetId?: string; movementId?: string; [k: string]: unknown } | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

// ── Report types ─────────────────────────────────────────────────────
export type ReportType =
  | "ASSET_LIST"
  | "MOVEMENT"
  | "MAINTENANCE"
  | "DEPRECIATION"
  | "AUDIT"
  | "CUSTOM";

export type ReportStatus = "PENDING" | "GENERATING" | "READY" | "FAILED";

export type ReportFormat = "excel" | "pdf";

export type ReportSchedule = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface ReportItem {
  id: string;
  name: string;
  type: ReportType;
  status: ReportStatus;
  lastGeneratedAt: string | null;
  fileUrl: string | null;
  parameters: Record<string, unknown> | null;
  schedule: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

// ── Asset Import types ────────────────────────────────────────────────
// Shape matches backend `AssetImportRow` in apps/api/src/lib/excel.ts.
// Flat structure — DO NOT change without also updating the backend.
//
// Note: `productId` and `locationId` are either resolved UUIDs OR the raw
// user-typed natural key (name / code / EAN) when the row will create a new
// product. The display values `productLabel` and `locationLabel` are always
// human-readable for use in the preview table.
export interface AssetImportRow {
  rowIndex: number;
  productId: string;
  /** Canonical product name (when resolved) or raw user-typed value (when
   *  new). Use this in any UI rendering. */
  productLabel?: string;
  /** Carries the new-product spec when the parser couldn't match `productId`
   *  to an existing product. The backend creates the product before the
   *  asset insert; the frontend just round-trips this field through confirm. */
  newProductSpec?: {
    name: string;
    categoryName: string;
    brand?: string;
    model?: string;
    eanCode?: string;
  };
  name: string;
  serialNumber?: string;
  status: 'ACTIVE' | 'IDLE' | 'IN_MAINTENANCE' | 'DISPOSED' | 'LOST' | 'BORROWED';
  condition: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED';
  locationId: string;
  /** Canonical location name (always set once the parser resolved). */
  locationLabel?: string;
  assignedToUserId?: string;
  purchaseDate?: string;
  purchasePrice?: number;
  currency: string;
  vendor?: string;
  invoiceNumber?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
  usefulLifeMonths?: number;
  notes?: string;
}

export interface AssetImportError {
  rowIndex: number;
  field: string;
  message: string;
  value?: unknown;
  /** Snapshot of every recognised column's raw value for this row. Used by
   *  the inline-repair UI to prefill the editor. Multiple errors on the
   *  same row carry the same snapshot — the editor de-duplicates them. */
  rawValues?: Record<string, string>;
}

/** Single canonical-key → worksheet-column resolution as returned by the
 *  backend. `source` lets the UI show users where a mapping came from
 *  (exact = template match, synonym = fuzzy match, manual = user override). */
export interface AssetImportColumnMappingItem {
  columnNumber: number;
  actualHeader: string;
  source: 'exact' | 'synonym' | 'manual';
}

/** Backend's view of the column mapping for a given upload. The mapping
 *  panel uses `headers` to populate dropdowns and `mapping` to highlight
 *  the currently-selected column per canonical field. */
export interface AssetImportDetectedMapping {
  mapping: Partial<Record<string, AssetImportColumnMappingItem>>;
  headers: Array<{ columnNumber: number; text: string }>;
  requiredMissing: string[];
}

export interface AssetImportPreviewResponse {
  mode: 'sync';
  preview: AssetImportRow[];
  parseErrors: AssetImportError[];
  validatedRows: AssetImportRow[];
  rowCount: number;
  /** Rows whose serial already matches a live asset — they will be skipped
   *  (not error) at commit. Surface this in the Review step so the user
   *  isn't surprised by the Result count. */
  willSkip: AssetImportSkipped[];
  /** How the backend interpreted the file's column headers. Always present
   *  for fresh uploads; the UI can hide the panel when every field was an
   *  exact match. */
  detectedMapping?: AssetImportDetectedMapping;
}

export interface AssetImportAsyncResponse {
  mode: 'async';
  importId: string;
  rowCount: number;
  parseErrors: AssetImportError[];
  message: string;
  detectedMapping?: AssetImportDetectedMapping;
}

export type AssetImportResponse =
  | AssetImportPreviewResponse
  | AssetImportAsyncResponse;

export interface AssetImportSkipped {
  rowIndex: number;
  reason: 'duplicate_serial';
  existing: {
    id: string;
    assetNumber: string;
    name: string;
    serialNumber: string;
  };
}

// Polled status payload for async imports (file >= 5000 rows).
// Returned by GET /api/assets/import/:importId/status.
export interface AssetImportStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: { processed: number; total: number };
  created?: number;
  skipped?: number;
  failed?: number;
  error?: string;
  result?: { errors: AssetImportError[] };
}

export interface AssetImportConfirmResponse {
  /** Number of new assets actually created in this run. */
  created: number;
  /** Number of rows skipped because the asset already exists (duplicate serial). */
  skipped: number;
  /** Number of rows that failed validation or insert. */
  failed: number;
  /** Per-row failure details. */
  errors: AssetImportError[];
  /** Per-row skip details (so the UI can link to the existing asset). */
  skippedRows: AssetImportSkipped[];
  /** Newly created assets — useful for "view imported" navigation. */
  assets: Array<{ id: string; assetNumber: string; name: string }>;
}

// ── Dashboard types ───────────────────────────────────────────────────
export interface DashboardSummary {
  totalAssets: number;
  totalAssetsLastMonth: number;
  totalBookValue: string;
  totalBookValueLastMonth: string;
  newAssetsThisMonth: number;
  byStatus: { status: string; count: number }[];
  byCondition: { condition: string; count: number }[];
}

export interface DashboardAlerts {
  warrantyExpiring: number;
  loanOverdue: number;
  maintenanceDue: number;
  unreadNotifications: number;
}

export interface RecentMovement {
  id: string;
  referenceNumber: string;
  movementType: string;
  status: string;
  createdAt: string;
  asset: { id: string; assetNumber: string; name: string };
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  fromLocation: { id: string; name: string } | null;
  toLocation: { id: string; name: string } | null;
  performedBy: { id: string; name: string };
}

export interface AssetsByLocation {
  locationId: string;
  locationName: string;
  count: number;
}

export interface AssetsByCategory {
  categoryId: string;
  categoryName: string;
  count: number;
}

export interface DepreciationSummary {
  totalPurchasePrice: string;
  totalCurrentBookValue: string;
  totalDepreciation: string;
  byCategory: {
    categoryId: string;
    categoryName: string;
    purchasePrice: string;
    currentBookValue: string;
    depreciationPercent: number;
  }[];
}

// ── Label & Print types ─────────────────────────────────────────────
export interface LabelField {
  type: 'barcode' | 'qr_code' | 'text' | 'field' | 'divider';
  field_key?: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  font_size?: number;
  bold?: boolean;
  custom_value?: string;
}

export interface LabelTemplateItem {
  id: string;
  name: string;
  description: string | null;
  paperWidthMm: number;
  paperHeightMm: number;
  isDefault: boolean;
  fields: LabelField[];
  createdAt: string;
}

export interface PrintJobItem {
  id: string;
  status: string;
  copiesPerAsset: number;
  pdfUrl: string | null;
  createdAt: string;
  labelTemplate: { id: string; name: string };
}

// ── Audit Log types ───────────────────────────────────────────────────

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT'
  | 'IMPORT'
  | 'PRINT'
  | 'APPROVE'
  | 'REJECT';

export interface AuditLogDto {
  id: string;
  userId: string | null;
  user: { id: string; name: string; email: string } | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  /** null in list response; populated in detail (/api/audit-logs/:id) */
  oldValues: unknown | null;
  /** null in list response; populated in detail (/api/audit-logs/:id) */
  newValues: unknown | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string; // ISO string
}

export interface AuditLogFilters {
  search: string;
  action: string;
  resourceType: string;
  resourceTypeCustom: string;
  userId: string;
  dateFrom: string;
  dateTo: string;
}

// ── Tour types ────────────────────────────────────────────────────────
export type TourStepPosition = 'top' | 'bottom' | 'left' | 'right' | 'auto';
export type TourProgressAction = 'next' | 'prev' | 'skip' | 'complete';

export interface TourStepDto {
  stepIndex: number;
  title: string;         // i18n key, e.g. "tours.admin.dashboard.title"
  description: string;   // i18n key
  targetElement: string; // CSS selector or `[data-tour='asset-list']`
  position: TourStepPosition;
  requiredPermission: { resource: string; action: string } | null;
  route: string;
  isActive: boolean;
}

export interface TourProgressDto {
  completedSteps: number[];
  lastStepIndex: number;
  isCompleted: boolean;
  isSkipped: boolean;
  lastSeenAt: string | null;
}

export interface TourDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  roleId: string;
  roleName: string;
  steps: TourStepDto[];
  progress: TourProgressDto | null;
}

// ── Procurement (Phase 17) ────────────────────────────────────────────

export type PurchaseOrderStatus =
  | "OPEN"
  | "PARTIALLY_RECEIVED"
  | "FULLY_RECEIVED"
  | "CLOSED"
  | "CANCELLED";

export type ProcurementBatchStatus =
  | "DRAFT"
  | "ITEMS_PENDING"
  | "RECEIVED"
  | "COMPLETED"
  | "CANCELLED";

// Phase 17 v2 — vendor is a relation. The list endpoint embeds the
// nested object so the table renders a name without follow-up queries;
// the detail endpoint embeds extra contact fields.
export interface VendorSummary {
  id: string;
  name: string;
}

export interface VendorRow {
  id: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  isActive?: boolean;
}

export interface PurchaseOrderListItem {
  id: string;
  poNumber: string;
  name: string | null;
  status: PurchaseOrderStatus;
  vendor: VendorSummary;
  poDate: string;
  expectedDeliveryDate: string | null;
  currency: string;
  // Phase 17 v2 — three computed totals stored denormalised.
  untaxedAmount: string;
  totalTaxes: string;
  totalAmount: string;
  batchCount: number;
  assetCount: number;
  createdByUserId: string;
  closedByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** _count{items, batches} returned by the API for tree-list rendering. */
  _count?: { items: number; batches: number };
}

export interface PurchaseOrderBatchSummary {
  id: string;
  batchNumber: string;
  name: string | null;
  status: ProcurementBatchStatus;
  bastNumber: string | null;
  bastDate: string | null;
  receivedDate: string | null;
  assetCount: number;
  totalAmount: string | null;
  createdAt: string;
}

export interface PurchaseOrderItemRow {
  id: string;
  productId: string;
  qty: number;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  untaxedAmount: string;
  taxAmount: string;
  totalAmount: string;
  sortOrder: number;
  notes: string | null;
  product: {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    eanCode: string | null;
    category: { id: string; name: string; code: string };
  };
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderListItem, "vendor"> {
  description: string | null;
  poUrl: string | null;
  notes: string | null;
  attachments: Array<{
    filename: string;
    url: string;
    contentType?: string;
    uploadedAt?: string;
  }> | null;
  customFields: Record<string, unknown> | null;
  vendor: {
    id: string;
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    contactPerson: string | null;
  };
  createdBy: { id: string; name: string; email: string };
  closedBy: { id: string; name: string; email: string } | null;
  items: PurchaseOrderItemRow[];
  batches: PurchaseOrderBatchSummary[];
}

export interface ProcurementBatchListItem {
  id: string;
  // Phase 17 v2: purchaseOrder is now mandatory (direct-purchase removed).
  purchaseOrderId: string;
  batchNumber: string;
  name: string | null;
  status: ProcurementBatchStatus;
  bastNumber: string | null;
  bastDate: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  purchaseDate: string;
  receivedDate: string | null;
  currency: string;
  totalAmount: string;
  assetCount: number;
  receivedByUserId: string | null;
  receivedByName: string | null;
  createdByUserId: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: PurchaseOrderStatus;
    vendor: { id: string; name: string };
  };
}

export interface ProcurementBatchAssetEntry {
  id: string;
  assetNumber: string;
  name: string;
  serialNumber: string | null;
  status: 'ACTIVE' | 'IDLE' | 'IN_MAINTENANCE' | 'DISPOSED' | 'LOST' | 'BORROWED';
  condition: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED';
  locationId: string;
  assignedToUserId: string | null;
  createdAt: string;
}

// Phase 17 v2 — per-line receipt tracking. Each batch item references a
// PO line item; the API embeds the line so the UI can show qty + price
// + product info without a follow-up query.
export interface BatchItemRow {
  id: string;
  purchaseOrderItemId: string;
  qtyReceived: number;
  notes: string | null;
  createdAt: string;
  purchaseOrderItem: {
    id: string;
    qty: number;
    unitPrice: string;
    discountPercent: string;
    taxPercent: string;
    sortOrder: number;
    product: {
      id: string;
      name: string;
      brand: string | null;
      model: string | null;
    };
  };
}

export interface ProcurementBatchDetail extends Omit<ProcurementBatchListItem, "purchaseOrder"> {
  bastUrl: string | null;
  invoiceUrl: string | null;
  taxInvoiceNumber: string | null;
  taxInvoiceDate: string | null;
  defaultLocationId: string | null;
  defaultCategoryId: string | null;
  receivedByPosition: string | null;
  notes: string | null;
  attachments: Array<{
    filename: string;
    url: string;
    contentType?: string;
    uploadedAt?: string;
  }> | null;
  customFields: Record<string, unknown> | null;
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: PurchaseOrderStatus;
    poDate: string;
    vendor: { id: string; name: string };
  };
  defaultLocation: { id: string; name: string; code: string } | null;
  defaultCategory: { id: string; name: string; code: string } | null;
  createdBy: { id: string; name: string; email: string };
  receivedBy: { id: string; name: string; email: string | null } | null;
  completedBy: { id: string; name: string; email: string } | null;
  items: BatchItemRow[];
  assets: ProcurementBatchAssetEntry[];
}

export interface BatchAuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  old_values: unknown;
  new_values: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
