import type {
  SmsRtoContract,
  SmsRtoOutcome,
  SmsRtoReturnKind,
} from '@prisma/client';

// ── Row shapes returned to callers ────────────────────────────────────────────

export interface RtoContractRow {
  id: string;
  contractNumber: string;
  unit: {
    id: string;
    vin: string;
    variant: { modelName: string; variantName: string; color: string };
  };
  originShowroom: { id: string; code: string; name: string };
  orderLineId: string | null;
  salesUser: { id: string; name: string } | null;
  customerName: string;
  customerPhone: string | null;
  /** Null unless caller holds sms-customers:view at the relevant showroom. */
  customerIdNumber: string | null;
  startDate: Date;
  handoverAt: Date | null;
  returnKind: SmsRtoReturnKind | null;
  returnedAt: Date | null;
  receivedAtShowroom: { id: string; code: string; name: string } | null;
  closedAt: Date | null;
  closedBy: { id: string; name: string } | null;
  legalReference: string | null;
  outcome: SmsRtoOutcome | null;
  notes: string | null;
  isOpeningBalance: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RtoContractDetail extends RtoContractRow {
  responsibleShowroomId: string;
  unitPhysicalLocationId: string | null;
}

export type RtoContractListItem = Omit<
  RtoContractRow,
  'notes' | 'closedBy' | 'receivedAtShowroom'
> & {
  status: 'active' | 'returned_open' | 'closed';
};

/** Used internally — the full join shape from the repository. */
export type RtoContractFull = SmsRtoContract & {
  unit: {
    id: string;
    vin: string;
    physicalLocationId: string | null;
    responsibleShowroomId: string;
    openRtoContractId: string | null;
    variant: {
      name: string;
      color: string;
      model: { name: string };
    };
  };
  originShowroom: { id: string; code: string; name: string };
  receivedAtShowroom: { id: string; code: string; name: string } | null;
  sales: { id: string; name: string } | null;
  closedBy: { id: string; name: string } | null;
};
