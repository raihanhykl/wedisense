import type {
  SmsUnitStatus,
  SmsUnitEventType,
  SmsInspectionReason,
  SmsInspectionResult,
  SmsVehicleCondition,
  SmsOrderLineStatus,
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
