import { SMS_PERMISSIONS } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import { prisma } from '../../../lib/prisma.js';
import { assertCan, assertCanActOn, can, locationScope, type SmsAccess } from '../lib/access.js';
import {
  lockUnit,
  recordUnitEvent,
  businessDateString,
  businessToday,
  resolveEventDate,
} from '../lib/ledger.js';
import { runIdempotent, type IdempotentResult } from '../lib/idempotency.js';
import { createAuditLog } from '../lib/audit.js';
import * as showLoanRepo from './repository.js';
import type { ShowLoanFull } from './repository.js';
import type { ShowLoanRow, ShowLoanStatus } from './types.js';
import type {
  ListShowLoansQuery,
  CreateShowLoanInput,
  ReturnShowLoanInput,
} from './schema.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';

// ── Date helpers ────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve an optional ISO-datetime input to a concrete Date.
 * Defaults to now; rejects future timestamps.
 */
function resolveTimestamp(input: string | undefined, now: Date): Date {
  if (!input) return now;
  const dt = new Date(input);
  if (dt.getTime() > now.getTime()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Datetime cannot be in the future');
  }
  return dt;
}

// ── Mapper ──────────────────────────────────────────────────────────────────

function computeOverdue(
  loan: { returnedAt: Date | null; expectedReturnDate: Date },
  now: Date,
): { overdue: boolean; daysOverdue: number } {
  if (loan.returnedAt !== null) return { overdue: false, daysOverdue: 0 };
  const today = businessToday(now);
  const days = Math.floor((today.getTime() - loan.expectedReturnDate.getTime()) / MS_PER_DAY);
  const daysOverdue = Math.max(0, days);
  return { overdue: daysOverdue > 0, daysOverdue };
}

function computeStatus(
  loan: { returnedAt: Date | null; expectedReturnDate: Date },
  now: Date,
): ShowLoanStatus {
  if (loan.returnedAt !== null) return 'RETURNED';
  const { overdue } = computeOverdue(loan, now);
  return overdue ? 'OVERDUE' : 'OUT';
}

