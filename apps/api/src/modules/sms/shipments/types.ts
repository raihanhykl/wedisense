/**
 * TypeScript types for the shipments slice.
 *
 * These are the response shapes consumed by the frontend.
 */
import type { SmsShipmentLine } from '@prisma/client';

// ── Inspect ───────────────────────────────────────────────────────────────────

export interface SheetInfo {
  name: string;
  rowCount: number;
}

export interface SuggestedMapping {
  [field: string]: number | null;
}

export interface InspectSheet {
  name: string;
  headerRowIndex: number;
  headers: string[];
  /** First 10 data rows (after the header row). */
  sampleRows: string[][];
  suggestedMapping: SuggestedMapping;
}

export interface InspectResponse {
  source: { kind: 'file'; fileName: string } | { kind: 'text' };
  sheets: SheetInfo[];
  sheet: InspectSheet;
}

// ── Preview ───────────────────────────────────────────────────────────────────

export type VinClassification =
  | 'NEW'
  | 'ALREADY_IN_THIS_SHIPMENT'
  | 'IN_OTHER_SHIPMENT'
  | 'ALREADY_RECEIVED';

export interface ClassifiedCandidate {
  vin: string;
  engineNumber: string | null;
  model: string | null;
  variant: string | null;
  color: string | null;
  variantId: string | null;
  classification: VinClassification;
  /** Set when classification = IN_OTHER_SHIPMENT. */
  otherShipment?: { batchNumber: string; destinationName: string };
  /** Set when classification = ALREADY_RECEIVED. */
  existingUnit?: { status: string };
  conflicts?: Array<{ field: string; values: string[] }>;
  sourceRows: Array<{ row: number; values: Record<string, string> }>;
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
  ambiguousRows: Array<{ row: number; rawValues: Record<string, string>; reason: string }>;
  skippedComponents: { count: number; rows: number[] };
  existingShipment: ExistingShipment | null;
  summary: PreviewSummary;
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export interface SkippedVin {
  vin: string;
  reason: string;
}

export interface ConfirmResponse {
  shipment: { id: string; batchNumber: string; deliveryNoteNumber: string };
  createdCount: number;
  skipped: SkippedVin[];
}

// ── Shipment list / detail ────────────────────────────────────────────────────

export interface ShipmentCounts {
  /** VINs listed on the manifest. Unexpected arrivals are NOT included. */
  expected: number;
  receivedOk: number;
  receivedDamaged: number;
  /** Arrived with a different identity (expected lines and unexpected arrivals). */
  discrepancy: number;
  /** Listed on the manifest and not arrived yet. */
  pending: number;
  /** Motorcycles that arrived without being on the manifest. */
  unexpected: number;
}

export interface ShipmentListItem {
  id: string;
  batchNumber: string;
  deliveryNoteNumber: string;
  destinationLocationId: string;
  destinationName: string;
  originLocationId: string | null;
  originName: string | null;
  dispatchDate: Date | null;
  notes: string | null;
  createdAt: Date;
  counts: ShipmentCounts;
}

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
  sourceRows: SmsShipmentLine['sourceRows'];
  isExpected: boolean;
  receiptStatus: string;
  discrepancyNotes: string | null;
  receivedAt: Date | null;
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
  dispatchDate: Date | null;
  notes: string | null;
  sourceFileName: string | null;
  createdAt: Date;
  createdByName: string;
  counts: ShipmentCounts;
  lines: ShipmentLineDetail[];
}

// ── Receive ───────────────────────────────────────────────────────────────────

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

// ── Findings ──────────────────────────────────────────────────────────────────

export interface FindingsResponse {
  unit: { id: string; vin: string; status: string };
  line: { id: string; receiptStatus: string };
  isNewLine: boolean;
}

// ── Actor ─────────────────────────────────────────────────────────────────────

export interface Actor {
  userId: string;
}
