/**
 * Display vocabulary for the Stock Management screens: one place for the
 * wording and colour of every unit status and ledger event, so the dashboard,
 * the unit list and the VIN card always say the same thing.
 */

export type SmsUnitStatus =
  | "AVAILABLE"
  | "BOOKED"
  | "SOLD_PENDING_PICKUP"
  | "PICKED_UP"
  | "ACTIVE_RTO"
  | "CUSTODY"
  | "INSPECTION"
  | "SHOW_UNIT"
  | "IDENTITY_MISMATCH";

export const UNIT_STATUS_LABEL: Record<SmsUnitStatus, string> = {
  AVAILABLE: "Ready",
  BOOKED: "Booked",
  SOLD_PENDING_PICKUP: "Sold · awaiting pickup",
  PICKED_UP: "With customer",
  ACTIVE_RTO: "Active RTO",
  CUSTODY: "In custody",
  INSPECTION: "Inspection",
  SHOW_UNIT: "Out at event",
  IDENTITY_MISMATCH: "Identity mismatch",
};

/** One-line explanation shown under the status on the VIN card. */
export const UNIT_STATUS_HINT: Record<SmsUnitStatus, string> = {
  AVAILABLE: "In the showroom and can be offered.",
  BOOKED: "Locked for a customer through an SPK.",
  SOLD_PENDING_PICKUP: "Sold. Still in the showroom until the customer picks it up.",
  PICKED_UP: "Handed over to the customer.",
  ACTIVE_RTO: "With the customer under a rent-to-own contract.",
  CUSTODY: "Left at this showroom; the cross-branch return is not officially received yet.",
  INSPECTION: "In the showroom but held until it is inspected and released.",
  SHOW_UNIT: "Out at an event and held by the person in charge.",
  IDENTITY_MISMATCH: "Arrived with an identity that differs from the manifest. Reconcile before offering.",
};

/** Tailwind classes for the status pill. */
export const UNIT_STATUS_STYLE: Record<SmsUnitStatus, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  BOOKED: "bg-amber-100 text-amber-800",
  SOLD_PENDING_PICKUP: "bg-orange-100 text-orange-800",
  PICKED_UP: "bg-slate-100 text-slate-700",
  ACTIVE_RTO: "bg-blue-100 text-blue-800",
  CUSTODY: "bg-purple-100 text-purple-800",
  INSPECTION: "bg-yellow-100 text-yellow-800",
  SHOW_UNIT: "bg-cyan-100 text-cyan-800",
  IDENTITY_MISMATCH: "bg-red-100 text-red-800",
};

export function unitStatusLabel(status: string): string {
  return UNIT_STATUS_LABEL[status as SmsUnitStatus] ?? status;
}

export const UNIT_EVENT_LABEL: Record<string, string> = {
  OPENING_BALANCE: "Entered as opening balance",
  RECEIPT_OK: "Received in good condition",
  RECEIPT_DAMAGED: "Received with damage",
  IDENTITY_MISMATCH_FOUND: "Arrived with a different identity",
  IDENTITY_RESOLVED: "Identity reconciled",
  INSPECTION_STARTED: "Inspection opened",
  INSPECTION_PASSED: "Inspection passed",
  INSPECTION_FAILED: "Inspection failed",
  UNIT_RELEASED: "Released as ready",
  BOOKING_CREATED: "Booked",
  BOOKING_CANCELLED: "Booking cancelled",
  SALE_RECORDED: "Sale recorded",
  PICKUP_CONFIRMED: "Picked up by customer",
  SALE_RETURN_RECEIVED: "Sale return received",
  SALE_RETURN_APPROVED: "Sale return approved",
  SALE_RETURN_REJECTED: "Sale return rejected",
  RTO_STARTED: "RTO handover",
  RTO_RETURNED: "Returned from RTO",
  RTO_OWNERSHIP_TRANSFERRED: "Ownership transferred to customer",
  RTO_CONTRACT_CLOSED: "RTO contract closed",
  RETURN_REQUESTED: "Cross-branch return requested",
  RETURN_APPROVED: "Cross-branch return approved",
  RETURN_REJECTED: "Cross-branch return rejected",
  CUSTODY_RECEIVED: "Left in custody",
  CUSTODY_HANDED_BACK: "Handed back to rider",
  OFFICIAL_RECEIPT_CONFIRMED: "Officially received",
  SHOW_UNIT_DISPATCHED: "Sent to event",
  SHOW_UNIT_RETURNED: "Returned from event",
  EVENT_VOIDED: "Entry voided",
};

