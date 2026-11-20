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

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface OpenShipmentTask {
  id: string;
  batchNumber: string;
  deliveryNoteNumber: string;
  expectedCount: number;
  receivedCount: number;
  pendingCount: number;
  createdAt: Date;
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
