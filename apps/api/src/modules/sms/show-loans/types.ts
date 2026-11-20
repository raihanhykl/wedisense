import type { SmsVehicleCondition, SmsUnitStatus } from '@prisma/client';

/** Computed lifecycle status for a show loan. */
export type ShowLoanStatus = 'OUT' | 'OVERDUE' | 'RETURNED';

export interface ShowLoanUnitVariant {
  modelName: string;
  variantName: string;
  color: string;
}

export interface ShowLoanUnitSummary {
  id: string;
  vin: string;
  status: SmsUnitStatus;
  variant: ShowLoanUnitVariant;
}

export interface ShowLoanPicSummary {
  id: string;
  name: string;
}

export interface ShowLoanRow {
  id: string;
  unitId: string;
  unit: ShowLoanUnitSummary;
  showroomId: string;
  eventName: string;
  eventLocation: string;
  pic: ShowLoanPicSummary | null;
  dispatchedAt: Date;
  expectedReturnDate: Date;
  /** True when returnedAt is null and expectedReturnDate is before today (Jakarta TZ). */
  overdue: boolean;
  /** Calendar days past expectedReturnDate; 0 when not overdue or already returned. */
  daysOverdue: number;
  returnedAt: Date | null;
  returnCondition: SmsVehicleCondition | null;
  hasFindings: boolean;
  notes: string | null;
  /** Computed from returnedAt, overdue flag. */
  status: ShowLoanStatus;
  createdAt: Date;
  updatedAt: Date;
}
