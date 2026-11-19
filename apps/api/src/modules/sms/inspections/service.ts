import { Prisma, SmsInspectionResult } from '@prisma/client';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import { prisma } from '../../../lib/prisma.js';
import { assertCan, can, type SmsAccess } from '../lib/access.js';
import { lockUnits, recordUnitEvent, resolveEventDate } from '../lib/ledger.js';
import { runIdempotent, type IdempotentResult } from '../lib/idempotency.js';
import { createAuditLog } from '../lib/audit.js';
import * as inspectionRepo from './repository.js';
import type { InspectionFull } from './repository.js';
import type { InspectionPhoto, InspectionRow } from './types.js';
import type { ListInspectionsQuery, StartInspectionInput, SetInspectionResultInput } from './schema.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';

// ── Mapper ─────────────────────────────────────────────────────────────────

/**
 * Project the Prisma row (which includes location ids for auth) to the
 * public response shape, stripping internal auth fields.
 */
function mapToRow(raw: InspectionFull): InspectionRow {
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
    reason: raw.reason,
    result: raw.result,
    condition: raw.condition,
    odometer: raw.odometer,
    findings: raw.findings,
    notes: raw.notes,
    photos: raw.photos as InspectionPhoto[] | null,
    inspector: raw.inspector,
    inspectedAt: raw.inspectedAt,
    createdAt: raw.createdAt,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listInspections(
  access: SmsAccess,
  query: ListInspectionsQuery,
): Promise<{ data: InspectionRow[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, query.showroomId);

  const { skip, take, page, limit } = parsePagination({ page: query.page, limit: query.limit });
  const { data, total } = await inspectionRepo.findMany(
    { showroomId: query.showroomId, result: query.result, unitId: query.unitId },
    skip,
    take,
  );

  return {
    data: data.map(mapToRow),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function getInspection(access: SmsAccess, id: string): Promise<InspectionRow> {
  const raw = await inspectionRepo.findById(id);
  if (!raw) {
    throw new AppError(404, 'SMS_INSPECTION_NOT_FOUND', 'Inspection not found');
  }

  // Auth: STOCK_VIEW at the unit's physical location, or at its responsible
  // showroom when it has no physical location. Return 404 (not 403) so callers
  // cannot probe for the existence of inspections they cannot see.
  const locationId = raw.unit.physicalLocationId ?? raw.unit.responsibleShowroomId;
  if (!can(access, SMS_PERMISSIONS.STOCK_VIEW, locationId)) {
    throw new AppError(404, 'SMS_INSPECTION_NOT_FOUND', 'Inspection not found');
  }

  return mapToRow(raw);
}

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Start an inspection on a unit that is already in INSPECTION status.
 * Exactly-once via Idempotency-Key.
 */
export async function startInspection(
  access: SmsAccess,
  input: StartInspectionInput,
  idempotencyKey: string,
): Promise<IdempotentResult<InspectionRow>> {
  return runIdempotent(
    {
      key: idempotencyKey,
      userId: access.userId,
      operation: 'inspections.start',
      payload: input,
      statusCode: 201,
    },
    async (tx) => {
      // Lock the unit row to serialise concurrent operations on this VIN.
      // lockUnits throws AppError(404) when the unit is not found, so the
      // return array is guaranteed to have exactly one element when no error
      // was thrown. The guard below satisfies TypeScript's strict null checks.
      const lockedUnits = await lockUnits(tx, [input.unitId]);
      const unit = lockedUnits[0];
      if (!unit) {
        throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found', [{ unitId: input.unitId }]);
      }

      // Authoritative location-scoped auth check — location comes from the
      // locked unit, never from the request body.
      assertCan(access, SMS_PERMISSIONS.INSPECTIONS_MANAGE, unit.physicalLocationId);

      // The state machine allows INSPECTION_STARTED only when the unit is
      // in INSPECTION status. Surface this as a clear 409 before the ledger
      // validates it, so the client gets a descriptive error code.
      if (unit.status !== 'INSPECTION') {
        throw new AppError(
          409,
          'SMS_UNIT_NOT_IN_INSPECTION',
          `Unit cannot have an inspection started while in status ${unit.status}`,
          [{ unitId: unit.id, status: unit.status }],
        );
      }

      // A unit may only have one open (PENDING) inspection at a time.
      const existing = await tx.smsInspection.findFirst({
        where: { unitId: input.unitId, result: SmsInspectionResult.PENDING },
        select: { id: true },
      });
      if (existing) {
        throw new AppError(
          409,
          'SMS_INSPECTION_ALREADY_PENDING',
          'This unit already has a pending inspection',
          [{ inspectionId: existing.id }],
        );
      }

      // Create the inspection row.
      const inspection = await tx.smsInspection.create({
        data: {
          unitId: input.unitId,
          reason: input.reason,
          notes: input.notes ?? null,
          createdByUserId: access.userId,
        },
        // Re-use the full select so the response is already shaped correctly.
        select: {
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
          reason: true,
          result: true,
          condition: true,
          odometer: true,
          findings: true,
          notes: true,
          photos: true,
          inspector: { select: { id: true, name: true } },
          inspectedAt: true,
          createdAt: true,
        },
      });

      // Record the INSPECTION_STARTED ledger event. The event does not change
      // unit status (the reducer returns the same state). The inspectionId link
      // ties the event to this inspection row on the VIN timeline.
      await recordUnitEvent(tx, unit, {
        event: { type: 'INSPECTION_STARTED' },
        eventDate: resolveEventDate(input.eventDate),
        performedByUserId: access.userId,
        links: { inspectionId: inspection.id },
      });

      await createAuditLog(tx, {
        userId: access.userId,
        action: 'CREATE',
        resourceType: 'SmsInspection',
        resourceId: inspection.id,
        newValues: { unitId: input.unitId, reason: input.reason },
      });

      return mapToRow(inspection);
    },
  );
}

/**
 * Record the outcome of a pending inspection (PASSED or FAILED).
 * Does NOT release the unit — that is a separate, explicit action.
 * Exactly-once via Idempotency-Key.
 */
export async function setInspectionResult(
  access: SmsAccess,
  inspectionId: string,
  input: SetInspectionResultInput,
  idempotencyKey: string,
): Promise<IdempotentResult<InspectionRow>> {
  // Bootstrap read: get the unitId so we can lock the unit inside the
  // transaction. A missing inspection is not a mutation so we surface 404
  // before claiming an idempotency key.
  const preliminary = await prisma.smsInspection.findUnique({
    where: { id: inspectionId },
    select: { id: true, unitId: true },
  });
  if (!preliminary) {
    throw new AppError(404, 'SMS_INSPECTION_NOT_FOUND', 'Inspection not found');
  }

  return runIdempotent(
    {
      key: idempotencyKey,
      userId: access.userId,
      operation: 'inspections.set-result',
      payload: { inspectionId, ...input },
    },
    async (tx) => {
      // Lock the unit row. Any concurrent setInspectionResult on the same VIN
      // will block here, then see the updated result below (READ COMMITTED).
      const lockedUnits = await lockUnits(tx, [preliminary.unitId]);
      const unit = lockedUnits[0];
      if (!unit) {
        throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found', [
          { unitId: preliminary.unitId },
        ]);
      }

      assertCan(access, SMS_PERMISSIONS.INSPECTIONS_MANAGE, unit.physicalLocationId);

      // Re-read the inspection after acquiring the unit lock. Under READ
      // COMMITTED a concurrent transaction that decided the same inspection
      // between our preliminary read and our lock acquisition would already
      // be committed, so this read shows the final state.
      const inspection = await tx.smsInspection.findUnique({
        where: { id: inspectionId },
        select: { id: true, unitId: true, result: true },
      });
      if (!inspection) {
        // Should not happen — we found it above and nothing can delete it
        // (append-only design). Defensive guard.
        throw new AppError(404, 'SMS_INSPECTION_NOT_FOUND', 'Inspection not found');
      }
      if (inspection.result !== SmsInspectionResult.PENDING) {
        throw new AppError(
          409,
          'SMS_INSPECTION_ALREADY_DECIDED',
          'This inspection has already been decided',
          [{ result: inspection.result }],
        );
      }

      // Cross-field validation: findings are mandatory for a FAILED result.
      if (input.result === 'FAILED' && !input.findings) {
        throw new AppError(
          422,
          'SMS_FINDINGS_REQUIRED',
          'findings is required when result is FAILED',
        );
      }

      // Validate the inspector user when given. Employees without a login are
      // valid, so we only require non-deleted; role or status is not checked.
      if (input.inspectorUserId) {
        const inspector = await tx.user.findFirst({
          where: { id: input.inspectorUserId, deletedAt: null },
          select: { id: true },
        });
        if (!inspector) {
          throw new AppError(422, 'SMS_INSPECTOR_NOT_FOUND', 'Inspector user not found', [
            { userId: input.inspectorUserId },
          ]);
        }
      }

      // Resolve inspectedAt — default to now, reject future timestamps.
      let inspectedAt: Date;
      if (input.inspectedAt) {
        inspectedAt = new Date(input.inspectedAt);
        if (inspectedAt.getTime() > Date.now()) {
          throw new AppError(422, 'VALIDATION_ERROR', 'inspectedAt cannot be in the future');
        }
      } else {
        inspectedAt = new Date();
      }

      // Update the inspection row.
      const updated = await tx.smsInspection.update({
        where: { id: inspectionId },
        data: {
          result: input.result as SmsInspectionResult,
          condition: input.condition ?? null,
          odometer: input.odometer ?? null,
          findings: input.findings ?? null,
          notes: input.notes ?? null,
          ...(input.photos !== undefined && {
            photos: input.photos as Prisma.InputJsonValue,
          }),
          inspectorUserId: input.inspectorUserId ?? null,
          inspectedAt,
        },
        select: {
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
          reason: true,
          result: true,
          condition: true,
          odometer: true,
          findings: true,
          notes: true,
          photos: true,
          inspector: { select: { id: true, name: true } },
          inspectedAt: true,
          createdAt: true,
        },
      });

      // Record the ledger event. INSPECTION_PASSED and INSPECTION_FAILED do
      // not change unit status (the reducer returns the same state); they
      // appear on the VIN timeline so history is complete.
      const eventType = input.result === 'PASSED' ? 'INSPECTION_PASSED' : 'INSPECTION_FAILED';
      await recordUnitEvent(tx, unit, {
        event: { type: eventType },
        eventDate: resolveEventDate(input.eventDate),
        performedByUserId: access.userId,
        links: { inspectionId },
      });

      await createAuditLog(tx, {
        userId: access.userId,
        action: 'UPDATE',
        resourceType: 'SmsInspection',
        resourceId: inspectionId,
        oldValues: { result: SmsInspectionResult.PENDING },
        newValues: {
          result: input.result,
          condition: input.condition ?? null,
          odometer: input.odometer ?? null,
          findings: input.findings ?? null,
          inspectorUserId: input.inspectorUserId ?? null,
        },
      });

      return mapToRow(updated);
    },
  );
}
