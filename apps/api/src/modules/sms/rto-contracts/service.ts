/**
 * RTO (Rent-To-Own) contract service.
 *
 * Covers: handover from AVAILABLE or BOOKED, same-branch return, contract
 * closure, and ownership transfer. Cross-branch returns are handled by the
 * return-requests module (other agent).
 */
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { assertCan, assertCanActOn, can, locationScope, type SmsAccess } from '../lib/access.js';
import {
  lockUnit,
  recordUnitEvent,
  businessToday,
  businessDateString,
  resolveEventDate,
} from '../lib/ledger.js';
import { createAuditLog } from '../lib/audit.js';
import { runIdempotent } from '../lib/idempotency.js';
import type { SmsActor } from '../lib/types.js';
import * as repo from './repository.js';
import type {
  CreateRtoContractInput,
  RtoReturnInput,
  CloseRtoContractInput,
  OwnershipTransferInput,
  ListRtoContractsQuery,
} from './schema.js';
import type { RtoContractFull, RtoContractRow } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveTimestamp(input: string | undefined): Date {
  if (!input) return new Date();
  const dt = new Date(input);
  if (dt.getTime() > Date.now()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Datetime cannot be in the future');
  }
  return dt;
}

function mapToRow(raw: RtoContractFull, canViewIdNumber: boolean): RtoContractRow {
  return {
    id: raw.id,
    contractNumber: raw.contractNumber,
    unit: {
      id: raw.unit.id,
      vin: raw.unit.vin,
      variant: {
        modelName: raw.unit.variant.model.name,
        variantName: raw.unit.variant.name,
        color: raw.unit.variant.color,
      },
    },
    originShowroom: raw.originShowroom,
    orderLineId: raw.orderLineId,
    salesUser: raw.sales,
    customerName: raw.customerName,
    customerPhone: raw.customerPhone,
    customerIdNumber: canViewIdNumber ? raw.customerIdNumber : null,
    startDate: raw.startDate,
    handoverAt: raw.handoverAt,
    returnKind: raw.returnKind,
    returnedAt: raw.returnedAt,
    receivedAtShowroom: raw.receivedAtShowroom,
    closedAt: raw.closedAt,
    closedBy: raw.closedBy,
    legalReference: raw.legalReference,
    outcome: raw.outcome,
    notes: raw.notes,
    isOpeningBalance: raw.isOpeningBalance,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listRtoContracts(query: ListRtoContractsQuery, access: SmsAccess) {
  if (query.showroomId) {
    assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, query.showroomId);
  }
  const scope = locationScope(access, SMS_PERMISSIONS.STOCK_VIEW);
  const { skip, take, page, limit } = parsePagination(query);
  const { data, total } = await repo.findMany(query, scope, skip, take);

  return {
    data: data.map((row) => {
      const locationForIdCheck = row.originShowroom.id;
      const canViewId = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, locationForIdCheck);
      return mapToRow(row, canViewId);
    }),
    meta: buildPaginationMeta(page, limit, total),
  };
}

// ── Detail ────────────────────────────────────────────────────────────────────

export async function getRtoContract(id: string, access: SmsAccess) {
  const raw = await repo.findById(id);
  if (!raw) throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');

  // Visible if caller holds STOCK_VIEW at origin showroom or at the unit's
  // responsible showroom.
  const canSeeAtOrigin = can(access, SMS_PERMISSIONS.STOCK_VIEW, raw.originShowroom.id);
  const canSeeAtResponsible = can(
    access,
    SMS_PERMISSIONS.STOCK_VIEW,
    raw.unit.responsibleShowroomId,
  );
  if (!canSeeAtOrigin && !canSeeAtResponsible) {
    throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
  }

  const locationForIdCheck = raw.originShowroom.id;
  const canViewId = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, locationForIdCheck);
  return mapToRow(raw, canViewId);
}

// ── Create (handover) ─────────────────────────────────────────────────────────

