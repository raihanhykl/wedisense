/**
 * Return-requests service — cross-branch returns and custody ("titipan").
 *
 * Concurrency rules:
 *   - The unit row is always locked FIRST (lockUnit), then the return request is
 *     re-read from within the same transaction after the lock.
 *   - The decide step uses a conditional WHERE decision='PENDING' UPDATE to
 *     prevent two admins from deciding simultaneously (second one → 409).
 *   - Every mutation is wrapped in runIdempotent → smsTransaction.
 */
import { SMS_PERMISSIONS, SMS_STOCK_LOCATION_TYPES } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import { prisma } from '../../../lib/prisma.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { generateReturnRequestNumber } from '../../../utils/document-number.js';
import {
  assertCan,
  can,
  canAnywhere,
  locationScope,
  type SmsAccess,
} from '../lib/access.js';
import {
  lockUnit,
  recordUnitEvent,
  businessDateString,
} from '../lib/ledger.js';
import { createAuditLog } from '../lib/audit.js';
import { runIdempotent, type IdempotentResult } from '../lib/idempotency.js';
import { notifySmsPermission, notifySmsUsers } from '../lib/notify.js';
import * as repo from './repository.js';
import type {
  CreateReturnRequestInput,
  CustodyReceivedInput,
  DecideInput,
  OfficialReceiptInput,
  CustodyHandbackInput,
  ListReturnRequestsQuery,
} from './schema.js';
import type { ReturnRequestRow, ReturnRequestLookupHit } from './types.js';

const REQUEST_NOT_FOUND = { code: 'SMS_RETURN_REQUEST_NOT_FOUND', message: 'Return request not found' } as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveTimestamp(input: string | undefined, now: Date): Date {
  if (!input) return now;
  const dt = new Date(input);
  if (dt.getTime() > now.getTime()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Datetime cannot be in the future');
  }
  return dt;
}

// ── List and detail ───────────────────────────────────────────────────────────

export async function listReturnRequests(
  query: ListReturnRequestsQuery,
  access: SmsAccess,
): Promise<{ data: ReturnRequestRow[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  if (query.showroomId) {
    // Caller must hold STOCK_VIEW at this showroom to query its requests
    if (!can(access, SMS_PERMISSIONS.STOCK_VIEW, query.showroomId)) {
      throw new AppError(403, 'SMS_FORBIDDEN_AT_LOCATION', 'You do not have access to this showroom.');
    }
  }

  const scopeShowroomIds =
    query.showroomId !== undefined
      ? undefined
      : locationScope(access, SMS_PERMISSIONS.STOCK_VIEW);

  const { skip, take, page, limit } = parsePagination(query);

  const { data, total } = await repo.findMany(
    {
      showroomId: query.showroomId,
      direction: query.direction,
      status: query.status,
      scopeShowroomIds: scopeShowroomIds === 'ALL' ? 'ALL' : scopeShowroomIds,
    },
    skip,
    take,
  );

  const rows = data.map((raw) => {
    const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
    return repo.mapToRow(raw, canViewCustomer);
  });

  return { data: rows, meta: buildPaginationMeta(page, limit, total) };
}

export async function getReturnRequest(
  id: string,
  access: SmsAccess,
): Promise<ReturnRequestRow> {
  const raw = await repo.findById(id);
  if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);

  const canSeeFrom = can(access, SMS_PERMISSIONS.STOCK_VIEW, raw.fromShowroomId);
  const canSeeTo = can(access, SMS_PERMISSIONS.STOCK_VIEW, raw.toShowroomId);
  if (!canSeeFrom && !canSeeTo) {
    throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
  }

  const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
  return repo.mapToRow(raw, canViewCustomer);
}

// ── Lookup (limited cross-branch) ─────────────────────────────────────────────

