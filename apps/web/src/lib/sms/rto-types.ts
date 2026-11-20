/**
 * Frontend-facing types for the RTO Contracts API slice.
 * Date fields are ISO 8601 strings on the wire.
 */

// ── Shared references ──────────────────────────────────────────────────

export interface RtoShowroomRef {
  id: string;
  code: string;
  name: string;
}

export interface RtoPersonRef {
  id: string;
  name: string;
}

export interface RtoUnitRef {
  id: string;
  vin: string;
  variant: { modelName: string; variantName: string; color: string };
}

// ── Status derived from contract fields ──────────────────────────────────

/** active = no closedAt; returned_open = returnedAt/receivedAt set but not closed; closed = closedAt set */
export type RtoContractStatus = "active" | "returned_open" | "closed";

// ── Full row (GET /api/sms/rto-contracts/:id) ──────────────────────────

export interface RtoContractRow {
  id: string;
  contractNumber: string;
  unit: RtoUnitRef;
  originShowroom: RtoShowroomRef;
  orderLineId: string | null;
  salesUser: RtoPersonRef | null;
  customerName: string;
  customerPhone: string | null;
  /** Null unless the caller holds sms-customers:view at the relevant showroom. */
  customerIdNumber: string | null;
  startDate: string;
  handoverAt: string | null;
  returnKind: string | null;
  returnedAt: string | null;
  receivedAtShowroom: RtoShowroomRef | null;
  closedAt: string | null;
  closedBy: RtoPersonRef | null;
  legalReference: string | null;
  outcome: string | null;
  notes: string | null;
  isOpeningBalance: boolean;
  createdAt: string;
  updatedAt: string;
}

/** List item — omits notes/closedBy/receivedAtShowroom; adds derived status. */
export type RtoContractListItem = Omit<
  RtoContractRow,
  "notes" | "closedBy" | "receivedAtShowroom"
> & {
  status: RtoContractStatus;
};

// ── Mutation results ──────────────────────────────────────────────────

export interface CreateRtoContractResult {
  contractId: string;
  contractNumber: string;
}

export interface RtoReturnResult {
  contractId: string;
  alreadyDone: boolean;
  inspectionId?: string;
}

export interface CloseRtoContractResult {
  contractId: string;
  alreadyDone: boolean;
  outcome: string;
}

export interface OwnershipTransferResult {
  contractId: string;
  alreadyDone: boolean;
  outcome: string;
}

// ── Pagination ────────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RtoContractListResponse {
  data: RtoContractListItem[];
  meta: PaginationMeta;
}