export async function createRtoContract(
  key: string,
  input: CreateRtoContractInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  // Pre-check: contract number uniqueness (non-locking read before the tx).
  const existing = await repo.findByContractNumber(input.contractNumber);
  if (existing) {
    throw new AppError(
      409,
      'SMS_CONTRACT_NUMBER_EXISTS',
      `Contract number "${input.contractNumber}" is already in use.`,
      [{ contractId: existing.id }],
    );
  }

  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'rto-contracts.create',
      payload: input,
      statusCode: 201,
    },
    async (tx) => {
      // Lock the unit.
      const unit = await lockUnit(tx, input.unitId);

      // Authorize: sms-rto:manage at unit.physicalLocationId.
      // A unit that can be handed over is always inside its showroom; for any
      // other state fall back to the responsible showroom so the caller gets
      // the state error (409) below instead of a misleading 403.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.RTO_MANAGE,
        unit.physicalLocationId ?? unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_UNIT_NOT_FOUND', message: 'Unit not found' },
      );

      // Guard: unit must be AVAILABLE or BOOKED.
      if (unit.status !== 'AVAILABLE' && unit.status !== 'BOOKED') {
        throw new AppError(
          409,
          'SMS_INVALID_TRANSITION',
          `Only AVAILABLE or BOOKED units can be handed over as RTO (this unit is ${unit.status}).`,
          [{ unitId: unit.id, status: unit.status }],
        );
      }

      // Guard: must not have an open contract already.
      if (unit.openRtoContractId !== null) {
        throw new AppError(
          409,
          'SMS_RTO_CONTRACT_ALREADY_OPEN',
          'This unit already has an open RTO contract.',
          [{ openRtoContractId: unit.openRtoContractId }],
        );
      }

      // Double-check contract number uniqueness inside the transaction.
      const existingInTx = await tx.smsRtoContract.findUnique({
        where: { contractNumber: input.contractNumber },
        select: { id: true },
      });
      if (existingInTx) {
        throw new AppError(
          409,
          'SMS_CONTRACT_NUMBER_EXISTS',
          `Contract number "${input.contractNumber}" is already in use.`,
          [{ contractId: existingInTx.id }],
        );
      }

      // Validate sales user.
      const salesUserOk = await repo.validateSalesUser(tx, input.salesUserId);
      if (!salesUserOk) {
        throw new AppError(422, 'SMS_SALES_USER_NOT_FOUND', 'Sales person not found.', [
          { field: 'salesUserId' },
        ]);
      }

      const now = new Date();
      const handoverAt = resolveTimestamp(input.handoverAt);

      // startDate must not be in the future.
      const startDate = resolveEventDate(input.startDate);

      const originShowroomId = unit.physicalLocationId!; // non-null: AVAILABLE/BOOKED is in a showroom

      // If BOOKED, default customer/sales from the order line when omitted.
      let customerName = input.customerName;
      let customerPhone = input.customerPhone;
      let customerIdNumber = input.customerIdNumber;
      let resolvedOrderLineId: string | null = null;

      if (unit.status === 'BOOKED' && unit.activeOrderLineId !== null) {
        const orderLine = await tx.smsOrderLine.findUnique({
          where: { id: unit.activeOrderLineId },
          select: {
            id: true,
            order: {
              select: {
                salesUserId: true,
                customerName: true,
                customerPhone: true,
                customerIdNumber: true,
              },
            },
          },
        });
        if (orderLine) {
          resolvedOrderLineId = orderLine.id;
          if (!customerName) customerName = orderLine.order.customerName;
          if (!customerPhone) customerPhone = orderLine.order.customerPhone ?? undefined;
          if (!customerIdNumber) customerIdNumber = orderLine.order.customerIdNumber ?? undefined;
        }
      }

      if (!customerName) {
        throw new AppError(422, 'VALIDATION_ERROR', 'customerName is required for a direct RTO handover (not from a booking).', [
          { field: 'customerName' },
        ]);
      }

      // Create the contract row.
      const contract = await tx.smsRtoContract.create({
        data: {
          contractNumber: input.contractNumber,
          unitId: unit.id,
          originShowroomId,
          orderLineId: resolvedOrderLineId,
          salesUserId: input.salesUserId,
          customerName,
          customerPhone: customerPhone ?? null,
          customerIdNumber: customerIdNumber ?? null,
          startDate,
          handoverAt,
          notes: input.notes ?? null,
          createdByUserId: actor.userId,
        },
        select: { id: true, contractNumber: true },
      });

      // If BOOKED, mark the order line as RTO_HANDED_OVER.
      if (resolvedOrderLineId !== null) {
        await tx.smsOrderLine.update({
          where: { id: resolvedOrderLineId },
          data: { status: 'RTO_HANDED_OVER', rtoHandoverAt: now },
        });
      }

      // Record the unit event.
      const eventDate = resolveEventDate(businessDateString(handoverAt));
      await recordUnitEvent(tx, unit, {
        event: { type: 'RTO_STARTED' },
        eventDate,
        performedByUserId: actor.userId,
        links: {
          rtoContractId: contract.id,
          ...(resolvedOrderLineId ? { orderLineId: resolvedOrderLineId } : {}),
        },
        unitChanges: {
          openRtoContractId: contract.id,
          // Clear active booking pointer when coming from BOOKED.
          ...(resolvedOrderLineId !== null ? { activeOrderLineId: null } : {}),
        },
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'CREATE',
        resourceType: 'SmsRtoContract',
        resourceId: contract.id,
        newValues: {
          contractNumber: contract.contractNumber,
          unitId: unit.id,
          originShowroomId,
          startDate: startDate.toISOString(),
        },
      });

      return { contractId: contract.id, contractNumber: contract.contractNumber };
    },
  );
}