export async function lookupUnitsForReturn(
  query: string,
  access: SmsAccess,
): Promise<ReturnRequestLookupHit[]> {
  // Caller must be able to request a return somewhere
  if (!canAnywhere(access, SMS_PERMISSIONS.RETURNS_REQUEST)) {
    throw new AppError(403, 'INSUFFICIENT_PERMISSION', 'You need sms-returns:request permission to use the lookup.');
  }

  const units = await repo.findUnitsForLookup(query);

  return units.map((u) => {
    const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, u.responsibleShowroomId);
    const customerName = u.openRtoContract?.customerName ?? 'Unknown';
    return {
      unitId: u.id,
      vin: u.vin,
      variant: {
        modelName: u.variant.model.name,
        variantName: u.variant.name,
        batteryVariant: u.variant.batteryVariant,
        color: u.variant.color,
      },
      status: u.status,
      responsibleShowroom: u.responsibleShowroom,
      rtoContractNumber: u.openRtoContract?.contractNumber ?? null,
      customerName: canViewCustomer ? customerName : '[Hidden]',
      openReturnRequest: u.openReturnRequest
        ? {
            id: u.openReturnRequest.id,
            requestNumber: u.openReturnRequest.requestNumber,
            toShowroomId: u.openReturnRequest.toShowroomId,
            toShowroomName: u.openReturnRequest.toShowroom.name,
            decision: u.openReturnRequest.decision,
          }
        : null,
    };
  });
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createReturnRequest(
  input: CreateReturnRequestInput,
  access: SmsAccess,
  idempotencyKey: string,
): Promise<IdempotentResult<ReturnRequestRow>> {
  const userId = access.userId;
  const now = new Date();

  // Validate that toShowroomId is a stock location where caller holds RETURNS_REQUEST
  const toShowroom = await prisma.location.findUnique({
    where: { id: input.toShowroomId },
    select: { id: true, name: true, type: true, isActive: true, deletedAt: true },
  });
  if (!toShowroom || !toShowroom.isActive || toShowroom.deletedAt !== null) {
    throw new AppError(404, 'SMS_LOCATION_NOT_FOUND', 'Target showroom not found');
  }
  if (!(SMS_STOCK_LOCATION_TYPES as readonly string[]).includes(toShowroom.type)) {
    throw new AppError(422, 'SMS_INVALID_LOCATION_TYPE', 'Target must be a stock location (showroom or branch)');
  }
  assertCan(access, SMS_PERMISSIONS.RETURNS_REQUEST, input.toShowroomId);

  const hasCustody = input.custodyReceivedAt !== undefined;
  if (hasCustody) {
    assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, input.toShowroomId);
  }

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      userId,
      operation: 'return-requests.create',
      payload: input,
      statusCode: 201,
    },
    async (tx) => {
      // Lock unit first, then read all dependent state
      const unit = await lockUnit(tx, input.unitId);

      // Permission was already validated before the transaction (assertCan at
      // line 175). Cross-branch returns are initiated by the toShowroom admin
      // who does NOT hold STOCK_VIEW at the responsible showroom, so we must
      // NOT use assertCanActOn here (it demands STOCK_VIEW at the unit's
      // current home). Re-assert the toShowroom permission inside the tx to
      // guard against a permission revocation that races the lock.
      assertCan(access, SMS_PERMISSIONS.RETURNS_REQUEST, input.toShowroomId);

      if (!unit.openRtoContractId) {
        throw new AppError(422, 'SMS_NO_RTO_CONTRACT', 'Unit has no open RTO contract');
      }

      // fromShowroom = responsible showroom at the time of request
      const fromShowroomId = unit.responsibleShowroomId;

      // Cannot request a return to the same showroom
      if (fromShowroomId === input.toShowroomId) {
        throw new AppError(422, 'SMS_SAME_SHOWROOM', 'Cannot request a return to the responsible showroom');
      }

      // Check for an existing open return request. This must run BEFORE the
      // status check below because a supersede (rejected + custody) is a valid
      // path where the unit is CUSTODY rather than ACTIVE_RTO.
      const existingRequestId = unit.openReturnRequestId;
      let existingCustodyAt: Date | null = null;

      if (existingRequestId !== null) {
        const existing = await tx.smsReturnRequest.findUnique({
          where: { id: existingRequestId },
          select: {
            id: true,
            decision: true,
            toShowroomId: true,
            custodyReceivedAt: true,
            custodyResolvedAt: true,
          },
        });

        if (!existing) {
          // Orphan pointer — should not happen but tolerate it
        } else if (
          existing.decision === 'REJECTED' &&
          existing.custodyReceivedAt !== null &&
          existing.custodyResolvedAt === null &&
          existing.toShowroomId === input.toShowroomId
        ) {
          // Supersede: carry over custody; unit will stay CUSTODY
          existingCustodyAt = existing.custodyReceivedAt;
          await tx.smsReturnRequest.update({
            where: { id: existingRequestId },
            data: {
              custodyResolution: 'SUPERSEDED',
              custodyResolvedAt: now,
            },
          });
        } else {
          throw new AppError(
            409,
            'SMS_RETURN_REQUEST_EXISTS',
            'Unit already has an open return request',
            [{ requestId: existingRequestId }],
          );
        }
      }

      // Status check: ACTIVE_RTO for a fresh request; CUSTODY is valid only
      // when superseding a rejected request that already has custody.
      if (existingCustodyAt !== null) {
        // Supersede path: unit may be CUSTODY — allowed
        if (unit.status !== 'CUSTODY') {
          throw new AppError(422, 'SMS_INVALID_UNIT_STATUS', `Supersede requires CUSTODY status (is ${unit.status})`);
        }
      } else {
        if (unit.status !== 'ACTIVE_RTO') {
          throw new AppError(422, 'SMS_INVALID_UNIT_STATUS', `Unit must be ACTIVE_RTO (is ${unit.status})`);
        }
      }

      // Determine event date and custody date
      const eventDate = new Date(`${businessDateString(now)}T00:00:00.000Z`);
      const custodyAt = hasCustody
        ? resolveTimestamp(input.custodyReceivedAt, now)
        : (existingCustodyAt ?? null);

      // Generate request number
      const requestNumber = await generateReturnRequestNumber(tx, now);

      // Create the return request
      const returnRequest = await tx.smsReturnRequest.create({
        data: {
          requestNumber,
          unitId: unit.id,
          rtoContractId: unit.openRtoContractId,
          fromShowroomId,
          toShowroomId: input.toShowroomId,
          reason: input.reason,
          requestedByUserId: userId,
          custodyReceivedAt: custodyAt,
          decision: 'PENDING',
        },
      });

      // Record unit event (unitChanges below sets openReturnRequestId atomically).
      // CUSTODY_RECEIVED transitions ACTIVE_RTO → CUSTODY and is only fired when
      // the caller explicitly supplies custodyReceivedAt (hasCustody = true).
      // For the supersede path the unit is already CUSTODY; use RETURN_REQUESTED
      // (valid from ACTIVE_RTO and CUSTODY) so the state stays unchanged.
      if (hasCustody) {
        await recordUnitEvent(tx, unit, {
          event: { type: 'CUSTODY_RECEIVED', locationId: input.toShowroomId },
          eventDate,
          performedByUserId: userId,
          notes: input.notes,
          links: { returnRequestId: returnRequest.id, rtoContractId: unit.openRtoContractId ?? undefined },
          unitChanges: { openReturnRequestId: returnRequest.id },
        });
      } else {
        await recordUnitEvent(tx, unit, {
          event: { type: 'RETURN_REQUESTED' },
          eventDate,
          performedByUserId: userId,
          notes: input.notes,
          links: { returnRequestId: returnRequest.id, rtoContractId: unit.openRtoContractId ?? undefined },
          unitChanges: { openReturnRequestId: returnRequest.id },
        });
      }

      // Audit
      await createAuditLog(tx, {
        userId,
        action: 'CREATE',
        resourceType: 'SmsReturnRequest',
        resourceId: returnRequest.id,
        newValues: {
          requestNumber,
          unitId: unit.id,
          vin: unit.vin,
          fromShowroomId,
          toShowroomId: input.toShowroomId,
          reason: input.reason,
          hasCustody: custodyAt !== null,
        },
      });

      // Build row for response (re-read with relations)
      const raw = await tx.smsReturnRequest.findUniqueOrThrow({
        where: { id: returnRequest.id },
        include: {
          unit: { include: { variant: { include: { model: true } } } },
          rtoContract: { select: { contractNumber: true, customerName: true, customerPhone: true, customerIdNumber: true } },
          fromShowroom: true,
          toShowroom: true,
          requestedBy: true,
          decidedBy: true,
        },
      });

      const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, fromShowroomId);
      return repo.mapToRow(raw as Parameters<typeof repo.mapToRow>[0], canViewCustomer);
    },
  );

  // Send notifications after the transaction. notifySmsPermission catches all
  // internal errors, so await is safe — the HTTP response will not fail.
  if (!result.replayed) {
    const row = result.body;
    await notifySmsPermission(
      SMS_PERMISSIONS.RETURNS_DECIDE,
      row.fromShowroomId,
      'SMS_RETURN_REQUESTED',
      `Return request ${row.requestNumber} for VIN ${row.unit.vin}`,
      `${row.toShowroom.name} has requested to receive this motorcycle.${row.unit.status === 'CUSTODY' ? ' The motorcycle is already in their custody.' : ''}`,
      {
        kind: 'RETURN_REQUESTED',
        returnRequestId: row.id,
        unitId: row.unitId,
        vin: row.unit.vin,
        url: `/admin/sms/return-requests/${row.id}`,
      },
    );
  }

  return result;
}

