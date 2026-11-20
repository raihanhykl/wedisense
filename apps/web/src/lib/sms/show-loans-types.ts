/**
 * Frontend-facing types for the Show Loans (pameran) API slice.
 * Date fields are ISO 8601 strings on the wire.
 */

export type ShowLoanStatus = "OUT" | "OVERDUE" | "RETURNED";

export interface ShowLoanUnitVariant {
  modelName: string;
  variantName: string;
  color: string;
}

export interface ShowLoanUnitSummary {
  id: string;
  vin: string;
  status: string;
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
  dispatchedAt: string;
  expectedReturnDate: string;
  overdue: boolean;
  daysOverdue: number;
  returnedAt: string | null;
  returnCondition: string | null;
  hasFindings: boolean;
  notes: string | null;
  /** Computed: OUT | OVERDUE | RETURNED */
  status: ShowLoanStatus;
  createdAt: string;
  updatedAt: string;
  /** Set when the response was an idempotent replay. */
  alreadyDone?: boolean;
}

/** Person returned by GET /api/sms/people */
export interface PersonOption {
  id: string;
  name: string;
  employeeId: string | null;
}