// ── Return at responsible showroom ────────────────────────────────────────────

export async function returnRtoContract(
  contractId: string,
  key: string,
  input: RtoReturnInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'rto-contracts.return',
      payload: { contractId, ...input },
    },
    async (tx) => {
      // Lock the unit via the contract.
      const preliminary = await tx.smsRtoContract.findUnique({
        where: { id: contractId },
        select: { id: true, unitId: true, closedAt: true, returnedAt: true },
      });
      if (!preliminary) {
        throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
      }

      const unit = await lockUnit(tx, preliminary.unitId);

      // Authorize: sms-rto:manage at unit.responsibleShowroomId.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.RTO_MANAGE,
        unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_RTO_CONTRACT_NOT_FOUND', message: 'RTO contract not found' },
      );

      // Re-read contract under the unit lock.
      const contract = await tx.smsRtoContract.findUnique({
        where: { id: contractId },
        select: {
          id: true,
          unitId: true,
          closedAt: true,
          returnedAt: true,
          returnKind: true,
        },
      });
      if (!contract) {
        throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
      }

      // Idempotent: already returned.
      if (contract.returnedAt !== null) {
        return { contractId, alreadyDone: true as const };
      }

      // Guard: unit must be ACTIVE_RTO with this open contract.
      if (unit.status !== 'ACTIVE_RTO') {
        throw new AppError(
          409,
          'SMS_INVALID_TRANSITION',
          `Unit must be ACTIVE_RTO to record a same-branch return (this unit is ${unit.status}).`,
          [{ unitId: unit.id, status: unit.status }],
        );
      }
      if (unit.openRtoContractId !== contractId) {
        throw new AppError(
          409,
          'SMS_RTO_CONTRACT_NOT_OPEN',
          'This contract is not the open RTO contract for this unit.',
        );
      }

      const returnedAt = resolveTimestamp(input.returnedAt);
      const receivedAtShowroomId = unit.responsibleShowroomId;

      // Update contract.
      await tx.smsRtoContract.update({
        where: { id: contractId },
        data: {
          returnKind: input.returnKind,
          returnedAt,
          receivedAtShowroomId,
        },
      });

      // Create a PENDING inspection for RTO_RETURN.
      const inspection = await tx.smsInspection.create({
        data: {
          unitId: unit.id,
          reason: 'RTO_RETURN',
          result: 'PENDING',
          condition: input.condition,
          odometer: input.odometer ?? null,
          notes: input.notes ?? null,
          rtoContractId: contractId,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });

      // Record the unit event.
      const eventDate = resolveEventDate(businessDateString(returnedAt));
      await recordUnitEvent(tx, unit, {
        event: { type: 'RTO_RETURNED', locationId: receivedAtShowroomId },
        eventDate,
        performedByUserId: actor.userId,
        links: { rtoContractId: contractId, inspectionId: inspection.id },
        // Keep openRtoContractId — contract stays OPEN until admin closes it.
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsRtoContract',
        resourceId: contractId,
        newValues: {
          returnKind: input.returnKind,
          returnedAt: returnedAt.toISOString(),
          receivedAtShowroomId,
          inspectionId: inspection.id,
        },
      });

      return { contractId, alreadyDone: false as const, inspectionId: inspection.id };
    },
  );
}

// ── Close contract ────────────────────────────────────────────────────────────