// ── Custody received ──────────────────────────────────────────────────────────

export async function custodyReceived(
  requestId: string,
  input: CustodyReceivedInput,
  access: SmsAccess,
  idempotencyKey: string,
): Promise<IdempotentResult<ReturnRequestRow>> {
  const userId = access.userId;
  const now = new Date();

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      userId,
      operation: 'return-requests.custody-received',
      payload: { requestId, ...input },
    },
    async (tx) => {
      // Read request first to get unitId, then lock unit
      const preRead = await tx.smsReturnRequest.findUnique({
        where: { id: requestId },
        select: { unitId: true, toShowroomId: true, decision: true, custodyReceivedAt: true },
      });
      if (!preRead) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);

      // Authorize at toShowroom
      assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, preRead.toShowroomId);

      // Idempotent: already received
      if (preRead.custodyReceivedAt !== null) {
        const raw = await repo.findById(requestId);
        if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
        const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
        return repo.mapToRow(raw, canViewCustomer);
      }

      // Lock unit
      const unit = await lockUnit(tx, preRead.unitId);

      // Re-read request after lock
      const req = await tx.smsReturnRequest.findUniqueOrThrow({ where: { id: requestId } });

      // Guard: request must be visible at toShowroom
      if (!can(access, SMS_PERMISSIONS.STOCK_VIEW, req.toShowroomId)) {
        throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
      }

      if (req.decision !== 'PENDING') {
        throw new AppError(
          422,
          'SMS_CUSTODY_NOT_APPLICABLE',
          'Custody is only applicable while the request is PENDING. If APPROVED, use official receipt.',
        );
      }
      if (unit.status !== 'ACTIVE_RTO') {
        throw new AppError(
          422,
          'SMS_INVALID_UNIT_STATUS',
          `Custody received requires the unit to be ACTIVE_RTO (is ${unit.status})`,
        );
      }

      const custodyAt = resolveTimestamp(input.custodyReceivedAt, now);
      const eventDate = new Date(`${businessDateString(now)}T00:00:00.000Z`);

      await tx.smsReturnRequest.update({
        where: { id: requestId },
        data: { custodyReceivedAt: custodyAt },
      });

      await recordUnitEvent(tx, unit, {
        event: { type: 'CUSTODY_RECEIVED', locationId: req.toShowroomId },
        eventDate,
        performedByUserId: userId,
        notes: input.notes,
        links: { returnRequestId: requestId },
      });

      await createAuditLog(tx, {
        userId,
        action: 'UPDATE',
        resourceType: 'SmsReturnRequest',
        resourceId: requestId,
        newValues: { custodyReceivedAt: custodyAt.toISOString() },
      });

      const raw = await repo.findByIdTx(tx, requestId);
      if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
      const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
      return repo.mapToRow(raw, canViewCustomer);
    },
  );

  return result;
}

