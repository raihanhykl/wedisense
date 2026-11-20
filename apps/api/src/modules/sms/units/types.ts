import type {
  SmsUnitStatus,
  SmsUnitEventType,
  SmsInspectionReason,
  SmsInspectionResult,
  SmsVehicleCondition,
  SmsOrderLineStatus,
  SmsRtoOutcome,
  SmsRtoReturnKind,
  SmsDecision,
} from '@prisma/client';

export interface UnitLocationRef {
  id: string;
  code: string;
  name: string;
}

export interface UnitVariantRef {
  id: string;
  name: string;
  batteryVariant: string | null;
  color: string;
  model: { id: string; code: string; name: string };
}

/** Row returned by the paginated unit list. */
export interface UnitListRow {
  id: string;
  vin: string;
  engineNumber: string | null;
  licensePlate: string | null;
  status: SmsUnitStatus;
  wasRto: boolean;
  isOpeningBalance: boolean;
  receivedAt: Date | null;
  updatedAt: Date;
  variant: UnitVariantRef;
  physicalLocation: UnitLocationRef | null;
  responsibleShowroom: UnitLocationRef;
}

/** Inspection summary used in the VIN card. */
export interface UnitInspectionSummary {
  id: string;
  reason: SmsInspectionReason;
  result: SmsInspectionResult;
  condition: SmsVehicleCondition | null;
  odometer: number | null;
  findings: string | null;
  notes: string | null;
  inspector: { id: string; name: string } | null;
  inspectedAt: Date | null;
  createdAt: Date;
}

/** Event timeline entry used in the VIN card. */
export interface UnitEventTimeline {
  id: string;
  seq: number;
  eventType: SmsUnitEventType;
  eventDate: Date;
  recordedAt: Date;
  performedBy: { id: string; name: string } | null;
  location: UnitLocationRef | null;
  statusAfter: SmsUnitStatus;
  reason: string | null;
  notes: string | null;
  isSuperseded: boolean;
  isVoided: boolean;
}

/** Active order line data included in the VIN card. */
export interface UnitActiveOrderLine {
  id: string;
  orderId: string;
  spkNumber: string;
  status: SmsOrderLineStatus;
  salesName: string | null;
  createdByName: string | null;
  bookedAt: Date;
  followUpAt: Date | null;
}

/** Open show loan data included in the VIN card. */
export interface UnitOpenShowLoan {
  id: string;
  eventName: string;
  eventLocation: string;
  picName: string | null;
  dispatchedAt: Date;
  expectedReturnDate: Date;
  overdue: boolean;
}

/** One RTO contract period of a VIN (for the VIN card). */
export interface UnitRtoPeriod {
  id: string;
  contractNumber: string;
  originShowroom: { id: string; name: string };
  salesUser: { id: string; name: string } | null;
  customerName: string;
  customerPhone: string | null;
  /** Null unless caller holds sms-customers:view. */
  customerIdNumber: string | null;
  startDate: Date;
  handoverAt: Date | null;
  returnKind: SmsRtoReturnKind | null;
  returnedAt: Date | null;
  receivedAtShowroom: { id: string; name: string } | null;
  closedAt: Date | null;
  closedBy: { id: string; name: string } | null;
  legalReference: string | null;
  outcome: SmsRtoOutcome | null;
  isOpeningBalance: boolean;
}

/** Open return request summary for the VIN card (populated by the other agent). */
export interface UnitOpenReturnRequest {
  id: string;
  requestNumber: string;
  fromShowroom: { id: string; name: string };
  toShowroom: { id: string; name: string };
  decision: SmsDecision;
  custodyReceivedAt: Date | null;
  officialReceivedAt: Date | null;
  custodyResolvedAt: Date | null;
}

/** Full VIN card returned by GET /units/:id. */
export interface UnitDetail {
  id: string;
  vin: string;
  engineNumber: string | null;
  licensePlate: string | null;
  status: SmsUnitStatus;
  wasRto: boolean;
  isOpeningBalance: boolean;
  notes: string | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  variant: UnitVariantRef;
  physicalLocation: UnitLocationRef | null;
  responsibleShowroom: UnitLocationRef;
  shipment: {
    id: string;
    batchNumber: string;
    deliveryNoteNumber: string;
    destination: UnitLocationRef;
    dispatchDate: Date | null;
  } | null;
  inspections: UnitInspectionSummary[];
  timeline: UnitEventTimeline[];
  availableActions: string[];
  releaseBlockers: string[];
  /** Current booking / SPK line, or null when the unit is not booked/sold. */
  activeOrderLine: UnitActiveOrderLine | null;
  /** Open show loan, or null when the unit is not currently on loan to an event. */
  openShowLoan: UnitOpenShowLoan | null;
  /** All RTO contract periods for this unit, newest first. */
  rtoContracts: UnitRtoPeriod[];
  /** Open return request, if any (from other agent's data). */
  openReturnRequest: UnitOpenReturnRequest | null;
}

/** Search result — either a registered unit or an expected (pending) VIN. */
export type UnitSearchResult =
  | {
      kind: 'unit';
      id: string;
      vin: string;
      engineNumber: string | null;
      licensePlate: string | null;
      status: SmsUnitStatus;
      variant: UnitVariantRef;
      physicalLocation: UnitLocationRef | null;
      responsibleShowroom: UnitLocationRef;
    }
  | {
      kind: 'expected';
      vin: string;
      shipmentId: string;
      batchNumber: string;
      destination: UnitLocationRef;
    };
