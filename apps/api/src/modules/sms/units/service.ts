import { Prisma } from '@prisma/client';
import { AppError } from '../../../middleware/error-handler.js';
import { objectDiff } from '../../../utils/diff.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import {
  assertCan,
  assertCanActOn,
  can,
  locationScope,
  permissionsAt,
  type SmsAccess,
} from '../lib/access.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { smsTransaction } from '../lib/transaction.js';
import { lockUnits, recordUnitEvent, resolveEventDate } from '../lib/ledger.js';
import { createAuditLog } from '../lib/audit.js';
import { runIdempotent } from '../lib/idempotency.js';
import type { SmsActor } from '../lib/types.js';
import * as repo from './repository.js';
import { computeAvailableActions } from './actions.js';
import type {
  ListUnitsQuery,
  UpdateUnitDetailsInput,
  ResolveIdentityInput,
  ReleaseUnitInput,
} from './schema.js';

// ── List ─────────────────────────────────────────────────────────────────────

export async function listUnits(query: ListUnitsQuery, access: SmsAccess) {
  assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, query.showroomId);

  const { skip, take, page, limit } = parsePagination(query);
  const { data, total } = await repo.findMany({
    showroomId: query.showroomId,
    view: query.view,
    modelId: query.modelId,
    variantId: query.variantId,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    skip,
    take,
  });

  return { data, meta: buildPaginationMeta(page, limit, total) };
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchUnits(q: string, access: SmsAccess) {
  const scope = locationScope(access, SMS_PERMISSIONS.STOCK_VIEW);
  const [units, expected] = await Promise.all([
    repo.searchUnits(q, scope),
    repo.searchExpectedVins(q, scope),
  ]);
  return repo.buildSearchResults(units, expected, q);
}

// ── Detail (VIN card) ─────────────────────────────────────────────────────────

export async function getUnit(id: string, access: SmsAccess) {
  const unit = await repo.findById(id);
  if (!unit) {
    throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found');
  }

  // Authorization: visible only when caller holds STOCK_VIEW at either location.
  const visibleAtPhysical = can(access, SMS_PERMISSIONS.STOCK_VIEW, unit.physicalLocation?.id ?? null);
  const visibleAtResponsible = can(access, SMS_PERMISSIONS.STOCK_VIEW, unit.responsibleShowroom.id);
  if (!visibleAtPhysical && !visibleAtResponsible) {
    // 404 — do not reveal that the unit exists.
    throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found');
  }

  // Compute available actions using the caller's permissions at the relevant location.
  const relevantLocationId = unit.physicalLocation?.id ?? unit.responsibleShowroom.id;
  const permsAtRelevant = new Set(permissionsAt(access, relevantLocationId));

  // The raw commitment pointers are not in UnitDetail; fetch them separately.
  const raw = await repo.findRawById(id);
  if (!raw) {
    throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found');
  }

  const latestInspection = unit.inspections[0] ?? null;
  const { availableActions, releaseBlockers } = computeAvailableActions({
    unit: {
      status: raw.status,
      physicalLocationId: raw.physicalLocationId,
      responsibleShowroomId: raw.responsibleShowroomId,
      activeOrderLineId: raw.activeOrderLineId,
      openRtoContractId: raw.openRtoContractId,
      openReturnRequestId: raw.openReturnRequestId,
      openShowLoanId: raw.openShowLoanId ?? null,
    },
    latestInspection: latestInspection ? { result: latestInspection.result } : null,
    permissionsAtRelevantLocation: permsAtRelevant,
  });

  return { ...unit, availableActions, releaseBlockers };
}

// ── Update details ────────────────────────────────────────────────────────────

