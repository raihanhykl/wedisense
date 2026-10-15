import type { HandoverFormStatus, HandoverType } from "@/types/admin";

/**
 * Display metadata for handover forms. Kept here rather than inline in the
 * pages so the list, detail, movement picker and timeline badge all agree on
 * wording and colour for a given type/status.
 */

export const HANDOVER_TYPE_LABELS: Record<HandoverType, string> = {
  COMPANY_TO_EMPLOYEE: "Company → Employee",
  EMPLOYEE_TO_EMPLOYEE: "Employee → Employee",
  EMPLOYEE_TO_COMPANY: "Employee → Company",
};

export const HANDOVER_TYPE_DESCRIPTIONS: Record<HandoverType, string> = {
  COMPANY_TO_EMPLOYEE:
    "The company issues an asset to an employee. No outgoing employee is recorded.",
  EMPLOYEE_TO_EMPLOYEE:
    "One employee hands an asset to another — same branch or across branches.",
  EMPLOYEE_TO_COMPANY:
    "An employee returns an asset to the company (resignation, transfer, replacement).",
};

export const HANDOVER_STATUS_LABELS: Record<HandoverFormStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  SIGNED: "Signed",
  CANCELLED: "Cancelled",
};

/**
 * What each status means for the operator, shown as helper text so nobody
 * has to guess why a form suddenly stopped being editable.
 */
export const HANDOVER_STATUS_HINTS: Record<HandoverFormStatus, string> = {
  DRAFT: "Still editable. Generating the PDF will lock it.",
  ISSUED: "PDF generated and locked. Print, collect signatures, then upload the scan.",
  SIGNED: "Signed scan on file. Ready to be cited by asset movements.",
  CANCELLED: "Cancelled. It can no longer be used for movements.",
};

export const HANDOVER_STATUS_CLASSES: Record<HandoverFormStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ISSUED: "bg-amber-100 text-amber-800",
  SIGNED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
};

/** Which party fields a given handover direction actually uses. */
export function partyRequirements(type: HandoverType): {
  needsFromUser: boolean;
  needsToUser: boolean;
} {
  return {
    needsFromUser: type !== "COMPANY_TO_EMPLOYEE",
    needsToUser: type !== "EMPLOYEE_TO_COMPANY",
  };
}

/** A form can only be edited or deleted while it is still a draft. */
export function isEditable(status: HandoverFormStatus): boolean {
  return status === "DRAFT";
}

/** Scans may only be attached once the form has been issued for signature. */
export function canUploadScan(status: HandoverFormStatus): boolean {
  return status === "ISSUED" || status === "SIGNED";
}

export function formatHandoverDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