export async function closeRtoContract(
  contractId: string,
  key: string,
  input: CloseRtoContractInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'rto-contracts.close',
      payload: { contractId, ...input },
    },
    async (tx) => {
      const preliminary = await tx.smsRtoContract.findUnique({
        where: { id: contractId },
        select: { id: true, unitId: true, closedAt: true },
      });
      if (!preliminary) {
        throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
      }

      const unit = await lockUnit(tx, preliminary.unitId);

      // Authorize: sms-rto:manage at unit.responsibleShowroomId.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.RTO_MANAGE,
        unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_RTO_CONTRACT_NOT_FOUND', message: 'RTO contract not found' },
      );

      // Re-read contract.
      const contract = await tx.smsRtoContract.findUnique({
        where: { id: contractId },
        select: {
          id: true,
          unitId: true,
          closedAt: true,
          returnedAt: true,
          receivedAtShowroomId: true,
          returnKind: true,
        },
      });
      if (!contract) {
        throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
      }

      // Idempotent: already closed.
      if (contract.closedAt !== null) {
        return { contractId, alreadyDone: true as const };
      }

      // Guard: motorcycle must be physically back (returned or received via cross-branch).
      const isBack =
        contract.returnedAt !== null || contract.receivedAtShowroomId !== null;
      if (!isBack) {
        throw new AppError(
          409,
          'SMS_CONTRACT_NOT_RETURNED',
          'The motorcycle has not been returned yet. Close only after physical return. Use ownership-transfer if the customer keeps the motorcycle.',
          [{ hint: 'If the customer is returning via another showroom, wait for the official receipt.' }],
        );
      }

      const now = new Date();
      const closedOn = input.closedOn
        ? resolveEventDate(input.closedOn)
        : businessToday(now);

      // Determine outcome from returnKind.
      const outcome =
        contract.returnKind === 'REPOSSESSED' ? 'REPOSSESSED' : 'RETURNED';

      await tx.smsRtoContract.update({
        where: { id: contractId },
        data: {
          closedAt: now,
          closedByUserId: actor.userId,
          legalReference: input.legalReference ?? null,
          notes: input.notes ? input.notes : undefined,
          outcome,
        },
      });

      // Record the event; openRtoContractId: null is applied atomically via unitChanges.
      await recordUnitEvent(tx, unit, {
        event: { type: 'RTO_CONTRACT_CLOSED' },
        eventDate: closedOn,
        performedByUserId: actor.userId,
        links: { rtoContractId: contractId },
        unitChanges: { openRtoContractId: null },
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsRtoContract',
        resourceId: contractId,
        newValues: {
          closedAt: now.toISOString(),
          outcome,
          legalReference: input.legalReference ?? null,
        },
      });

      return { contractId, alreadyDone: false as const, outcome };
    },
  );
}

// ── Ownership transfer ────────────────────────────────────────────────────────

export async function transferOwnership(
  contractId: string,
  key: string,
  input: OwnershipTransferInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'rto-contracts.ownership-transfer',
      payload: { contractId, ...input },
    },
    async (tx) => {
      const preliminary = await tx.smsRtoContract.findUnique({
        where: { id: contractId },
        select: { id: true, unitId: true, closedAt: true, returnedAt: true },
      });
      if (!preliminary) {
        throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
      }

      const unit = await lockUnit(tx, preliminary.unitId);

      // Authorize: sms-rto:manage at unit.responsibleShowroomId.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.RTO_MANAGE,
        unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_RTO_CONTRACT_NOT_FOUND', message: 'RTO contract not found' },
      );

      // Re-read contract.
      const contract = await tx.smsRtoContract.findUnique({
        where: { id: contractId },
        select: { id: true, unitId: true, closedAt: true, returnedAt: true },
      });
      if (!contract) {
        throw new AppError(404, 'SMS_RTO_CONTRACT_NOT_FOUND', 'RTO contract not found');
      }

      // Idempotent: already transferred.
      if (contract.closedAt !== null) {
        return { contractId, alreadyDone: true as const };
      }

      // Guard: unit must be ACTIVE_RTO with this open contract (not returned).
      if (unit.status !== 'ACTIVE_RTO') {
        throw new AppError(
          409,
          'SMS_INVALID_TRANSITION',
          `Only an ACTIVE_RTO unit can have ownership transferred (this unit is ${unit.status}).`,
          [{ unitId: unit.id, status: unit.status }],
        );
      }
      if (unit.openRtoContractId !== contractId) {
        throw new AppError(
          409,
          'SMS_RTO_CONTRACT_NOT_OPEN',
          'This contract is not the open RTO contract for this unit.',
        );
      }
      if (contract.returnedAt !== null) {
        throw new AppError(
          409,
          'SMS_CONTRACT_ALREADY_RETURNED',
          'The motorcycle has been returned. Use close instead of ownership-transfer.',
        );
      }

      const now = new Date();
      const transferredOn = input.transferredOn
        ? resolveEventDate(input.transferredOn)
        : businessToday(now);

      // Close the contract atomically.
      await tx.smsRtoContract.update({
        where: { id: contractId },
        data: {
          closedAt: now,
          closedByUserId: actor.userId,
          legalReference: input.legalReference ?? null,
          notes: input.notes ? input.notes : undefined,
          outcome: 'OWNERSHIP_TRANSFERRED',
        },
      });

      // Record the unit event (PICKED_UP, physical null).
      await recordUnitEvent(tx, unit, {
        event: { type: 'RTO_OWNERSHIP_TRANSFERRED' },
        eventDate: transferredOn,
        performedByUserId: actor.userId,
        links: { rtoContractId: contractId },
        unitChanges: { openRtoContractId: null },
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsRtoContract',
        resourceId: contractId,
        newValues: {
          closedAt: now.toISOString(),
          outcome: 'OWNERSHIP_TRANSFERRED',
          legalReference: input.legalReference ?? null,
        },
      });

      return { contractId, alreadyDone: false as const, outcome: 'OWNERSHIP_TRANSFERRED' as const };
    },
  );
}
