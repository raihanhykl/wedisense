/**
 * Frontend-facing types for the Return Requests API slice.
 * Date fields are ISO 8601 strings on the wire.
 */

export type SmsReturnDecision = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Derived display status of a return request, computed from decision + custody
 * + officialReceivedAt:
 *
 *   PENDING              — waiting for fromShowroom to decide
 *   APPROVED             — approved, motor not yet physically received
 *   APPROVED_IN_CUSTODY  — approved, motor already at toShowroom (custody)
 *   REJECTED             — rejected, no custody ever received or already resolved
 *   REJECTED_IN_CUSTODY  — rejected, motor still at toShowroom (needs handback)
 *   COMPLETED            — officialReceivedAt is set (motor transferred)
 */
export type ReturnRequestDisplayStatus =
  | "PENDING"
  | "APPROVED"
  | "APPROVED_IN_CUSTODY"
  | "REJECTED"
  | "REJECTED_IN_CUSTODY"
  | "COMPLETED";

export interface ReturnRequestVariant {
  modelName: string;
  variantName: string;
  batteryVariant: string | null;
  color: string;
}

export interface ReturnRequestUnit {
  id: string;
  vin: string;
  status: string;
  wasRto: boolean;
  variant: ReturnRequestVariant;
}

export interface ReturnRequestShowroom {
  id: string;
  name: string;
  code: string;
}

export interface ReturnRequestUser {
  id: string;
  name: string;
}

/** Full return request row returned by GET /api/sms/return-requests/:id and the list. */
export interface ReturnRequestRow {
  id: string;
  requestNumber: string;
  unitId: string;
  rtoContractId: string | null;
  rtoContractNumber: string | null;
  fromShowroomId: string;
  toShowroomId: string;
  reason: string;
  requestedByUserId: string;
  requestedAt: string;
  decision: SmsReturnDecision;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  custodyReceivedAt: string | null;
  officialReceivedAt: string | null;
  custodyResolvedAt: string | null;
  custodyResolution: string | null;
  createdAt: string;
  updatedAt: string;

  // Derived
  displayStatus: ReturnRequestDisplayStatus;

  // Relations
  unit: ReturnRequestUnit;
  fromShowroom: ReturnRequestShowroom;
  toShowroom: ReturnRequestShowroom;
  requestedBy: ReturnRequestUser;
  decidedBy: ReturnRequestUser | null;
  /** Masked to "[Hidden]" if the caller lacks sms-customers:view at fromShowroom. */
  customerName: string | null;
}

/** Compact row returned by the lookup endpoint. */
export interface ReturnRequestLookupHit {
  unitId: string;
  vin: string;
  variant: ReturnRequestVariant;
  status: string;
  responsibleShowroom: { id: string; name: string };
  rtoContractNumber: string | null;
  /** Masked to "[Hidden]" unless the caller holds sms-customers:view at the responsible showroom. */
  customerName: string;
  openReturnRequest: {
    id: string;
    requestNumber: string;
    toShowroomId: string;
    toShowroomName: string;
    decision: SmsReturnDecision;
  } | null;
}

export type ReturnRequestListDirection = "incoming" | "outgoing" | "all";
export type ReturnRequestListStatus =
  | "pending"
  | "approved"
  | "rejected_custody"
  | "closed"
  | "all";