export async function updateUnitDetails(
  id: string,
  input: UpdateUnitDetailsInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return smsTransaction(async (tx) => {
    const lockedForDetails = await lockUnits(tx, [id]);
    const unit = lockedForDetails[0];
    // lockUnits throws SMS_UNIT_NOT_FOUND if the unit is absent; this guard
    // is here only to satisfy TypeScript's strict null checks.
    if (!unit) throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found');

    // Authorization at the entity's location (never from request body).
    const relevantLocationId = unit.physicalLocationId ?? unit.responsibleShowroomId;
    assertCanActOn(
      access,
      SMS_PERMISSIONS.RECEIVING_MANAGE,
      relevantLocationId,
      [unit.physicalLocationId, unit.responsibleShowroomId],
      { code: 'SMS_UNIT_NOT_FOUND', message: 'Unit not found' },
    );

    // Capture before-state for diff.
    const before = {
      licensePlate: unit.licensePlate,
      engineNumber: unit.engineNumber,
      notes: unit.notes,
    };

    const updated = await tx.smsUnit.update({
      where: { id },
      data: {
        ...(input.licensePlate !== undefined && { licensePlate: input.licensePlate }),
        ...(input.engineNumber !== undefined && { engineNumber: input.engineNumber }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      select: {
        id: true,
        vin: true,
        licensePlate: true,
        engineNumber: true,
        notes: true,
        updatedAt: true,
      },
    });

    const after = {
      licensePlate: updated.licensePlate,
      engineNumber: updated.engineNumber,
      notes: updated.notes,
    };
    const { oldValues, newValues } = objectDiff(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
    );

    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'UPDATE',
      resourceType: 'SmsUnit',
      resourceId: id,
      oldValues,
      newValues,
    });

    return updated;
  });
}

// ── Resolve identity ──────────────────────────────────────────────────────────

export async function resolveIdentity(
  id: string,
  key: string,
  input: ResolveIdentityInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'units.resolve-identity',
      payload: { id, ...input },
      statusCode: 200,
    },
    async (tx) => {
      const lockedForResolve = await lockUnits(tx, [id]);
      const unit = lockedForResolve[0];
      if (!unit) throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found');

      // Authorize against the unit's own location BEFORE looking at its
      // state, so a caller without access learns nothing about the unit.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.RECEIVING_MANAGE,
        unit.physicalLocationId ?? unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_UNIT_NOT_FOUND', message: 'Unit not found' },
      );

      if (unit.status !== 'IDENTITY_MISMATCH') {
        throw new AppError(
          409,
          'SMS_INVALID_TRANSITION',
          `Only a unit with an identity mismatch can be reconciled (this unit is ${unit.status}).`,
          [{ unitId: unit.id, vin: unit.vin, status: unit.status }],
        );
      }

      // If the VIN is being corrected, update it first in a separate update
      // before recordUnitEvent, because `vin` is excluded from unitChanges typing.
      if (input.vin !== undefined && input.vin !== unit.vin) {
        try {
          await tx.smsUnit.update({
            where: { id },
            data: { vin: input.vin },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new AppError(
              409,
              'SMS_VIN_ALREADY_EXISTS',
              `VIN ${input.vin} is already registered.`,
            );
          }
          throw err;
        }
      }

      const eventDate = resolveEventDate(input.eventDate);

      // Record IDENTITY_RESOLVED.
      const { event: resolvedEvent } = await recordUnitEvent(tx, unit, {
        event: { type: 'IDENTITY_RESOLVED', outcome: input.outcome },
        eventDate,
        performedByUserId: actor.userId,
        notes: input.notes,
        unitChanges: {
          ...(input.engineNumber !== undefined && { engineNumber: input.engineNumber }),
          ...(input.variantId !== undefined && { variantId: input.variantId }),
        },
      });

      let inspectionId: string | null = null;

      // If the outcome is INSPECTION, create an inspection record and
      // record INSPECTION_STARTED linked to it.
      if (input.outcome === 'INSPECTION') {
        const inspection = await tx.smsInspection.create({
          data: {
            unitId: id,
            reason: 'IDENTITY_MISMATCH',
            result: 'PENDING',
            createdByUserId: actor.userId,
          },
          select: { id: true },
        });
        inspectionId = inspection.id;

        // Re-read the unit after IDENTITY_RESOLVED to pass the updated state.
        const unitAfterResolve = await tx.smsUnit.findUniqueOrThrow({
          where: { id },
        });

        await recordUnitEvent(tx, unitAfterResolve, {
          event: { type: 'INSPECTION_STARTED' },
          eventDate,
          performedByUserId: actor.userId,
          notes: input.notes,
          links: { inspectionId: inspection.id },
        });
      }

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsUnit',
        resourceId: id,
        newValues: {
          eventType: 'IDENTITY_RESOLVED',
          outcome: input.outcome,
          ...(input.vin !== undefined && { vin: input.vin }),
          ...(input.engineNumber !== undefined && { engineNumber: input.engineNumber }),
          ...(input.variantId !== undefined && { variantId: input.variantId }),
          ...(inspectionId && { inspectionId }),
        },
      });

      return { unitId: id, eventId: resolvedEvent.id, outcome: input.outcome, inspectionId };
    },
  );
}