// ── Decide ────────────────────────────────────────────────────────────────────

export async function decideReturnRequest(
  requestId: string,
  input: DecideInput,
  access: SmsAccess,
  idempotencyKey: string,
): Promise<IdempotentResult<ReturnRequestRow>> {
  const userId = access.userId;
  const now = new Date();

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      userId,
      operation: 'return-requests.decide',
      payload: { requestId, ...input },
    },
    async (tx) => {
      // Pre-read to get fromShowroomId and unitId for locking
      const preRead = await tx.smsReturnRequest.findUnique({
        where: { id: requestId },
        select: { unitId: true, fromShowroomId: true, toShowroomId: true, decision: true },
      });
      if (!preRead) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);

      // Authorize: sms-returns:decide at fromShowroom (global also qualifies)
      assertCan(access, SMS_PERMISSIONS.RETURNS_DECIDE, preRead.fromShowroomId);

      // Lock unit
      const unit = await lockUnit(tx, preRead.unitId);

      // Conditional update: only succeeds if decision is still PENDING
      const updated = await repo.decideReturnRequest(tx, requestId, {
        decision: input.decision,
        decidedByUserId: userId,
        decidedAt: now,
        decisionReason: input.decision === 'REJECTED' ? (input.reason ?? null) : null,
      });

      if (updated === null) {
        // Someone else already decided — return current state with 409
        const existing = await tx.smsReturnRequest.findUniqueOrThrow({ where: { id: requestId } });
        throw new AppError(
          409,
          'SMS_RETURN_ALREADY_DECIDED',
          'This return request has already been decided.',
          [{
            decision: existing.decision,
            decidedByUserId: existing.decidedByUserId,
            decidedAt: existing.decidedAt?.toISOString(),
          }],
        );
      }

      const eventDate = new Date(`${businessDateString(now)}T00:00:00.000Z`);

      if (input.decision === 'REJECTED') {
        // Record event
        await recordUnitEvent(tx, unit, {
          event: { type: 'RETURN_REJECTED' },
          eventDate,
          performedByUserId: userId,
          reason: input.reason,
          links: { returnRequestId: requestId },
        });

        // If no custody: clear the pointer and the request is effectively closed
        if (unit.status === 'ACTIVE_RTO') {
          await tx.smsUnit.update({
            where: { id: unit.id },
            data: { openReturnRequestId: null },
          });
        }
        // If CUSTODY: unit stays CUSTODY, request stays open with pointer intact
      } else {
        // APPROVED
        await recordUnitEvent(tx, unit, {
          event: { type: 'RETURN_APPROVED' },
          eventDate,
          performedByUserId: userId,
          links: { returnRequestId: requestId },
        });
      }

      await createAuditLog(tx, {
        userId,
        action: 'UPDATE',
        resourceType: 'SmsReturnRequest',
        resourceId: requestId,
        newValues: {
          decision: input.decision,
          decidedAt: now.toISOString(),
          ...(input.decision === 'REJECTED' ? { reason: input.reason } : {}),
        },
      });

      const raw = await repo.findByIdTx(tx, requestId);
      if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
      const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
      return repo.mapToRow(raw, canViewCustomer);
    },
  );

  // Send notifications after the transaction. Both helpers catch their own
  // errors, so awaiting is safe — the HTTP response will not fail.
  if (!result.replayed) {
    const row = result.body;
    // Notify: requester + holders of sms-receiving:manage at toShowroom
    await notifySmsUsers(
      [row.requestedByUserId],
      'SMS_RETURN_DECIDED',
      `Return request ${row.requestNumber} ${input.decision.toLowerCase()}`,
      `Your return request for VIN ${row.unit.vin} has been ${input.decision.toLowerCase()}.${input.decision === 'REJECTED' && input.reason ? ` Reason: ${input.reason}` : ''}`,
      {
        kind: 'RETURN_DECIDED',
        returnRequestId: row.id,
        unitId: row.unitId,
        vin: row.unit.vin,
        decision: input.decision,
        url: `/admin/sms/return-requests/${row.id}`,
      },
    );
    await notifySmsPermission(
      SMS_PERMISSIONS.RECEIVING_MANAGE,
      row.toShowroomId,
      'SMS_RETURN_DECIDED',
      `Return request ${row.requestNumber} ${input.decision.toLowerCase()}`,
      `The return request for VIN ${row.unit.vin} has been ${input.decision.toLowerCase()} by ${row.fromShowroom.name}.`,
      {
        kind: 'RETURN_DECIDED',
        returnRequestId: row.id,
        unitId: row.unitId,
        vin: row.unit.vin,
        decision: input.decision,
        url: `/admin/sms/return-requests/${row.id}`,
      },
    );
  }

  return result;
}

