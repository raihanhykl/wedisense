/**
 * Frontend-facing types for the Opening Balance import flow.
 *
 * These mirror the shapes returned by the SMS opening-balance API endpoints.
 * Date fields are YYYY-MM-DD strings on the wire (not Date objects).
 */

// ── State ─────────────────────────────────────────────────────────────────────

export type ObState =
  | "AVAILABLE"
  | "BOOKED"
  | "SOLD_PENDING_PICKUP"
  | "ACTIVE_RTO"
  | "INSPECTION"
  | "SHOW_UNIT"
  | "CUSTODY";

// ── Inspect ───────────────────────────────────────────────────────────────────

export interface ObInspectSheet {
  name: string;
  headerRowIndex: number;
  headers: string[];
  /** First 10 data rows after the header row. */
  sampleRows: string[][];
  suggestedMapping: Record<string, number | null>;
}

export interface ObInspectResponse {
  source: { kind: "file"; fileName: string } | { kind: "text" };
  sheets: Array<{ name: string; rowCount: number }>;
  sheet: ObInspectSheet;
}

// ── Preview ───────────────────────────────────────────────────────────────────

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

  // BOOKED / SOLD_PENDING_PICKUP
  spkNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  salesUserId: string | null;

  // ACTIVE_RTO / CUSTODY
  contractNumber: string | null;
  contractStartDate: string | null;

  // SHOW_UNIT
  eventName: string | null;
  eventLocation: string | null;
  expectedReturnDate: string | null;
  picUserId: string | null;

  // CUSTODY
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

export interface ObConfirmRow {
  row: number;
  vin: string;
  engineNumber?: string;
  licensePlate?: string;
  /** Required before confirm — resolved from preview or selected by user. */
  variantId: string;
  showroomId: string;
  state: ObState;
  notes?: string;

  // BOOKED / SOLD_PENDING_PICKUP
  spkNumber?: string;
  customerName?: string;
  customerPhone?: string;
  salesUserId?: string | null;

  // ACTIVE_RTO / CUSTODY
  contractNumber?: string;
  contractStartDate?: string;

  // SHOW_UNIT
  eventName?: string;
  eventLocation?: string;
  expectedReturnDate?: string;
  picUserId?: string | null;

  // CUSTODY
  heldAtShowroomId?: string;
}

export interface ObConfirmBody {
  balanceDate?: string;
  sourceFileName?: string;
  rows: ObConfirmRow[];
}

export interface ObConfirmResponse {
  createdCount: number;
  byState: Record<string, number>;
  ordersCreated: number;
  contractsCreated: number;
}

/** Shape of one entry in the `details` array when confirm returns 422. */
export interface ObConfirmRowError {
  row: number;
  vin: string;
  field?: string;
  message: string;
  /** Index signature so this type is assignable to Record<string, unknown>. */
  [key: string]: unknown;
}

export function isObConfirmRowError(
  detail: Record<string, unknown>,
): detail is ObConfirmRowError {
  return (
    typeof detail["row"] === "number" &&
    typeof detail["vin"] === "string" &&
    typeof detail["message"] === "string"
  );
}