// ── Release ───────────────────────────────────────────────────────────────────

export async function releaseUnit(
  id: string,
  key: string,
  input: ReleaseUnitInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'units.release',
      payload: { id, ...input },
      statusCode: 200,
    },
    async (tx) => {
      const lockedForRelease = await lockUnits(tx, [id]);
      const unit = lockedForRelease[0];
      if (!unit) throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found');

      // Authorize against the unit's own location BEFORE looking at its
      // state, so a caller without access learns nothing about the unit.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.INSPECTIONS_MANAGE,
        unit.physicalLocationId ?? unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_UNIT_NOT_FOUND', message: 'Unit not found' },
      );

      if (unit.status !== 'INSPECTION') {
        throw new AppError(
          409,
          'SMS_INVALID_TRANSITION',
          `Only a unit held for inspection can be released (this unit is ${unit.status}).`,
          [{ unitId: unit.id, vin: unit.vin, status: unit.status }],
        );
      }

      // Enforce open-commitment invariants before changing state.
      if (unit.activeOrderLineId !== null) {
        throw new AppError(
          409,
          'SMS_UNIT_HAS_OPEN_COMMITMENT',
          'Cannot release this unit: active order line is still open.',
          [{ pointer: 'activeOrderLineId', value: unit.activeOrderLineId }],
        );
      }
      if (unit.openRtoContractId !== null) {
        throw new AppError(
          409,
          'SMS_UNIT_HAS_OPEN_COMMITMENT',
          'Cannot release this unit: RTO contract is still open.',
          [{ pointer: 'openRtoContractId', value: unit.openRtoContractId }],
        );
      }
      if (unit.openReturnRequestId !== null) {
        throw new AppError(
          409,
          'SMS_UNIT_HAS_OPEN_COMMITMENT',
          'Cannot release this unit: return request is still open.',
          [{ pointer: 'openReturnRequestId', value: unit.openReturnRequestId }],
        );
      }

      // The latest inspection (by createdAt) must have result PASSED.
      const latestInspection = await tx.smsInspection.findFirst({
        where: { unitId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, result: true },
      });
      if (!latestInspection || latestInspection.result !== 'PASSED') {
        throw new AppError(
          409,
          'SMS_INSPECTION_NOT_PASSED',
          'Cannot release this unit: the latest inspection has not passed.',
        );
      }

      const eventDate = resolveEventDate(input.eventDate);

      const { event } = await recordUnitEvent(tx, unit, {
        event: { type: 'UNIT_RELEASED' },
        eventDate,
        performedByUserId: actor.userId,
        notes: input.notes ?? null,
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsUnit',
        resourceId: id,
        newValues: { eventType: 'UNIT_RELEASED', statusAfter: 'AVAILABLE' },
      });

      return { unitId: id, eventId: event.id, statusAfter: 'AVAILABLE' as const };
    },
  );
}
