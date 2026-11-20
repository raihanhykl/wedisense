/**
 * Frontend-facing types for the Stock Management System API responses.
 * These mirror the shapes returned by the SMS API modules.
 */

// ── Shared references ──────────────────────────────────────────────────

export interface SmsLocationRef {
  id: string;
  code: string;
  name: string;
}

export interface SmsVariantRef {
  id: string;
  name: string;
  batteryVariant: string | null;
  color: string;
  model: { id: string; code: string; name: string };
}

// ── Dashboard ──────────────────────────────────────────────────────────

export interface DashboardTotals {
  physical: number;
  ready: number;
  booked: number;
  soldPendingPickup: number;
  inspection: number;
  custody: number;
  identityMismatch: number;
  outside: number;
  expected: number;
}

export interface DashboardVariantRow {
  variantId: string;
  variantName: string;
  batteryVariant: string | null;
  color: string;
  modelId: string;
  modelCode: string;
  modelName: string;
  physical: number;
  ready: number;
  booked: number;
  soldPendingPickup: number;
  inspection: number;
  custody: number;
  identityMismatch: number;
  outside: number;
}

export interface DashboardSummary {
  showroom: { id: string; code: string; name: string };
  totals: DashboardTotals;
  byVariant: DashboardVariantRow[];
}

export interface OpenShipmentTask {
  id: string;
  batchNumber: string;
  deliveryNoteNumber: string;
  expectedCount: number;
  receivedCount: number;
  pendingCount: number;
  createdAt: string;
}

export interface InspectionTask {
  unitId: string;
  vin: string;
  variantLabel: string;
  latestInspectionResult: string | null;
}

export interface IdentityMismatchTask {
  unitId: string;
  vin: string;
  variantLabel: string;
}

export interface DashboardTasks {
  openShipments: { data: OpenShipmentTask[]; total: number };
  inspections: { data: InspectionTask[]; total: number };
  identityMismatches: { data: IdentityMismatchTask[]; total: number };
}

// ── Units ──────────────────────────────────────────────────────────────

export interface UnitListRow {
  id: string;
  vin: string;
  engineNumber: string | null;
  licensePlate: string | null;
  status: string;
  wasRto: boolean;
  isOpeningBalance: boolean;
  receivedAt: string | null;
  updatedAt: string;
  variant: SmsVariantRef;
  physicalLocation: SmsLocationRef | null;
  responsibleShowroom: SmsLocationRef;
}

export interface UnitInspectionSummary {
  id: string;
  reason: string;
  result: string;
  condition: string | null;
  odometer: number | null;
  findings: string | null;
  notes: string | null;
  inspector: { id: string; name: string } | null;
  inspectedAt: string | null;
  createdAt: string;
}

export interface UnitEventTimeline {
  id: string;
  seq: number;
  eventType: string;
  eventDate: string;
  recordedAt: string;
  performedBy: { id: string; name: string } | null;
  location: SmsLocationRef | null;
  statusAfter: string;
  reason: string | null;
  notes: string | null;
  isSuperseded: boolean;
  isVoided: boolean;
}

export interface UnitDetail {
  id: string;
  vin: string;
  engineNumber: string | null;
  licensePlate: string | null;
  status: string;
  wasRto: boolean;
  isOpeningBalance: boolean;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variant: SmsVariantRef;
  physicalLocation: SmsLocationRef | null;
  responsibleShowroom: SmsLocationRef;
  shipment: {
    batchNumber: string;
    deliveryNoteNumber: string;
    destination: SmsLocationRef;
    dispatchDate: string | null;
    id?: string;
  } | null;
  inspections: UnitInspectionSummary[];
  timeline: UnitEventTimeline[];
  availableActions: string[];
  releaseBlockers: string[];
}

export type UnitSearchResult =
  | {
      kind: "unit";
      id: string;
      vin: string;
      engineNumber: string | null;
      licensePlate: string | null;
      status: string;
      variant: SmsVariantRef;
      physicalLocation: SmsLocationRef | null;
      responsibleShowroom: SmsLocationRef;
    }
  | {
      kind: "expected";
      vin: string;
      shipmentId: string;
      batchNumber: string;
      destination: SmsLocationRef;
    };

// ── Master ─────────────────────────────────────────────────────────────

export interface VehicleModelRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variantCount: number;
  unitCount: number;
}

export interface VehicleVariantRow {
  id: string;
  modelId: string;
  name: string;
  batteryVariant: string | null;
  color: string;
  colorHex: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  model: { id: string; code: string; name: string };
  unitCount: number;
}

// ── Users (picker) ─────────────────────────────────────────────────────

export interface UserOption {
  id: string;
  name: string;
  employeeId: string | null;
  email: string | null;
  status: string;
  hasAccount: boolean;
}
