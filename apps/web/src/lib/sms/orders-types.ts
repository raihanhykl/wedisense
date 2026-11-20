/**
 * Frontend-facing types for the SMS Orders (SPK) API responses.
 * These mirror the shapes returned by the SMS orders API module.
 */

// ── Shared references ──────────────────────────────────────────────────

export interface OrderLocationRef {
  id: string;
  code: string;
  name: string;
}

export interface OrderPersonRef {
  id: string;
  name: string;
}

export interface OrderVariantRef {
  id: string;
  name: string;
  color: string;
  model: { id: string; code: string; name: string };
}

// ── Summary ────────────────────────────────────────────────────────────

export interface OrderSummary {
  total: number;
  booked: number;
  sold: number;
  pickedUp: number;
  cancelled: number;
}

// ── Line ───────────────────────────────────────────────────────────────

export type OrderLineStatus = "BOOKED" | "SOLD" | "PICKED_UP" | "CANCELLED";

export interface OrderLineDetail {
  id: string;
  status: OrderLineStatus;
  bookedAt: string;
  followUpAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  soldAt: string | null;
  pickedUpAt: string | null;
  receiverName: string | null;
  handoverReference: string | null;
  unit: {
    id: string;
    vin: string;
    variant: OrderVariantRef;
    physicalLocation: OrderLocationRef | null;
  };
}

// ── List row ────────────────────────────────────────────────────────────

export interface OrderListRow {
  id: string;
  spkNumber: string;
  showroom: OrderLocationRef;
  sales: OrderPersonRef | null;
  customerName: string;
  customerPhone: string | null;
  createdAt: string;
  summary: OrderSummary;
}

// ── Detail ──────────────────────────────────────────────────────────────

export interface OrderDetail {
  id: string;
  spkNumber: string;
  showroom: OrderLocationRef;
  sales: OrderPersonRef | null;
  createdBy: OrderPersonRef;
  customerName: string;
  customerPhone: string | null;
  customerIdNumber: string | null;
  customerIdNumberMasked: boolean;
  notes: string | null;
  isOpeningBalance: boolean;
  createdAt: string;
  updatedAt: string;
  lines: OrderLineDetail[];
  summary: OrderSummary;
}

// ── Mutation results ────────────────────────────────────────────────────

export interface CreateOrderResult {
  orderId: string;
  spkNumber: string;
  bookedCount: number;
}

export interface AddLinesResult {
  orderId: string;
  spkNumber: string;
  addedCount: number;
}

export interface CancelLineResult {
  lineId: string;
  alreadyDone: boolean;
  status: OrderLineStatus;
}

export interface FollowUpResult {
  lineId: string;
  followUpAt: string;
}

export interface RecordSaleResult {
  orderId: string;
  recordedCount: number;
  alreadyDone: boolean;
  alreadySoldCount: number;
}

export interface ConfirmPickupResult {
  lineId: string;
  alreadyDone: boolean;
  status: OrderLineStatus;
  pickedUpAt: string;
}

// ── Booking conflict detail ─────────────────────────────────────────────

export type BookingConflictReason =
  | "ALREADY_BOOKED"
  | "NOT_AVAILABLE"
  | "NOT_AT_SHOWROOM"
  | "NOT_FOUND";

export interface BookingConflictDetail {
  unitId: string;
  vin: string;
  reason: BookingConflictReason;
  status: string | null;
  currentHolder?: { spkNumber: string; salesName: string | null };
  alternatives: Array<{ id: string; vin: string; color: string; variantName: string; modelName: string }>;
}

/** One line explaining why a VIN could not be booked, e.g. "Already booked by Dina for SPK-021". */
export function describeBookingConflict(conflict: BookingConflictDetail): string {
  switch (conflict.reason) {
    case "ALREADY_BOOKED": {
      const holder = conflict.currentHolder;
      if (!holder) return "Already booked";
      return `Already booked${holder.salesName ? ` by ${holder.salesName}` : ""} for ${holder.spkNumber}`;
    }
    case "NOT_AVAILABLE":
      return conflict.status ? `Not available (${conflict.status.replace(/_/g, " ").toLowerCase()})` : "Not available";
    case "NOT_AT_SHOWROOM":
      return "Not at this showroom";
    case "NOT_FOUND":
      return "Unit not found";
  }
}

// ── People picker ───────────────────────────────────────────────────────

export interface PersonOption {
  id: string;
  name: string;
  employeeId: string | null;
}

// ── Unit search result for the VIN picker in the order form ────────────

export interface UnitPickerResult {
  id: string;
  vin: string;
  variant: OrderVariantRef;
  physicalLocation: OrderLocationRef | null;
  status: string;
}
