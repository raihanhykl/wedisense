// ── SMS (Stock Management System) ──────────────────────────
//
// Permissions are deliberately fine-grained and always evaluated together
// with a location ("may this user do X at showroom L?"). One showroom admin
// holds nearly all of them today; keeping them separate means a supervisor
// role can be introduced later from the Roles screen, without a code change.

export const SMS_PERMISSIONS = {
  /** See stock, VIN cards, shipments and queues at a showroom. */
  STOCK_VIEW: 'sms-stock:view',
  /** See customer identity fields (name, phone, ID number). */
  CUSTOMERS_VIEW: 'sms-customers:view',
  /** Import a manifest / opening balance and confirm physical receipt. */
  RECEIVING_MANAGE: 'sms-receiving:manage',
  /** Book, cancel, record a sale, confirm pickup, receive a sale return. */
  ORDERS_MANAGE: 'sms-orders:manage',
  /** Decide a sale return (approve / reject). */
  SALE_RETURNS_DECIDE: 'sms-sale-returns:decide',
  /** RTO handover, same-branch return, contract closure, ownership transfer. */
  RTO_MANAGE: 'sms-rto:manage',
  /** Ask to receive another showroom's unit (cross-branch return). */
  RETURNS_REQUEST: 'sms-returns:request',
  /** Approve / reject a cross-branch return, evaluated at the origin showroom. */
  RETURNS_DECIDE: 'sms-returns:decide',
  /** Record inspections and release a unit back to available stock. */
  INSPECTIONS_MANAGE: 'sms-inspections:manage',
  /** Send a unit to an event and receive it back. */
  SHOW_UNITS_MANAGE: 'sms-show-units:manage',
  /** Correct or void a final transaction. A reason is always required. */
  CORRECTIONS_APPLY: 'sms-corrections:apply',
  /** Stock recap and mutation export. */
  REPORTS_EXPORT: 'sms-reports:export',
  /** Maintain the product master (model / variant / colour). */
  MASTER_MANAGE: 'sms-master:manage',
} as const;

export type SmsPermission = (typeof SMS_PERMISSIONS)[keyof typeof SMS_PERMISSIONS];

export const SMS_PERMISSION_LIST: readonly SmsPermission[] = Object.values(SMS_PERMISSIONS);

export const SMS_PERMISSION_PREFIX = 'sms-';

/**
 * Preset roles created by the system seed when they do not exist yet.
 *
 * They are ordinary (non-system) roles on purpose: the system-role guard
 * forbids editing a system role's permissions, and these presets are meant
 * to be tuned from the Roles screen as the team grows. The seed therefore
 * never touches a preset that already exists.
 */
export const SMS_ROLE_PRESETS: ReadonlyArray<{
  name: string;
  description: string;
  permissions: readonly SmsPermission[];
}> = [
  {
    name: 'SMS_SHOWROOM_ADMIN',
    description:
      'Stock admin of a showroom: receiving, bookings, sales, RTO, returns, inspections, show units, corrections and exports. Assign with a showroom scope.',
    permissions: [
      SMS_PERMISSIONS.STOCK_VIEW,
      SMS_PERMISSIONS.CUSTOMERS_VIEW,
      SMS_PERMISSIONS.RECEIVING_MANAGE,
      SMS_PERMISSIONS.ORDERS_MANAGE,
      SMS_PERMISSIONS.SALE_RETURNS_DECIDE,
      SMS_PERMISSIONS.RTO_MANAGE,
      SMS_PERMISSIONS.RETURNS_REQUEST,
      SMS_PERMISSIONS.RETURNS_DECIDE,
      SMS_PERMISSIONS.INSPECTIONS_MANAGE,
      SMS_PERMISSIONS.SHOW_UNITS_MANAGE,
      SMS_PERMISSIONS.CORRECTIONS_APPLY,
      SMS_PERMISSIONS.REPORTS_EXPORT,
    ],
  },
  {
    name: 'SMS_CENTRAL_OPS',
    description:
      'Central operations: network-wide stock view, product master, exports, and deciding cross-branch returns. Assign without a location scope.',
    permissions: [
      SMS_PERMISSIONS.STOCK_VIEW,
      SMS_PERMISSIONS.CUSTOMERS_VIEW,
      SMS_PERMISSIONS.MASTER_MANAGE,
      SMS_PERMISSIONS.REPORTS_EXPORT,
      SMS_PERMISSIONS.RETURNS_DECIDE,
    ],
  },
  {
    name: 'SMS_SALES',
    description:
      'Sales with an account: check availability at the showrooms they are assigned to. Daily input stays with the showroom admin.',
    permissions: [SMS_PERMISSIONS.STOCK_VIEW],
  },
];

/**
 * Location types that can hold motorcycle stock. Branches are included
 * because some branches sell directly without a separate showroom node.
 */
export const SMS_STOCK_LOCATION_TYPES = ['SHOWROOM', 'BRANCH'] as const;

/** Header carrying the client-generated key that makes a mutation exactly-once. */
export const SMS_IDEMPOTENCY_HEADER = 'idempotency-key';
