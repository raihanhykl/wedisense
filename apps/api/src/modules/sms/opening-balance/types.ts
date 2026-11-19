/**
 * TypeScript types for the opening-balance slice.
 *
 * These are the response shapes consumed by the frontend.
 */

// ── Shared inspect shape (re-used from shipments) ─────────────────────────────

export interface SheetInfo {
  name: string;
  rowCount: number;
}

export interface InspectSheet {
  name: string;
  headerRowIndex: number;
  headers: string[];
  /** First 10 data rows (after the header row). */
  sampleRows: string[][];
  suggestedMapping: Record<string, number | null>;
}

export interface ObInspectResponse {
  source: { kind: 'file'; fileName: string } | { kind: 'text' };
  sheets: SheetInfo[];
  sheet: InspectSheet;
}

// ── Preview ───────────────────────────────────────────────────────────────────

export type ObState =
  | 'AVAILABLE'
  | 'BOOKED'
  | 'SOLD_PENDING_PICKUP'
  | 'ACTIVE_RTO'
  | 'INSPECTION'
  | 'SHOW_UNIT'
  | 'CUSTODY';

export interface ObRowError {
  field?: string;
  message: string;
}

export interface ObRowWarning {
  field?: string;
  message: string;
}

export interface ObPreviewRow {
  row: number;
  vin: string;
  state: ObState | null;
  showroomId: string | null;
  variantId: string | null;
  engineNumber: string | null;
  licensePlate: string | null;
  notes: string | null;

  // ── BOOKED / SOLD_PENDING_PICKUP
  spkNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  salesUserId: string | null;

  // ── ACTIVE_RTO / CUSTODY
  contractNumber: string | null;
  contractStartDate: string | null;

  // ── SHOW_UNIT
  eventName: string | null;
  eventLocation: string | null;
  expectedReturnDate: string | null;
  picUserId: string | null;

  // ── CUSTODY
  heldAtShowroomId: string | null;

  errors: ObRowError[];
  warnings: ObRowWarning[];
}

export interface ObPreviewSummary {
  total: number;
  errorCount: number;
  warningCount: number;
  byState: Record<string, number>;
}

export interface ObUnmatchedVariant {
  rawModel: string | null;
  rawVariant: string | null;
  rawColor: string | null;
  count: number;
}

export interface ObPreviewResponse {
  rows: ObPreviewRow[];
  summary: ObPreviewSummary;
  unmatchedVariants: ObUnmatchedVariant[];
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export interface ObConfirmResponse {
  createdCount: number;
  byState: Record<string, number>;
  ordersCreated: number;
  contractsCreated: number;
}
