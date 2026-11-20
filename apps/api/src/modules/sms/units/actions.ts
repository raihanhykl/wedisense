/**
 * Pure functions for computing unit affordances.
 *
 * These are intentionally dependency-free (no Prisma, no I/O) so they can
 * be unit-tested directly without mocking infrastructure.
 */
import type { SmsInspectionResult, SmsUnitStatus } from '@prisma/client';
import { SMS_PERMISSIONS } from '@wedisense/shared';

export interface UnitForActions {
  status: SmsUnitStatus;
  physicalLocationId: string | null;
  responsibleShowroomId: string;
  activeOrderLineId: string | null;
  openRtoContractId: string | null;
  openReturnRequestId: string | null;
  openShowLoanId: string | null;
}

export interface InspectionForActions {
  result: SmsInspectionResult;
}

export interface ActionContext {
  unit: UnitForActions;
  latestInspection: InspectionForActions | null;
  /**
   * The union of global + per-location permissions the caller holds at the
   * unit's relevant location (physicalLocationId if set, else responsibleShowroomId).
   */
  permissionsAtRelevantLocation: Set<string>;
}

export interface ComputeActionsResult {
  availableActions: string[];
  /**
   * Non-empty only when status is INSPECTION and RELEASE is currently blocked.
   * Each entry is a plain English explanation.
   */
  releaseBlockers: string[];
}

/**
 * Compute available actions and release blockers for the given unit state
 * and caller permission set.
 *
 * Actions for this stage:
 *   EDIT_DETAILS             — RECEIVING_MANAGE at relevant location
 *   RESOLVE_IDENTITY         — status IDENTITY_MISMATCH + RECEIVING_MANAGE
 *   RECORD_INSPECTION        — status INSPECTION + INSPECTIONS_MANAGE
 *   RELEASE                  — status INSPECTION + INSPECTIONS_MANAGE + no open
 *                              commitments + latest inspection PASSED
 *   BOOK                     — status AVAILABLE + no active order line + ORDERS_MANAGE
 *   DISPATCH_SHOW            — status AVAILABLE + no open show loan + SHOW_UNITS_MANAGE
 *   RETURN_SHOW              — status SHOW_UNIT + SHOW_UNITS_MANAGE
 *   HANDOVER_RTO             — status AVAILABLE/BOOKED + RTO_MANAGE at physical location
 *   RECORD_RTO_RETURN        — status ACTIVE_RTO + open contract + RTO_MANAGE + no open return request
 *   CLOSE_RTO_CONTRACT       — open contract, motorcycle back (not ACTIVE_RTO / CUSTODY) + RTO_MANAGE
 *   TRANSFER_OWNERSHIP       — status ACTIVE_RTO + open contract + no open return request + RTO_MANAGE
 *   RECORD_SALE_RETURN       — status SOLD_PENDING_PICKUP/PICKED_UP + ORDERS_MANAGE
 *   DECIDE_SALE_RETURN       — SOLD_PENDING_PICKUP/PICKED_UP + pending return + SALE_RETURNS_DECIDE
 */
