/**
 * Frontend-facing types for the Shipments and Inspections API slices.
 * Date fields are ISO 8601 strings on the wire (not Date objects).
 */

// ── Shared ──────────────────────────────────────────────────────────────────

export interface ShipmentCounts {
  expected: number;
  receivedOk: number;
  receivedDamaged: number;
  discrepancy: number;
  pending: number;
  /** Motorcycles that arrived without being on the manifest. */
  unexpected?: number;
}

// ── Shipment list ────────────────────────────────────────────────────────────

export interface ShipmentListItem {
  id: string;
  batchNumber: string;
  deliveryNoteNumber: string;
  destinationLocationId: string;
  destinationName: string;
  originLocationId: string | null;
  originName: string | null;
  dispatchDate: string | null;
  notes: string | null;
  createdAt: string;
  counts: ShipmentCounts;
}

// ── Shipment detail / receiving ──────────────────────────────────────────────

export interface ShipmentLineDetail {
  id: string;
  vin: string;
  engineNumber: string | null;
  variantId: string | null;
  variantName: string | null;
  modelCode: string | null;
  modelName: string | null;
  rawModel: string | null;
  rawVariant: string | null;
  rawColor: string | null;
  isExpected: boolean;
  receiptStatus: "PENDING" | "RECEIVED_OK" | "RECEIVED_DAMAGED" | "DISCREPANCY";
  discrepancyNotes: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  unit: { id: string; status: string } | null;
}

export interface ShipmentDetail {
  id: string;
  batchNumber: string;
  deliveryNoteNumber: string;
  destinationLocationId: string;
  destinationName: string;
  originLocationId: string | null;
  originName: string | null;
  dispatchDate: string | null;
  notes: string | null;
  sourceFileName: string | null;
  createdAt: string;
  createdByName: string;
  counts: ShipmentCounts;
  lines: ShipmentLineDetail[];
}

// ── Import inspect ───────────────────────────────────────────────────────────

export interface InspectSheet {
  name: string;
  headerRowIndex: number;
  headers: string[];
  /** First 10 data rows after the header row. */
  sampleRows: string[][];
  suggestedMapping: Record<string, number | null>;
}

export interface InspectResponse {
  source: { kind: "file"; fileName: string } | { kind: "text" };
  sheets: Array<{ name: string; rowCount: number }>;
  sheet: InspectSheet;
}

// ── Import preview ───────────────────────────────────────────────────────────

export type VinClassification =
  | "NEW"
  | "ALREADY_IN_THIS_SHIPMENT"
  | "IN_OTHER_SHIPMENT"
  | "ALREADY_RECEIVED";

export interface ClassifiedCandidate {
  vin: string;
  engineNumber: string | null;
  model: string | null;
  variant: string | null;
  color: string | null;
  variantId: string | null;
  classification: VinClassification;
  otherShipment?: { batchNumber: string; destinationName: string };
  existingUnit?: { status: string };
  conflicts?: Array<{ field: string; values: string[] }>;
  sourceRows: Array<{ row: number; values: Record<string, string> }>;
}

export interface AmbiguousRow {
  row: number;
  rawValues: Record<string, string>;
  reason: string;
}

export interface UnmatchedVariant {
  rawModel: string | null;
  rawVariant: string | null;
  rawColor: string | null;
  count: number;
}

export interface PreviewSummary {
  total: number;
  newCount: number;
  alreadyInShipment: number;
  inOtherShipment: number;
  alreadyReceived: number;
  skippedComponents: number;
  ambiguous: number;
}

export interface ExistingShipment {
  id: string;
  batchNumber: string;
  deliveryNoteNumber: string;
  counts: ShipmentCounts;
}

export interface PreviewResponse {
  candidates: ClassifiedCandidate[];
  unmatchedVariants: UnmatchedVariant[];
  ambiguousRows: AmbiguousRow[];
  skippedComponents: { count: number; rows: number[] };
  existingShipment: ExistingShipment | null;
  summary: PreviewSummary;
}

// ── Import confirm ───────────────────────────────────────────────────────────

export interface SkippedVin {
  vin: string;
  reason: string;
}

export interface ConfirmResponse {
  shipment: { id: string; batchNumber: string; deliveryNoteNumber: string };
  createdCount: number;
  skipped: SkippedVin[];
}

// ── Receive ──────────────────────────────────────────────────────────────────

export interface ReceivedItem {
  lineId: string;
  unit: { id: string; vin: string; status: string };
}

export interface AlreadyReceivedItem {
  lineId: string;
  unit: { id: string; vin: string; status: string };
}

export interface ReceiveResponse {
  received: ReceivedItem[];
  alreadyReceived: AlreadyReceivedItem[];
  counts: ShipmentCounts;
}

// ── Findings ─────────────────────────────────────────────────────────────────

export interface FindingsResponse {
  unit: { id: string; vin: string; status: string };
  line: { id: string; receiptStatus: string };
  isNewLine: boolean;
}

// ── Inspections ──────────────────────────────────────────────────────────────

export interface InspectionVariantSummary {
  modelName: string;
  variantName: string;
  color: string;
}

export interface InspectionUnitSummary {
  id: string;
  vin: string;
  status: string;
  variant: InspectionVariantSummary;
}

export interface InspectionRow {
  id: string;
  unitId: string;
  unit: InspectionUnitSummary;
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
