import type { SmsOrderLineStatus } from '@prisma/client';

// ── Shared ref shapes ────────────────────────────────────────────────────────

export interface PersonRef {
  id: string;
  name: string;
}

export interface LocationRef {
  id: string;
  code: string;
  name: string;
}

export interface VariantRef {
  id: string;
  name: string;
  color: string;
  model: { id: string; code: string; name: string };
}

// ── List / detail shapes ─────────────────────────────────────────────────────

export interface OrderSummary {
  total: number;
  booked: number;
  sold: number;
  pickedUp: number;
  cancelled: number;
}

export interface OrderLineDetail {
  id: string;
  status: SmsOrderLineStatus;
  bookedAt: Date;
  followUpAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  soldAt: Date | null;
  pickedUpAt: Date | null;
  receiverName: string | null;
  handoverReference: string | null;
  /** Set when this line was handed over as an RTO contract. */
  rtoHandoverAt: Date | null;
  /** Set when a sale return has been received for this line. */
  returnReceivedAt: Date | null;
  returnReason: string | null;
  returnCondition: string | null;
  /** PENDING | APPROVED | REJECTED — set after the return has been received. */
  returnDecision: string | null;
  returnDecidedAt: Date | null;
  returnDecisionReason: string | null;
  unit: {
    id: string;
    vin: string;
    variant: VariantRef;
    physicalLocation: LocationRef | null;
  };
}

export interface OrderDetail {
  id: string;
  spkNumber: string;
  showroom: LocationRef;
  sales: PersonRef | null;
  createdBy: PersonRef;
  customerName: string;
  customerPhone: string | null;
  /** null means the caller does not hold sms-customers:view at the order showroom. */
  customerIdNumber: string | null;
  /** true when customerIdNumber is not null but was masked for this caller. */
  customerIdNumberMasked: boolean;
  notes: string | null;
  isOpeningBalance: boolean;
  createdAt: Date;
  updatedAt: Date;
  lines: OrderLineDetail[];
  summary: OrderSummary;
}

export interface OrderListRow {
  id: string;
  spkNumber: string;
  showroom: LocationRef;
  sales: PersonRef | null;
  customerName: string;
  customerPhone: string | null;
  createdAt: Date;
  summary: OrderSummary;
}

// ── Booking conflict detail ──────────────────────────────────────────────────

export interface BookingConflictDetail {
  unitId: string;
  vin: string;
  reason: 'ALREADY_BOOKED' | 'NOT_AVAILABLE' | 'NOT_AT_SHOWROOM' | 'NOT_FOUND';
  status: string | null;
  currentHolder?: { spkNumber: string; salesName: string | null };
  alternatives: Array<{ id: string; vin: string; color: string; variantName: string; modelName: string }>;
}