export function computeAvailableActions(ctx: ActionContext): ComputeActionsResult {
  const { unit, latestInspection, permissionsAtRelevantLocation: perms } = ctx;
  const can = (perm: string): boolean => perms.has(perm);

  const actions: string[] = [];
  const releaseBlockers: string[] = [];

  // EDIT_DETAILS is available whenever RECEIVING_MANAGE is held.
  if (can(SMS_PERMISSIONS.RECEIVING_MANAGE)) {
    actions.push('EDIT_DETAILS');
  }

  // RESOLVE_IDENTITY: unit is in IDENTITY_MISMATCH and caller may manage receiving.
  if (unit.status === 'IDENTITY_MISMATCH' && can(SMS_PERMISSIONS.RECEIVING_MANAGE)) {
    actions.push('RESOLVE_IDENTITY');
  }

  // RECORD_INSPECTION: unit is in INSPECTION and caller may manage inspections.
  if (unit.status === 'INSPECTION' && can(SMS_PERMISSIONS.INSPECTIONS_MANAGE)) {
    actions.push('RECORD_INSPECTION');
  }

  // RELEASE: only relevant when the unit is in INSPECTION.
  if (unit.status === 'INSPECTION') {
    // Collect all blockers so the UI can explain the full list at once.
    if (unit.activeOrderLineId !== null) {
      releaseBlockers.push('Active order line is still open');
    }
    if (unit.openRtoContractId !== null) {
      releaseBlockers.push('RTO contract not closed yet');
    }
    if (unit.openReturnRequestId !== null) {
      releaseBlockers.push('Return request not officially received');
    }
    if (latestInspection === null) {
      releaseBlockers.push('No inspection has been recorded yet');
    } else if (latestInspection.result !== 'PASSED') {
      releaseBlockers.push('Latest inspection has not passed');
    }

    if (can(SMS_PERMISSIONS.INSPECTIONS_MANAGE) && releaseBlockers.length === 0) {
      actions.push('RELEASE');
    }
  }

  // BOOK: unit is AVAILABLE, no active order line, caller holds ORDERS_MANAGE.
  if (
    unit.status === 'AVAILABLE' &&
    unit.activeOrderLineId === null &&
    can(SMS_PERMISSIONS.ORDERS_MANAGE)
  ) {
    actions.push('BOOK');
  }

  // DISPATCH_SHOW: unit is AVAILABLE, no open show loan, caller holds SHOW_UNITS_MANAGE.
  if (
    unit.status === 'AVAILABLE' &&
    unit.openShowLoanId === null &&
    can(SMS_PERMISSIONS.SHOW_UNITS_MANAGE)
  ) {
    actions.push('DISPATCH_SHOW');
  }

  // RETURN_SHOW: unit is SHOW_UNIT, caller holds SHOW_UNITS_MANAGE at responsible showroom.
  if (unit.status === 'SHOW_UNIT' && can(SMS_PERMISSIONS.SHOW_UNITS_MANAGE)) {
    actions.push('RETURN_SHOW');
  }

  // HANDOVER_RTO: unit is AVAILABLE or BOOKED, no open contract, RTO_MANAGE at physical location.
  if (
    (unit.status === 'AVAILABLE' || unit.status === 'BOOKED') &&
    unit.openRtoContractId === null &&
    can(SMS_PERMISSIONS.RTO_MANAGE)
  ) {
    actions.push('HANDOVER_RTO');
  }

  // RECORD_RTO_RETURN: unit is ACTIVE_RTO with open contract, no open return request.
  if (
    unit.status === 'ACTIVE_RTO' &&
    unit.openRtoContractId !== null &&
    unit.openReturnRequestId === null &&
    can(SMS_PERMISSIONS.RTO_MANAGE)
  ) {
    actions.push('RECORD_RTO_RETURN');
  }

  // TRANSFER_OWNERSHIP: unit is ACTIVE_RTO with open contract and no return
  // in progress, RTO_MANAGE.
  if (
    unit.status === 'ACTIVE_RTO' &&
    unit.openRtoContractId !== null &&
    unit.openReturnRequestId === null &&
    can(SMS_PERMISSIONS.RTO_MANAGE)
  ) {
    actions.push('TRANSFER_OWNERSHIP');
  }

  // CLOSE_RTO_CONTRACT: an open contract whose motorcycle is back — returned
  // at the origin or officially received cross-branch, so the unit is no
  // longer with the customer (ACTIVE_RTO) nor merely held in custody
  // (CUSTODY). Mirrors the server guard SMS_CONTRACT_NOT_RETURNED.
  if (
    unit.openRtoContractId !== null &&
    unit.status !== 'ACTIVE_RTO' &&
    unit.status !== 'CUSTODY' &&
    can(SMS_PERMISSIONS.RTO_MANAGE)
  ) {
    actions.push('CLOSE_RTO_CONTRACT');
  }

  // RECORD_SALE_RETURN: line is SOLD or PICKED_UP, ORDERS_MANAGE.
  if (
    (unit.status === 'SOLD_PENDING_PICKUP' || unit.status === 'PICKED_UP') &&
    can(SMS_PERMISSIONS.ORDERS_MANAGE)
  ) {
    actions.push('RECORD_SALE_RETURN');
  }

  // DECIDE_SALE_RETURN: unit is in INSPECTION with activeOrderLineId set
  // (pending sale return) and caller holds SALE_RETURNS_DECIDE.
  if (
    unit.status === 'INSPECTION' &&
    unit.activeOrderLineId !== null &&
    can(SMS_PERMISSIONS.SALE_RETURNS_DECIDE)
  ) {
    actions.push('DECIDE_SALE_RETURN');
  }

  return { availableActions: actions, releaseBlockers };
}