// ── Official receipt ──────────────────────────────────────────────────────────

export async function officialReceipt(
  requestId: string,
  input: OfficialReceiptInput,
  access: SmsAccess,
  idempotencyKey: string,
): Promise<IdempotentResult<ReturnRequestRow>> {
  const userId = access.userId;
  const now = new Date();

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      userId,
      operation: 'return-requests.official-receipt',
      payload: { requestId, ...input },
    },
    async (tx) => {
      // Pre-read for unitId
      const preRead = await tx.smsReturnRequest.findUnique({
        where: { id: requestId },
        select: { unitId: true, toShowroomId: true, decision: true, officialReceivedAt: true },
      });
      if (!preRead) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);

      // Authorize at toShowroom
      assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, preRead.toShowroomId);

      // Idempotent: already received
      if (preRead.officialReceivedAt !== null) {
        const raw = await repo.findById(requestId);
        if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
        const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
        return repo.mapToRow(raw, canViewCustomer);
      }

      // Lock unit
      const unit = await lockUnit(tx, preRead.unitId);

      // Re-read request after lock
      const req = await tx.smsReturnRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          id: true,
          decision: true,
          toShowroomId: true,
          rtoContractId: true,
          custodyReceivedAt: true,
          officialReceivedAt: true,
        },
      });

      if (req.decision !== 'APPROVED') {
        throw new AppError(422, 'SMS_NOT_APPROVED', 'Return request must be APPROVED before official receipt');
      }

      if (unit.status !== 'ACTIVE_RTO' && unit.status !== 'CUSTODY') {
        throw new AppError(
          422,
          'SMS_INVALID_UNIT_STATUS',
          `Official receipt requires ACTIVE_RTO or CUSTODY (is ${unit.status})`,
        );
      }

      const receivedAt = resolveTimestamp(input.officialReceivedAt, now);
      const eventDate = new Date(`${businessDateString(now)}T00:00:00.000Z`);

      // Record unit event: OFFICIAL_RECEIPT_CONFIRMED
      // This transitions: CUSTODY or ACTIVE_RTO → INSPECTION, responsibleShowroom = toShowroom
      const { unit: updatedUnit } = await recordUnitEvent(tx, unit, {
        event: { type: 'OFFICIAL_RECEIPT_CONFIRMED', locationId: req.toShowroomId },
        eventDate,
        performedByUserId: userId,
        notes: input.notes,
        links: { returnRequestId: requestId, rtoContractId: req.rtoContractId ?? undefined },
        unitChanges: {
          openReturnRequestId: null,
        },
      });
      void updatedUnit;

      // Update the return request
      await tx.smsReturnRequest.update({
        where: { id: requestId },
        data: { officialReceivedAt: receivedAt },
      });

      // Update the RTO contract: set returnKind, returnedAt, receivedAtShowroomId — but leave closedAt null
      if (req.rtoContractId) {
        await tx.smsRtoContract.update({
          where: { id: req.rtoContractId },
          data: {
            returnKind: 'RETURNED_BY_CUSTOMER',
            returnedAt: receivedAt,
            receivedAtShowroomId: req.toShowroomId,
          },
        });
      }

      // Create a PENDING inspection linked to this return request
      await tx.smsInspection.create({
        data: {
          unitId: unit.id,
          reason: 'CROSS_BRANCH_RETURN',
          result: 'PENDING',
          condition: input.condition,
          odometer: input.odometer,
          notes: input.notes,
          returnRequestId: requestId,
          rtoContractId: req.rtoContractId,
          createdByUserId: userId,
        },
      });

      await createAuditLog(tx, {
        userId,
        action: 'UPDATE',
        resourceType: 'SmsReturnRequest',
        resourceId: requestId,
        newValues: {
          officialReceivedAt: receivedAt.toISOString(),
          rtoContractUpdated: req.rtoContractId !== null,
        },
      });

      const raw = await repo.findByIdTx(tx, requestId);
      if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
      const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
      return repo.mapToRow(raw, canViewCustomer);
    },
  );

  return result;
}

