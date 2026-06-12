// ── System Roles ───────────────────────────────────────────

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
  VIEWER: 'VIEWER',
} as const;

// ── Permissions ────────────────────────────────────────────

export const PERMISSIONS = {
  ASSETS_CREATE: 'assets:create',
  ASSETS_READ: 'assets:read',
  ASSETS_UPDATE: 'assets:update',
  ASSETS_DELETE: 'assets:delete',
  ASSETS_EXPORT: 'assets:export',
  ASSETS_IMPORT: 'assets:import',
  ASSETS_PRINT: 'assets:print',
  MOVEMENTS_CREATE: 'movements:create',
  MOVEMENTS_APPROVE: 'movements:approve',
  MAINTENANCE_MANAGE: 'maintenance:manage',
  REPORTS_VIEW: 'reports:view',
  REPORTS_GENERATE: 'reports:generate',
  USERS_MANAGE: 'users:manage',
  ROLES_MANAGE: 'roles:manage',
  AUDIT_READ: 'audit:read',
  LABELS_MANAGE: 'labels:manage',
  TOURS_MANAGE: 'tours:manage',
  PRODUCTS_MANAGE: 'products:manage',
  PRODUCTS_DELETE: 'products:delete',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── Default Permission Matrix ──────────────────────────────

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [SYSTEM_ROLES.ADMIN]: [
    PERMISSIONS.ASSETS_CREATE,
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_UPDATE,
    PERMISSIONS.ASSETS_DELETE,
    PERMISSIONS.ASSETS_EXPORT,
    PERMISSIONS.ASSETS_IMPORT,
    PERMISSIONS.ASSETS_PRINT,
    PERMISSIONS.MOVEMENTS_CREATE,
    PERMISSIONS.MOVEMENTS_APPROVE,
    PERMISSIONS.MAINTENANCE_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.LABELS_MANAGE,
    PERMISSIONS.TOURS_MANAGE,
    PERMISSIONS.PRODUCTS_MANAGE,
  ],
  [SYSTEM_ROLES.MANAGER]: [
    PERMISSIONS.ASSETS_CREATE,
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_UPDATE,
    PERMISSIONS.ASSETS_EXPORT,
    PERMISSIONS.ASSETS_PRINT,
    PERMISSIONS.MOVEMENTS_CREATE,
    PERMISSIONS.MOVEMENTS_APPROVE,
    PERMISSIONS.MAINTENANCE_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
  ],
  [SYSTEM_ROLES.STAFF]: [
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_PRINT,
    PERMISSIONS.MOVEMENTS_CREATE,
    PERMISSIONS.REPORTS_VIEW,
  ],
  [SYSTEM_ROLES.VIEWER]: [
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.REPORTS_VIEW,
  ],
};

// ── Asset Number Format ────────────────────────────────────

export const ASSET_NUMBER_PREFIX = 'WDS';
// {CATEGORY_PATH} is the hierarchical category code path, parent codes
// first, joined by "/" — e.g. "IT/NB" for a Notebook category under IT.
export const ASSET_NUMBER_FORMAT = `${ASSET_NUMBER_PREFIX}-{CATEGORY_PATH}-{YEAR}-{SEQ}`;
export const MOVEMENT_REF_PREFIX = 'MOV';

// ── Pagination Defaults ────────────────────────────────────

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// ── Auth ───────────────────────────────────────────────────

export const AUTH = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  BCRYPT_ROUNDS: 12,
} as const;

// ── Rate Limiting ──────────────────────────────────────────

export const RATE_LIMIT = {
  GENERAL: { windowMs: 60_000, max: 100 },
  AUTH: { windowMs: 60_000, max: 10 },
} as const;

// ── File Upload ────────────────────────────────────────────

export const FILE_UPLOAD = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ],
} as const;

// ── i18n Namespaces ────────────────────────────────────────

export const I18N_NAMESPACES = [
  'common',
  'auth',
  'assets',
  'movements',
  'maintenance',
  'reports',
  'notifications',
  'tours',
  'errors',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
