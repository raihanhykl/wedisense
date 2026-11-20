export interface DashboardTotals {
  physical: number;
  ready: number;
  booked: number;
  soldPendingPickup: number;
  inspection: number;
  custody: number;
  identityMismatch: number;
  outside: number;
  /** Subset of outside: units currently dispatched to show events (status=SHOW_UNIT). */
  showUnit: number;
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
  /** Subset of outside: units with status=SHOW_UNIT responsible to this showroom. */
  showUnit: number;
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

// ── Stage 3 task types ───────────────────────────────────────────────────────

/** An order line in BOOKED status whose follow-up date has passed. */
export interface StaleBookingTask {
  /** Order line id. */
  id: string;
  orderId: string;
  spk: string;
  vin: string;
  salesName: string | null;
  bookedAt: Date;
  followUpAt: Date | null;
  /** Calendar days since bookedAt. */
  daysSinceBooking: number;
}

/** An order line in SOLD status (unit physically present, waiting for customer pickup). */
export interface AwaitingPickupTask {
  /** Order line id. */
  id: string;
  orderId: string;
  spk: string;
  vin: string;
  soldAt: Date | null;
  /** Calendar days since soldAt (or 0 if soldAt is null). */
  daysWaiting: number;
}

/** A show loan that is past its expectedReturnDate. */
export interface OverdueShowUnitTask {
  loanId: string;
  vin: string;
  eventName: string;
  pic: { id: string; name: string } | null;
  expectedReturnDate: Date;
  daysOverdue: number;
}

export interface DashboardTasks {
  openShipments: { data: OpenShipmentTask[]; total: number };
  inspections: { data: InspectionTask[]; total: number };
  identityMismatches: { data: IdentityMismatchTask[]; total: number };
  staleBookings: { data: StaleBookingTask[]; total: number };
  awaitingPickup: { data: AwaitingPickupTask[]; total: number };
  overdueShowUnits: { data: OverdueShowUnitTask[]; total: number };
}
