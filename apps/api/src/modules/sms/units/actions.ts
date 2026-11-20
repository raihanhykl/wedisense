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
 *   EDIT_DETAILS       — RECEIVING_MANAGE at relevant location
 *   RESOLVE_IDENTITY   — status IDENTITY_MISMATCH + RECEIVING_MANAGE
 *   RECORD_INSPECTION  — status INSPECTION + INSPECTIONS_MANAGE
 *   RELEASE            — status INSPECTION + INSPECTIONS_MANAGE + no open
 *                        commitments + latest inspection PASSED
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
      releaseBlockers.push('RTO contract is still open');
    }
    if (unit.openReturnRequestId !== null) {
      releaseBlockers.push('Return request is still open');
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

  return { availableActions: actions, releaseBlockers };
}