// ── Custody handback ──────────────────────────────────────────────────────────

export async function custodyHandback(
  requestId: string,
  input: CustodyHandbackInput,
  access: SmsAccess,
  idempotencyKey: string,
): Promise<IdempotentResult<ReturnRequestRow>> {
  const userId = access.userId;
  const now = new Date();

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      userId,
      operation: 'return-requests.custody-handback',
      payload: { requestId, ...input },
    },
    async (tx) => {
      // Pre-read for unitId
      const preRead = await tx.smsReturnRequest.findUnique({
        where: { id: requestId },
        select: {
          unitId: true,
          toShowroomId: true,
          decision: true,
          custodyReceivedAt: true,
          custodyResolvedAt: true,
        },
      });
      if (!preRead) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);

      // Authorize at toShowroom
      assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, preRead.toShowroomId);

      // Guard: rejected with unresolved custody
      if (preRead.decision !== 'REJECTED') {
        throw new AppError(422, 'SMS_NOT_REJECTED', 'Custody handback is only for REJECTED requests');
      }
      if (preRead.custodyReceivedAt === null) {
        throw new AppError(422, 'SMS_NO_CUSTODY', 'No custody to hand back (motorcycle was never in custody here)');
      }
      if (preRead.custodyResolvedAt !== null) {
        throw new AppError(422, 'SMS_CUSTODY_ALREADY_RESOLVED', 'Custody has already been resolved');
      }

      // Lock unit
      const unit = await lockUnit(tx, preRead.unitId);

      if (unit.status !== 'CUSTODY') {
        throw new AppError(422, 'SMS_INVALID_UNIT_STATUS', `Handback requires CUSTODY status (is ${unit.status})`);
      }

      const handedBackAt = resolveTimestamp(input.handedBackAt, now);
      const eventDate = new Date(`${businessDateString(now)}T00:00:00.000Z`);

      // Record CUSTODY_HANDED_BACK: CUSTODY → ACTIVE_RTO, physicalLocationId = null
      await recordUnitEvent(tx, unit, {
        event: { type: 'CUSTODY_HANDED_BACK' },
        eventDate,
        performedByUserId: userId,
        notes: input.notes,
        links: { returnRequestId: requestId },
        unitChanges: {
          openReturnRequestId: null,
        },
      });

      await tx.smsReturnRequest.update({
        where: { id: requestId },
        data: {
          custodyResolvedAt: handedBackAt,
          custodyResolution: 'HANDED_BACK',
        },
      });

      // openReturnRequestId: null is already applied via unitChanges inside recordUnitEvent above
      await createAuditLog(tx, {
        userId,
        action: 'UPDATE',
        resourceType: 'SmsReturnRequest',
        resourceId: requestId,
        newValues: {
          custodyResolution: 'HANDED_BACK',
          custodyResolvedAt: handedBackAt.toISOString(),
        },
      });

      const raw = await repo.findByIdTx(tx, requestId);
      if (!raw) throw new AppError(404, REQUEST_NOT_FOUND.code, REQUEST_NOT_FOUND.message);
      const canViewCustomer = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, raw.fromShowroomId);
      return repo.mapToRow(raw, canViewCustomer);
    },
  );

  return result;
}
