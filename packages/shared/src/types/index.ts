// ── Enums ──────────────────────────────────────────────────

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  RESIGNED: 'RESIGNED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const AssetStatus = {
  ACTIVE: 'ACTIVE',
  IDLE: 'IDLE',
  IN_MAINTENANCE: 'IN_MAINTENANCE',
  DISPOSED: 'DISPOSED',
  LOST: 'LOST',
  BORROWED: 'BORROWED',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const AssetCondition = {
  NEW: 'NEW',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  POOR: 'POOR',
  DAMAGED: 'DAMAGED',
} as const;
export type AssetCondition = (typeof AssetCondition)[keyof typeof AssetCondition];

export const MovementType = {
  ASSIGNMENT: 'ASSIGNMENT',
  UNASSIGNMENT: 'UNASSIGNMENT',
  LOCATION_TRANSFER: 'LOCATION_TRANSFER',
  LOAN_OUT: 'LOAN_OUT',
  LOAN_RETURN: 'LOAN_RETURN',
  RESIGNATION_RETURN: 'RESIGNATION_RETURN',
  SWAP: 'SWAP',
  SEND_TO_MAINTENANCE: 'SEND_TO_MAINTENANCE',
  RETURN_FROM_MAINTENANCE: 'RETURN_FROM_MAINTENANCE',
  DISPOSAL: 'DISPOSAL',
  FOUND: 'FOUND',
  LOST: 'LOST',
  INITIAL: 'INITIAL',
} as const;
export type MovementType = (typeof MovementType)[keyof typeof MovementType];

export const MovementStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type MovementStatus = (typeof MovementStatus)[keyof typeof MovementStatus];

export const LocationType = {
  HEAD_OFFICE: 'HEAD_OFFICE',
  BRANCH: 'BRANCH',
  FACTORY: 'FACTORY',
  SHOWROOM: 'SHOWROOM',
  SERVICE_CENTER: 'SERVICE_CENTER',
  OTHER: 'OTHER',
} as const;
export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const BarcodeType = {
  CODE128: 'CODE128',
  QR: 'QR',
} as const;
export type BarcodeType = (typeof BarcodeType)[keyof typeof BarcodeType];

export const DepreciationMethod = {
  STRAIGHT_LINE: 'STRAIGHT_LINE',
  DECLINING_BALANCE: 'DECLINING_BALANCE',
  NONE: 'NONE',
} as const;
export type DepreciationMethod = (typeof DepreciationMethod)[keyof typeof DepreciationMethod];

export const FrequencyType = {
  ONE_TIME: 'ONE_TIME',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
} as const;
export type FrequencyType = (typeof FrequencyType)[keyof typeof FrequencyType];

export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  PRINT: 'PRINT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const NotificationType = {
  WARRANTY_EXPIRING: 'WARRANTY_EXPIRING',
  LOAN_OVERDUE: 'LOAN_OVERDUE',
  MAINTENANCE_DUE: 'MAINTENANCE_DUE',
  ASSET_LOST: 'ASSET_LOST',
  REPORT_READY: 'REPORT_READY',
  PRINT_READY: 'PRINT_READY',
  IMPORT_COMPLETE: 'IMPORT_COMPLETE',
  ASSET_DISPOSED: 'ASSET_DISPOSED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const ReportType = {
  ASSET_LIST: 'ASSET_LIST',
  MOVEMENT: 'MOVEMENT',
  MAINTENANCE: 'MAINTENANCE',
  DEPRECIATION: 'DEPRECIATION',
  AUDIT: 'AUDIT',
  CUSTOM: 'CUSTOM',
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];

export const ProductSource = {
  API_UPCITEMDB: 'API_UPCITEMDB',
  API_BARCODELOOKUP: 'API_BARCODELOOKUP',
  MANUAL: 'MANUAL',
} as const;
export type ProductSource = (typeof ProductSource)[keyof typeof ProductSource];

export const Language = {
  EN: 'en',
  ID: 'id',
} as const;
export type Language = (typeof Language)[keyof typeof Language];

// ── API Response Types ─────────────────────────────────────

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}