export function unitEventLabel(eventType: string): string {
  return UNIT_EVENT_LABEL[eventType] ?? eventType;
}

// ── Order line status ─────────────────────────────────────────────────

export const ORDER_LINE_STATUS_LABEL: Record<string, string> = {
  BOOKED: "Booked",
  SOLD: "Sold",
  PICKED_UP: "Picked up",
  RTO_HANDED_OVER: "Handed over (RTO)",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
};

export const ORDER_LINE_STATUS_STYLE: Record<string, string> = {
  BOOKED: "bg-amber-100 text-amber-800",
  SOLD: "bg-orange-100 text-orange-800",
  PICKED_UP: "bg-slate-100 text-slate-700",
  RTO_HANDED_OVER: "bg-blue-100 text-blue-800",
  CANCELLED: "bg-red-100 text-red-700",
  RETURNED: "bg-emerald-100 text-emerald-800",
};

export function orderLineStatusLabel(status: string): string {
  return ORDER_LINE_STATUS_LABEL[status] ?? status;
}

// ── RTO labels ────────────────────────────────────────────────────────

export const RTO_RETURN_KIND_LABEL: Record<string, string> = {
  RETURNED_BY_CUSTOMER: "Returned by customer",
  REPOSSESSED: "Repossessed",
};

export const RTO_OUTCOME_LABEL: Record<string, string> = {
  RETURNED: "Returned",
  REPOSSESSED: "Repossessed",
  OWNERSHIP_TRANSFERRED: "Ownership transferred",
};

export const INSPECTION_REASON_LABEL: Record<string, string> = {
  RECEIPT_DAMAGE: "Damage on receipt",
  IDENTITY_MISMATCH: "Identity mismatch",
  RTO_RETURN: "RTO return",
  CROSS_BRANCH_RETURN: "Cross-branch return",
  SALE_RETURN: "Sale return",
  SHOW_UNIT_RETURN: "Back from event",
  OTHER: "Other",
};

export const INSPECTION_RESULT_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PASSED: "Passed",
  FAILED: "Failed",
};

export type VehicleCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";

export const VEHICLE_CONDITION_LABEL: Record<string, string> = {
  NEW: "New",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  DAMAGED: "Damaged",
};

// ── Formatting ───────────────────────────────────────────────────────

const TIME_ZONE = "Asia/Jakarta";

/** "19 Nov 2026" — business dates and timestamps are shown in WIB. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
}

/** "19 Nov 2026, 14:05" in WIB. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

/**
 * A business date (`YYYY-MM-DD…`, stored at UTC midnight) must be shown as
 * that calendar date regardless of the viewer's time zone.
 */
export function formatBusinessDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Today's date in WIB as `YYYY-MM-DD`, for date inputs. */
export function todayInputValue(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

/**
 * The current WIB wall-clock time as `YYYY-MM-DDTHH:mm`, for
 * `datetime-local` inputs. Built in WIB (not the browser's zone) so the
 * default matches what the admin reads on the showroom clock.
 */
export function nowDateTimeInputValue(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** A `YYYY-MM-DDTHH:mm` value typed in WIB (UTC+7, no DST) → ISO 8601 UTC. */
export function wibDateTimeInputToIso(value: string): string {
  return new Date(`${value}:00+07:00`).toISOString();
}

export interface VariantLabelParts {
  name: string;
  color: string;
  model: { name: string };
}

/** "Athena · Extended · Black" */
export function variantLabel(variant: VariantLabelParts | null | undefined): string {
  if (!variant) return "—";
  return `${variant.model.name} · ${variant.name} · ${variant.color}`;
}