export function mapToRow(raw: ShowLoanFull, now: Date = new Date()): ShowLoanRow {
  const { overdue, daysOverdue } = computeOverdue(raw, now);
  return {
    id: raw.id,
    unitId: raw.unitId,
    unit: {
      id: raw.unit.id,
      vin: raw.unit.vin,
      status: raw.unit.status,
      variant: {
        modelName: raw.unit.variant.model.name,
        variantName: raw.unit.variant.name,
        color: raw.unit.variant.color,
      },
    },
    showroomId: raw.showroomId,
    eventName: raw.eventName,
    eventLocation: raw.eventLocation,
    pic: raw.pic ? { id: raw.pic.id, name: raw.pic.name } : null,
    dispatchedAt: raw.dispatchedAt,
    expectedReturnDate: raw.expectedReturnDate,
    overdue,
    daysOverdue,
    returnedAt: raw.returnedAt,
    returnCondition: raw.returnCondition,
    hasFindings: raw.hasFindings,
    notes: raw.notes,
    status: computeStatus(raw, now),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listShowLoans(
  access: SmsAccess,
  query: ListShowLoansQuery,
): Promise<{ data: ShowLoanRow[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  if (query.showroomId) {
    assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, query.showroomId);
  }

  // Build the location scope: a specific showroom overrides the broader scope.
  const scopeShowroomIds: 'ALL' | string[] | undefined = query.showroomId
    ? undefined
    : locationScope(access, SMS_PERMISSIONS.STOCK_VIEW);

  const { skip, take, page, limit } = parsePagination({ page: query.page, limit: query.limit });
  const now = new Date();

  const { data, total } = await showLoanRepo.findMany(
    {
      showroomId: query.showroomId,
      status: query.status,
      scopeShowroomIds,
    },
    skip,
    take,
    now,
  );

  return {
    data: data.map((loan) => mapToRow(loan, now)),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function getShowLoan(access: SmsAccess, loanId: string): Promise<ShowLoanRow> {
  const raw = await showLoanRepo.findById(loanId);
  if (!raw) {
    throw new AppError(404, 'SMS_SHOW_LOAN_NOT_FOUND', 'Show loan not found');
  }

  // Auth: STOCK_VIEW at the loan's showroom; 404 (not 403) to avoid existence probing.
  if (!can(access, SMS_PERMISSIONS.STOCK_VIEW, raw.showroomId)) {
    throw new AppError(404, 'SMS_SHOW_LOAN_NOT_FOUND', 'Show loan not found');
  }

  return mapToRow(raw);
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Dispatch an AVAILABLE unit to a show event.
 * Exactly-once via Idempotency-Key.
 */
export async function createShowLoan(
  access: SmsAccess,
  input: CreateShowLoanInput,
  idempotencyKey: string,
): Promise<IdempotentResult<ShowLoanRow>> {
  return runIdempotent(
    {
      key: idempotencyKey,
      userId: access.userId,
      operation: 'show-loans.dispatch',
      payload: input,
      statusCode: 201,
    },
    async (tx) => {
      const now = new Date();

      // Lock the unit row to serialise concurrent operations on this VIN.
      const unit = await lockUnit(tx, input.unitId);

      // Authoritative location-scoped auth: permission must be held at the
      // unit's current physical location. The unit must be visible (STOCK_VIEW)
      // at that location; otherwise surface as 404 to not reveal its existence.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.SHOW_UNITS_MANAGE,
        unit.physicalLocationId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_UNIT_NOT_FOUND', message: 'Unit not found' },
      );

      // Unit must be AVAILABLE to dispatch to an event.
      if (unit.status !== 'AVAILABLE') {
        throw new AppError(
          409,
          'SMS_UNIT_NOT_AVAILABLE',
          `Unit cannot be dispatched for show while in status ${unit.status}`,
          [{ unitId: unit.id, status: unit.status }],
        );
      }

      // Resolve dispatchedAt: default to now, may be in the past, never future.
      const dispatchedAt = resolveTimestamp(input.dispatchedAt, now);

      // expectedReturnDate must be on or after the dispatch business date.
      const expectedReturnDate = new Date(`${input.expectedReturnDate}T00:00:00.000Z`);
      const dispatchBusinessDate = businessToday(dispatchedAt);
      if (expectedReturnDate.getTime() < dispatchBusinessDate.getTime()) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'expectedReturnDate must be on or after the dispatch date',
        );
      }

      // Validate the PIC: must be an active, non-deleted user.
      const pic = await tx.user.findFirst({
        where: { id: input.picUserId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!pic) {
        throw new AppError(422, 'SMS_PIC_NOT_FOUND', 'PIC user not found or not active', [
          { userId: input.picUserId },
        ]);
      }

      // Guard the invariant that an AVAILABLE unit always has a physicalLocationId.
      // assertCanActOn above already checks the location, so this should never
      // fire in practice — but we make it explicit rather than relying on the
      // non-null assertion to surface the invariant break clearly in logs.
      if (!unit.physicalLocationId) {
        throw new AppError(
          500,
          'SMS_INVARIANT_VIOLATION',
          'AVAILABLE unit has no physicalLocationId — data integrity error',
          [{ unitId: unit.id }],
        );
      }

      // The loan must be created before recordUnitEvent so its id can be
      // passed in the event links and unit changes.
      const showLoan = await tx.smsShowLoan.create({
        data: {
          unitId: unit.id,
          showroomId: unit.physicalLocationId,
          eventName: input.eventName,
          eventLocation: input.eventLocation,
          picUserId: input.picUserId,
          dispatchedAt,
          expectedReturnDate,
          notes: input.notes ?? null,
          createdByUserId: access.userId,
        },
      });

      // Apply the SHOW_UNIT_DISPATCHED transition.
      // unitChanges sets openShowLoanId at the same time, so the unit row
      // always has a valid pointer after this call.
      const eventDate = resolveEventDate(businessDateString(dispatchedAt), now);
      await recordUnitEvent(tx, unit, {
        event: { type: 'SHOW_UNIT_DISPATCHED' },
        eventDate,
        performedByUserId: access.userId,
        links: { showLoanId: showLoan.id },
        unitChanges: { openShowLoanId: showLoan.id },
      });

      await createAuditLog(tx, {
        userId: access.userId,
        action: 'CREATE',
        resourceType: 'SmsShowLoan',
        resourceId: showLoan.id,
        newValues: {
          unitId: unit.id,
          vin: unit.vin,
          eventName: input.eventName,
          eventLocation: input.eventLocation,
          dispatchedAt: dispatchedAt.toISOString(),
          expectedReturnDate: input.expectedReturnDate,
        },
      });

      // Re-read to get the full join structure for the response.
      const full = await showLoanRepo.findById(showLoan.id, tx);
      if (!full) {
        // Should never happen — we just created it.
        throw new AppError(500, 'SMS_INTERNAL', 'Show loan not found after creation');
      }
      return mapToRow(full, now);
    },
  );
}

/**
 * Receive a show unit back from an event.
 *
 * - No findings: unit returns to AVAILABLE at its responsible showroom.
 * - Findings: unit goes to INSPECTION; a pending inspection is created and
 *   linked to this show loan so the inspection queue already shows the issue.
 *
 * Repeating a return on an already-returned loan is a no-op: returns the
 * stored row with alreadyDone:true (no second event written).
 *
 * Exactly-once via Idempotency-Key.
 */
export async function returnShowLoan(
  access: SmsAccess,
  loanId: string,
  input: ReturnShowLoanInput,
  idempotencyKey: string,
): Promise<IdempotentResult<ShowLoanRow & { alreadyDone?: boolean }>> {
  // Pre-fetch to obtain unitId for locking; a missing loan is surfaced before
  // claiming an idempotency key (not a mutation).
  const preliminary = await prisma.smsShowLoan.findUnique({
    where: { id: loanId },
    select: { id: true, unitId: true },
  });
  if (!preliminary) {
    throw new AppError(404, 'SMS_SHOW_LOAN_NOT_FOUND', 'Show loan not found');
  }

  return runIdempotent(
    {
      key: idempotencyKey,
      userId: access.userId,
      operation: 'show-loans.return',
      payload: { loanId, ...input },
      statusCode: 200,
    },
    async (tx) => {
      const now = new Date();

      // Lock the unit so concurrent return/dispatch operations on the same VIN
      // are serialised (READ COMMITTED guarantees we see committed state).
      const unit = await lockUnit(tx, preliminary.unitId);

      // Auth: SHOW_UNITS_MANAGE at the unit's responsible showroom. The unit's
      // existence is hidden with a 404 when the caller cannot see it at all.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.SHOW_UNITS_MANAGE,
        unit.responsibleShowroomId,
        [unit.responsibleShowroomId],
        { code: 'SMS_SHOW_LOAN_NOT_FOUND', message: 'Show loan not found' },
      );

      // Re-read the loan after acquiring the unit lock to see the latest
      // committed state (guards against a concurrent return by another admin).
      const loanTxSelect = {
        id: true,
        unitId: true,
        unit: {
          select: {
            id: true,
            vin: true,
            status: true,
            physicalLocationId: true,
            responsibleShowroomId: true,
            variant: {
              select: {
                name: true,
                color: true,
                model: { select: { name: true } },
              },
            },
          },
        },
        showroomId: true,
        eventName: true,
        eventLocation: true,
        pic: { select: { id: true, name: true } },
        dispatchedAt: true,
        expectedReturnDate: true,
        returnedAt: true,
        returnCondition: true,
        hasFindings: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      } as const;

      const loan = await tx.smsShowLoan.findUnique({
        where: { id: loanId },
        select: loanTxSelect,
      });
      if (!loan) {
        throw new AppError(404, 'SMS_SHOW_LOAN_NOT_FOUND', 'Show loan not found');
      }

      // Idempotency guard: already returned — no-op.
      if (loan.returnedAt !== null) {
        return { ...mapToRow(loan, now), alreadyDone: true };
      }

      // Guard: unit must be SHOW_UNIT.
      if (unit.status !== 'SHOW_UNIT') {
        throw new AppError(
          409,
          'SMS_UNIT_NOT_SHOW_UNIT',
          `Cannot return a show loan while unit is in status ${unit.status}`,
          [{ unitId: unit.id, status: unit.status }],
        );
      }

      // Resolve returnedAt: default to now; must not be in the future or
      // before the dispatch timestamp.
      const returnedAt = resolveTimestamp(input.returnedAt, now);
      if (returnedAt.getTime() < loan.dispatchedAt.getTime()) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'returnedAt cannot be before dispatchedAt',
        );
      }

      const outcome: 'AVAILABLE' | 'INSPECTION' = input.hasFindings ? 'INSPECTION' : 'AVAILABLE';
      const returnEventDate = resolveEventDate(businessDateString(returnedAt), now);

      // Record SHOW_UNIT_RETURNED — transitions unit to AVAILABLE or INSPECTION,
      // sets physicalLocationId = responsibleShowroomId (the reducer rule),
      // and clears the openShowLoanId pointer.
      const { unit: updatedUnit } = await recordUnitEvent(tx, unit, {
        event: { type: 'SHOW_UNIT_RETURNED', outcome },
        eventDate: returnEventDate,
        performedByUserId: access.userId,
        links: { showLoanId: loanId },
        unitChanges: { openShowLoanId: null },
      });

      // Update the show loan row with return details.
      const updatedLoan = await tx.smsShowLoan.update({
        where: { id: loanId },
        data: {
          returnedAt,
          returnCondition: input.condition,
          hasFindings: input.hasFindings,
        },
        select: loanTxSelect,
      });

      // When findings are reported: open an inspection so this unit appears
      // in the inspection queue immediately, with the return notes attached.
      if (input.hasFindings) {
        const inspection = await tx.smsInspection.create({
          data: {
            unitId: unit.id,
            reason: 'SHOW_UNIT_RETURN',
            result: 'PENDING',
            findings: input.findings ?? null,
            showLoanId: loanId,
            createdByUserId: access.userId,
          },
        });

        // INSPECTION_STARTED applies on the already-updated unit (INSPECTION status).
        await recordUnitEvent(tx, updatedUnit, {
          event: { type: 'INSPECTION_STARTED' },
          eventDate: returnEventDate,
          performedByUserId: access.userId,
          links: { showLoanId: loanId, inspectionId: inspection.id },
        });
      }

      await createAuditLog(tx, {
        userId: access.userId,
        action: 'UPDATE',
        resourceType: 'SmsShowLoan',
        resourceId: loanId,
        oldValues: { returnedAt: null, returnCondition: null, hasFindings: false },
        newValues: {
          returnedAt: returnedAt.toISOString(),
          returnCondition: input.condition,
          hasFindings: input.hasFindings,
          findings: input.findings ?? null,
        },
      });

      return mapToRow(updatedLoan, now);
    },
  );
}
