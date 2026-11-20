/**
 * Orders (SPK) service — booking, sale recording, pickup and line management.
 *
 * Concurrency rules (enforced per the SMS spec §6):
 *   - ALL units for a booking are locked in sorted ID order before any state
 *     is read, so two concurrent booking requests for overlapping VINs
 *     serialise rather than racing.
 *   - Every mutation runs inside `runIdempotent` → `smsTransaction`, so a
 *     double-click or a retry after a dropped connection replays the stored
 *     response instead of recording a second event.
 */
import { Prisma } from '@prisma/client';
import { SMS_PERMISSIONS, SMS_BOOKING_FOLLOW_UP_DAYS } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import {
  assertCan,
  assertCanActOn,
  can,
  locationScope,
  type SmsAccess,
} from '../lib/access.js';
import { smsTransaction } from '../lib/transaction.js';
import { businessDateString, businessToday, recordUnitEvent, resolveEventDate } from '../lib/ledger.js';
import { createAuditLog } from '../lib/audit.js';
import { runIdempotent } from '../lib/idempotency.js';
import type { SmsActor } from '../lib/types.js';
import type { PrismaTransactionClient } from '../lib/types.js';
import * as repo from './repository.js';
import type {
  CreateOrderInput,
  AddLinesToOrderInput,
  CancelLineInput,
  FollowUpInput,
  RecordSaleInput,
  ConfirmPickupInput,
  ListOrdersQuery,
  SaleReturnInput,
  DecideSaleReturnInput,
} from './schema.js';
import type { BookingConflictDetail, OrderDetail } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Lock a single unit row (for cancel / confirm-pickup). */
async function lockSingleUnit(tx: PrismaTransactionClient, unitId: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM sms_units WHERE id = ${unitId}::uuid FOR UPDATE`,
  );
  return tx.smsUnit.findUniqueOrThrow({ where: { id: unitId } });
}

/**
 * Load an order line with its unit locked, reading the line AFTER the lock.
 *
 * A line's state only changes together with its unit, so holding the unit
 * row lock means the line cannot change under us. Reading the line before the
 * lock would let a concurrent cancel/sale/pickup commit in between and make
 * us act on a stale status.
 */
async function loadLineLocked(tx: PrismaTransactionClient, orderId: string, lineId: string) {
  const first = await repo.findOrderWithLine(tx, orderId, lineId);
  if (!first.order) throw new AppError(404, 'SMS_ORDER_NOT_FOUND', 'Order not found');
  if (!first.line) throw new AppError(404, 'SMS_ORDER_LINE_NOT_FOUND', 'Order line not found');
  // unitId of a line never changes, so it is safe to lock from the first read.
  const unit = await lockSingleUnit(tx, first.line.unitId);
  const fresh = await repo.findOrderWithLine(tx, orderId, lineId);
  if (!fresh.order || !fresh.line) {
    throw new AppError(404, 'SMS_ORDER_LINE_NOT_FOUND', 'Order line not found');
  }
  return { order: fresh.order, line: fresh.line, unit };
}

/** Lock multiple unit rows sorted (for record-sale). */
async function lockMultipleUnits(tx: PrismaTransactionClient, unitIds: string[]) {
  const sorted = [...new Set(unitIds)].sort();
  if (sorted.length === 0) return new Map<string, import('@prisma/client').SmsUnit>();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM sms_units WHERE id IN (${Prisma.join(sorted.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`,
  );
  const rows = await tx.smsUnit.findMany({ where: { id: { in: sorted } } });
  return new Map(rows.map((u) => [u.id, u]));
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listOrders(query: ListOrdersQuery, access: SmsAccess) {
  if (query.showroomId) {
    assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, query.showroomId);
  }
  const scope = locationScope(access, SMS_PERMISSIONS.STOCK_VIEW);
  const { skip, take, page, limit } = parsePagination(query);
  const { data, total } = await repo.findMany(query, scope, skip, take);
  return { data, meta: buildPaginationMeta(page, limit, total) };
}

// ── Detail ───────────────────────────────────────────────────────────────────

export async function getOrder(id: string, access: SmsAccess): Promise<OrderDetail> {
  const order = await repo.findById(id);
  if (!order) throw new AppError(404, 'SMS_ORDER_NOT_FOUND', 'Order not found');

  if (!can(access, SMS_PERMISSIONS.STOCK_VIEW, order.showroom.id)) {
    throw new AppError(404, 'SMS_ORDER_NOT_FOUND', 'Order not found');
  }

  const canViewId = can(access, SMS_PERMISSIONS.CUSTOMERS_VIEW, order.showroom.id);
  const canViewPhone = can(access, SMS_PERMISSIONS.STOCK_VIEW, order.showroom.id);

  return {
    ...order,
    customerPhone: canViewPhone ? order.customerPhone : null,
    customerIdNumber: canViewId ? order.customerIdNumber : null,
    customerIdNumberMasked: !canViewId && order.customerIdNumber !== null,
  };
}

// ── Booking helpers ───────────────────────────────────────────────────────────

function buildConflictMessage(conflict: BookingConflictDetail): string {
  switch (conflict.reason) {
    case 'ALREADY_BOOKED':
      if (conflict.currentHolder) {
        const salesPart = conflict.currentHolder.salesName
          ? ` by ${conflict.currentHolder.salesName}`
          : '';
        return `VIN ${conflict.vin} is already booked${salesPart} for SPK ${conflict.currentHolder.spkNumber}`;
      }
      return `VIN ${conflict.vin} is already booked`;
    case 'NOT_AVAILABLE':
      return `VIN ${conflict.vin} is not available (current status: ${conflict.status ?? 'unknown'})`;
    case 'NOT_AT_SHOWROOM':
      return `VIN ${conflict.vin} is not physically at this showroom`;
    case 'NOT_FOUND':
      return `Unit ${conflict.unitId} not found`;
  }
}

/**
 * Core booking transaction body — shared by createOrder and addLinesToOrder.
 *
 * Locks all units sorted, evaluates every unit against the booking rules,
 * collects ALL failures, and throws ONE 409 if any fails. On success, creates
 * the order lines and unit events inside the same transaction.
 */
async function bookUnits(
  tx: PrismaTransactionClient,
  opts: {
    orderId: string;
    showroomId: string;
    unitIds: string[];
    performedByUserId: string;
    access: SmsAccess;
    now: Date;
  },
): Promise<void> {
  const { orderId, showroomId, unitIds, performedByUserId, access, now } = opts;

  const unitsById = await repo.lockUnitsForBooking(tx, unitIds);
  const conflicts: BookingConflictDetail[] = [];

  for (const unitId of unitIds) {
    const unit = unitsById.get(unitId) ?? null;

    if (!unit) {
      conflicts.push({ unitId, vin: unitId, reason: 'NOT_FOUND', status: null, alternatives: [] });
      continue;
    }

    // Authoritative location-scoped auth: caller must hold ORDERS_MANAGE at the
    // unit's current physical location. Surface as NOT_FOUND (not 403) to avoid
    // leaking stock existence at locations the caller is not authorised to see.
    if (!can(access, SMS_PERMISSIONS.ORDERS_MANAGE, unit.physicalLocationId)) {
      conflicts.push({ unitId, vin: unitId, reason: 'NOT_FOUND', status: null, alternatives: [] });
      continue;
    }

    if (unit.status !== 'AVAILABLE') {
      const reason: BookingConflictDetail['reason'] =
        unit.activeOrderLineId !== null ? 'ALREADY_BOOKED' : 'NOT_AVAILABLE';

      let currentHolder: BookingConflictDetail['currentHolder'] | undefined;
      if (reason === 'ALREADY_BOOKED' && unit.activeOrderLineId !== null) {
        const visibleAtPhysical = can(access, SMS_PERMISSIONS.STOCK_VIEW, unit.physicalLocationId);
        const visibleAtResponsible = can(access, SMS_PERMISSIONS.STOCK_VIEW, unit.responsibleShowroomId);
        if (visibleAtPhysical || visibleAtResponsible) {
          const holder = await repo.findCurrentHolder(tx, unit.activeOrderLineId);
          if (holder) currentHolder = holder;
        }
      }

      const alternatives = await repo.findAlternatives(tx, unit.variantId, showroomId, unitIds);
      conflicts.push({ unitId, vin: unit.vin, reason, status: unit.status, currentHolder, alternatives });
      continue;
    }

    if (unit.physicalLocationId !== showroomId) {
      const alternatives = await repo.findAlternatives(tx, unit.variantId, showroomId, unitIds);
      conflicts.push({
        unitId,
        vin: unit.vin,
        reason: 'NOT_AT_SHOWROOM',
        status: unit.status,
        alternatives,
      });
      continue;
    }
  }

  if (conflicts.length > 0) {
    const message =
      conflicts.length === 1
        ? buildConflictMessage(conflicts[0]!)
        : `${conflicts.length} units could not be booked`;
    throw new AppError(409, 'SMS_BOOKING_CONFLICT', message, conflicts);
  }

  // All units passed — create lines and record events.
  const bookedAt = now;
  const followUpAt = addDays(now, SMS_BOOKING_FOLLOW_UP_DAYS);

  for (const unitId of unitIds) {
    const unit = unitsById.get(unitId);
    if (!unit) continue; // already handled above

    const line = await tx.smsOrderLine.create({
      data: { orderId, unitId, status: 'BOOKED', bookedAt, followUpAt },
      select: { id: true },
    });

    // recordUnitEvent handles BOTH the event row AND the unit.activeOrderLineId update
    // via unitChanges (injected into the same UPDATE).
    await recordUnitEvent(tx, unit, {
      event: { type: 'BOOKING_CREATED' },
      eventDate: bookedAt,
      performedByUserId,
      links: { orderLineId: line.id },
      unitChanges: { activeOrderLineId: line.id },
    });
  }
}

// ── Create order ──────────────────────────────────────────────────────────────

export async function createOrder(
  key: string,
  input: CreateOrderInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  assertCan(access, SMS_PERMISSIONS.ORDERS_MANAGE, input.showroomId);

  const salesUserExists = await repo.validateSalesUser(input.salesUserId);
  if (!salesUserExists) {
    throw new AppError(422, 'SMS_SALES_USER_NOT_FOUND', 'Sales person not found or is not active', [
      { field: 'salesUserId' },
    ]);
  }

  // Check SPK uniqueness before entering the transaction (non-locking read).
  const existing = await repo.findOrderBySpk(input.showroomId, input.spkNumber);
  if (existing) {
    const canView = can(access, SMS_PERMISSIONS.STOCK_VIEW, input.showroomId);
    throw new AppError(
      409,
      'SMS_SPK_ALREADY_EXISTS',
      `SPK "${input.spkNumber}" already exists for this showroom`,
      canView ? [{ orderId: existing.id }] : [],
    );
  }

  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.create',
      payload: input,
      statusCode: 201,
    },
    async (tx) => {
      // Double-check SPK uniqueness inside the transaction (defense in depth).
      const existingInTx = await tx.smsOrder.findUnique({
        where: { showroomId_spkNumber: { showroomId: input.showroomId, spkNumber: input.spkNumber } },
        select: { id: true },
      });
      if (existingInTx) {
        const canView = can(access, SMS_PERMISSIONS.STOCK_VIEW, input.showroomId);
        throw new AppError(
          409,
          'SMS_SPK_ALREADY_EXISTS',
          `SPK "${input.spkNumber}" already exists for this showroom`,
          canView ? [{ orderId: existingInTx.id }] : [],
        );
      }

      const now = new Date();
      const order = await tx.smsOrder.create({
        data: {
          showroomId: input.showroomId,
          spkNumber: input.spkNumber,
          salesUserId: input.salesUserId,
          customerName: input.customerName,
          customerPhone: input.customerPhone ?? null,
          customerIdNumber: input.customerIdNumber ?? null,
          notes: input.notes ?? null,
          isOpeningBalance: false,
          createdByUserId: actor.userId,
        },
        select: { id: true, spkNumber: true, showroomId: true },
      });

      await bookUnits(tx, {
        orderId: order.id,
        showroomId: input.showroomId,
        unitIds: input.unitIds,
        performedByUserId: actor.userId,
        access,
        now,
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'CREATE',
        resourceType: 'SmsOrder',
        resourceId: order.id,
        newValues: {
          spkNumber: order.spkNumber,
          showroomId: order.showroomId,
          unitCount: input.unitIds.length,
        },
      });

      return { orderId: order.id, spkNumber: order.spkNumber, bookedCount: input.unitIds.length };
    },
  );
}

// ── Add lines to existing order ───────────────────────────────────────────────

export async function addLinesToOrder(
  orderId: string,
  key: string,
  input: AddLinesToOrderInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.add-lines',
      payload: { orderId, ...input },
    },
    async (tx) => {
      const order = await tx.smsOrder.findUnique({
        where: { id: orderId },
        select: { id: true, showroomId: true, spkNumber: true },
      });
      if (!order) throw new AppError(404, 'SMS_ORDER_NOT_FOUND', 'Order not found');

      assertCanActOn(
        access,
        SMS_PERMISSIONS.ORDERS_MANAGE,
        order.showroomId,
        [order.showroomId],
        { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
      );

      const now = new Date();
      await bookUnits(tx, {
        orderId: order.id,
        showroomId: order.showroomId,
        unitIds: input.unitIds,
        performedByUserId: actor.userId,
        access,
        now,
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsOrder',
        resourceId: order.id,
        newValues: { addedUnits: input.unitIds.length },
      });

      return { orderId: order.id, spkNumber: order.spkNumber, addedCount: input.unitIds.length };
    },
  );
}

// ── Cancel a line ─────────────────────────────────────────────────────────────

export async function cancelLine(
  orderId: string,
  lineId: string,
  key: string,
  input: CancelLineInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.cancel-line',
      payload: { orderId, lineId, ...input },
    },
    async (tx) => {
      const { order, line, unit } = await loadLineLocked(tx, orderId, lineId);

      assertCanActOn(
        access,
        SMS_PERMISSIONS.ORDERS_MANAGE,
        order.showroomId,
        [order.showroomId],
        { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
      );

      if (line.status === 'CANCELLED') {
        return { lineId, alreadyDone: true as const, status: 'CANCELLED' as const };
      }

      if (line.status !== 'BOOKED') {
        throw new AppError(
          409,
          'SMS_LINE_NOT_CANCELLABLE',
          `Cannot cancel a line that is ${line.status}. Only BOOKED lines can be cancelled here.`,
          [{ lineId, status: line.status }],
        );
      }

      const now = new Date();

      await tx.smsOrderLine.update({
        where: { id: lineId },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: input.reason },
      });

      await recordUnitEvent(tx, unit, {
        event: { type: 'BOOKING_CANCELLED' },
        eventDate: now,
        performedByUserId: actor.userId,
        reason: input.reason,
        links: { orderLineId: lineId },
        unitChanges: { activeOrderLineId: null },
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsOrderLine',
        resourceId: lineId,
        newValues: { status: 'CANCELLED', cancelReason: input.reason },
      });

      return { lineId, alreadyDone: false as const, status: 'CANCELLED' as const };
    },
  );
}

// ── Follow-up ─────────────────────────────────────────────────────────────────

export async function followUp(
  orderId: string,
  lineId: string,
  input: FollowUpInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return smsTransaction(async (tx) => {
    const { order, line } = await repo.findOrderWithLine(tx, orderId, lineId);
    if (!order) throw new AppError(404, 'SMS_ORDER_NOT_FOUND', 'Order not found');
    if (!line) throw new AppError(404, 'SMS_ORDER_LINE_NOT_FOUND', 'Order line not found');

    assertCanActOn(
      access,
      SMS_PERMISSIONS.ORDERS_MANAGE,
      order.showroomId,
      [order.showroomId],
      { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
    );

    if (line.status !== 'BOOKED') {
      throw new AppError(
        409,
        'SMS_LINE_NOT_BOOKED',
        `Follow-up is only valid on BOOKED lines (this line is ${line.status}).`,
        [{ lineId, status: line.status }],
      );
    }

    const today = businessToday();
    const maxDate = addDays(today, 30);
    const parsed = new Date(`${input.nextFollowUpDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(422, 'VALIDATION_ERROR', 'nextFollowUpDate is not a valid date');
    }
    if (parsed < today) {
      throw new AppError(422, 'VALIDATION_ERROR', 'nextFollowUpDate cannot be in the past');
    }
    if (parsed > maxDate) {
      throw new AppError(422, 'VALIDATION_ERROR', 'nextFollowUpDate cannot be more than 30 days in the future');
    }

    await tx.smsOrderLine.update({
      where: { id: lineId },
      data: { followUpAt: parsed },
    });

    await createAuditLog(tx, {
      userId: actor.userId,
      action: 'UPDATE',
      resourceType: 'SmsOrderLine',
      resourceId: lineId,
      newValues: {
        followUpAt: parsed.toISOString(),
        ...(input.note !== undefined && { note: input.note }),
      },
    });

    return { lineId, followUpAt: parsed };
  });
}

// ── Record sale ───────────────────────────────────────────────────────────────

export async function recordSale(
  orderId: string,
  key: string,
  input: RecordSaleInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.record-sale',
      payload: { orderId, ...input },
    },
    async (tx) => {
      const order = await tx.smsOrder.findUnique({
        where: { id: orderId },
        select: { id: true, showroomId: true, spkNumber: true },
      });
      if (!order) throw new AppError(404, 'SMS_ORDER_NOT_FOUND', 'Order not found');

      assertCanActOn(
        access,
        SMS_PERMISSIONS.ORDERS_MANAGE,
        order.showroomId,
        [order.showroomId],
        { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
      );

      const lines = await repo.findLinesByOrder(tx, orderId, input.lineIds);
      const foundIds = new Set(lines.map((l) => l.id));
      const missing = input.lineIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new AppError(404, 'SMS_ORDER_LINE_NOT_FOUND', 'One or more order lines not found', [
          { missingIds: missing },
        ]);
      }

      const wrongState = lines.filter((l) => l.status !== 'BOOKED' && l.status !== 'SOLD');
      if (wrongState.length > 0) {
        throw new AppError(
          409,
          'SMS_LINE_NOT_BOOKABLE_FOR_SALE',
          `Cannot record sale: ${wrongState.length} line(s) are not in a bookable state`,
          wrongState.map((l) => ({ lineId: l.id, status: l.status })),
        );
      }

      const bookedLines = lines.filter((l) => l.status === 'BOOKED');
      if (bookedLines.length === 0) {
        return { orderId, recordedCount: 0, alreadyDone: true as const };
      }

      const soldAt = resolveEventDate(input.soldAt);
      const unitById = await lockMultipleUnits(tx, bookedLines.map((l) => l.unitId));

      // Re-read under the unit locks: a concurrent cancel/sale may have
      // committed between the first read and acquiring the locks.
      const lockedLines = await repo.findLinesByOrder(
        tx,
        orderId,
        bookedLines.map((l) => l.id),
      );
      const changed = lockedLines.filter((l) => l.status !== 'BOOKED' && l.status !== 'SOLD');
      if (changed.length > 0) {
        throw new AppError(
          409,
          'SMS_LINE_NOT_BOOKABLE_FOR_SALE',
          'Cannot record sale: a line changed while saving — reload and try again',
          changed.map((l) => ({ lineId: l.id, status: l.status })),
        );
      }
      const toSell = lockedLines.filter((l) => l.status === 'BOOKED');
      if (toSell.length === 0) {
        return { orderId, recordedCount: 0, alreadyDone: true as const };
      }

      for (const line of toSell) {
        const unit = unitById.get(line.unitId);
        if (!unit) {
          throw new AppError(404, 'SMS_UNIT_NOT_FOUND', 'Unit not found', [{ lineId: line.id }]);
        }

        await tx.smsOrderLine.update({
          where: { id: line.id },
          data: { status: 'SOLD', soldAt },
        });

        await recordUnitEvent(tx, unit, {
          event: { type: 'SALE_RECORDED' },
          eventDate: soldAt,
          performedByUserId: actor.userId,
          links: { orderLineId: line.id },
        });
      }

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsOrder',
        resourceId: orderId,
        newValues: {
          saleRecorded: true,
          lineIds: toSell.map((l) => l.id),
          soldAt: soldAt.toISOString(),
        },
      });

      return {
        orderId,
        recordedCount: toSell.length,
        alreadyDone: false as const,
        alreadySoldCount: lines.length - toSell.length,
      };
    },
  );
}

// ── Confirm pickup ────────────────────────────────────────────────────────────

export async function confirmPickup(
  orderId: string,
  lineId: string,
  key: string,
  input: ConfirmPickupInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.confirm-pickup',
      payload: { orderId, lineId, ...input },
    },
    async (tx) => {
      const { order, line, unit } = await loadLineLocked(tx, orderId, lineId);

      assertCanActOn(
        access,
        SMS_PERMISSIONS.ORDERS_MANAGE,
        order.showroomId,
        [order.showroomId],
        { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
      );

      if (line.status === 'PICKED_UP') {
        return {
          lineId,
          alreadyDone: true as const,
          status: 'PICKED_UP' as const,
          pickedUpAt: line.pickedUpAt,
        };
      }

      if (line.status !== 'SOLD') {
        throw new AppError(
          409,
          'SMS_LINE_NOT_SOLD',
          `Cannot confirm pickup: line is ${line.status} (expected SOLD).`,
          [{ lineId, status: line.status }],
        );
      }

      const now = new Date();
      const pickedUpAt = input.pickedUpAt ? new Date(input.pickedUpAt) : now;
      if (pickedUpAt.getTime() > now.getTime()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Pickup time cannot be in the future');
      }
      // soldAt is a business date (UTC midnight); compare calendar days in WIB.
      if (line.soldAt && businessDateString(pickedUpAt) < line.soldAt.toISOString().slice(0, 10)) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Pickup time cannot be before the sale date');
      }
      // The ledger is dated by WIB business day; the line keeps the exact time.
      const eventDate = resolveEventDate(businessDateString(pickedUpAt), now);

      await tx.smsOrderLine.update({
        where: { id: lineId },
        data: {
          status: 'PICKED_UP',
          pickedUpAt,
          receiverName: input.receiverName,
          handoverReference: input.handoverReference ?? null,
        },
      });

      await recordUnitEvent(tx, unit, {
        event: { type: 'PICKUP_CONFIRMED' },
        eventDate,
        performedByUserId: actor.userId,
        links: { orderLineId: lineId },
        unitChanges: { activeOrderLineId: null },
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsOrderLine',
        resourceId: lineId,
        newValues: {
          status: 'PICKED_UP',
          pickedUpAt: pickedUpAt.toISOString(),
          receiverName: input.receiverName,
        },
      });

      return {
        lineId,
        alreadyDone: false as const,
        status: 'PICKED_UP' as const,
        pickedUpAt,
      };
    },
  );
}

// ── Sale return: receive ──────────────────────────────────────────────────────

export async function receiveSaleReturn(
  orderId: string,
  lineId: string,
  key: string,
  input: SaleReturnInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.sale-return.receive',
      payload: { orderId, lineId, ...input },
    },
    async (tx) => {
      const { line, unit } = await loadLineLocked(tx, orderId, lineId);

      // Authorize: sms-orders:manage at unit.responsibleShowroomId.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.ORDERS_MANAGE,
        unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
      );

      // Idempotent: already received.
      if (line.returnReceivedAt !== null) {
        return { lineId, alreadyDone: true as const };
      }

      // Guard: line must be SOLD or PICKED_UP.
      if (line.status !== 'SOLD' && line.status !== 'PICKED_UP') {
        throw new AppError(
          409,
          'SMS_LINE_NOT_RETURNABLE',
          `Cannot receive a sale return for a line that is ${line.status}. Only SOLD or PICKED_UP lines can be returned.`,
          [{ lineId, status: line.status }],
        );
      }

      const now = new Date();
      const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now;
      if (receivedAt.getTime() > now.getTime()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'receivedAt cannot be in the future');
      }

      const receivedAtShowroomId = unit.responsibleShowroomId;

      // Update the order line.
      await tx.smsOrderLine.update({
        where: { id: lineId },
        data: {
          returnReceivedAt: receivedAt,
          returnReason: input.reason,
          returnCondition: input.condition,
          // Set activeOrderLineId back to this line so unit points to it.
          // The unit.activeOrderLineId update is handled via unitChanges below.
        },
      });

      // Create a PENDING inspection for SALE_RETURN.
      const inspection = await tx.smsInspection.create({
        data: {
          unitId: unit.id,
          reason: 'SALE_RETURN',
          result: 'PENDING',
          condition: input.condition,
          notes: input.reason,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });

      // Record the unit event.
      const eventDate = resolveEventDate(businessDateString(receivedAt));
      await recordUnitEvent(tx, unit, {
        event: { type: 'SALE_RETURN_RECEIVED', locationId: receivedAtShowroomId },
        eventDate,
        performedByUserId: actor.userId,
        links: { orderLineId: lineId, inspectionId: inspection.id },
        // Re-link activeOrderLineId to this line (decision pending).
        unitChanges: { activeOrderLineId: lineId },
      });

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'UPDATE',
        resourceType: 'SmsOrderLine',
        resourceId: lineId,
        newValues: {
          returnReceivedAt: receivedAt.toISOString(),
          returnReason: input.reason,
          returnCondition: input.condition,
          inspectionId: inspection.id,
        },
      });

      return { lineId, alreadyDone: false as const, inspectionId: inspection.id };
    },
  );
}

// ── Sale return: decide ───────────────────────────────────────────────────────

export async function decideSaleReturn(
  orderId: string,
  lineId: string,
  key: string,
  input: DecideSaleReturnInput,
  access: SmsAccess,
  actor: SmsActor,
) {
  if (input.decision === 'REJECTED' && !input.reason) {
    throw new AppError(422, 'VALIDATION_ERROR', 'reason is required when decision is REJECTED', [
      { field: 'reason' },
    ]);
  }

  return runIdempotent(
    {
      key,
      userId: actor.userId,
      operation: 'orders.sale-return.decide',
      payload: { orderId, lineId, ...input },
    },
    async (tx) => {
      const { line, unit } = await loadLineLocked(tx, orderId, lineId);

      // Authorize: sms-sale-returns:decide at unit.responsibleShowroomId.
      assertCanActOn(
        access,
        SMS_PERMISSIONS.SALE_RETURNS_DECIDE,
        unit.responsibleShowroomId,
        [unit.physicalLocationId, unit.responsibleShowroomId],
        { code: 'SMS_ORDER_NOT_FOUND', message: 'Order not found' },
      );

      // Idempotent: already decided.
      if (line.returnDecision !== null) {
        return { lineId, alreadyDone: true as const, decision: line.returnDecision };
      }

      // Guard: return must have been received first.
      if (line.returnReceivedAt === null) {
        throw new AppError(
          409,
          'SMS_SALE_RETURN_NOT_RECEIVED',
          'The sale return has not been received yet. Record the physical return first.',
          [{ lineId }],
        );
      }

      const now = new Date();
      const eventDate = resolveEventDate(businessDateString(now));

      if (input.decision === 'APPROVED') {
        // Approve: line → RETURNED, clear activeOrderLineId.
        await tx.smsOrderLine.update({
          where: { id: lineId },
          data: {
            status: 'RETURNED',
            returnDecision: 'APPROVED',
            returnDecidedAt: now,
            returnDecisionReason: null,
          },
        });

        await recordUnitEvent(tx, unit, {
          event: { type: 'SALE_RETURN_APPROVED' },
          eventDate,
          performedByUserId: actor.userId,
          links: { orderLineId: lineId },
          unitChanges: { activeOrderLineId: null },
        });

        await createAuditLog(tx, {
          userId: actor.userId,
          action: 'UPDATE',
          resourceType: 'SmsOrderLine',
          resourceId: lineId,
          newValues: { returnDecision: 'APPROVED', status: 'RETURNED' },
        });

        return { lineId, alreadyDone: false as const, decision: 'APPROVED' as const };
      } else {
        // Reject: motorcycle given back to customer.
        // Cancel the pending sale-return inspection if one exists.
        const pendingInspection = await tx.smsInspection.findFirst({
          where: { unitId: unit.id, reason: 'SALE_RETURN', result: 'PENDING' },
          select: { id: true },
        });
        if (pendingInspection) {
          await tx.smsInspection.update({
            where: { id: pendingInspection.id },
            data: { result: 'FAILED', findings: `Sale return rejected: ${input.reason ?? ''}` },
          });
        }

        // Line reverts to PICKED_UP; set returnDecision REJECTED.
        await tx.smsOrderLine.update({
          where: { id: lineId },
          data: {
            status: 'PICKED_UP',
            returnDecision: 'REJECTED',
            returnDecidedAt: now,
            returnDecisionReason: input.reason ?? null,
          },
        });

        await recordUnitEvent(tx, unit, {
          event: { type: 'SALE_RETURN_REJECTED' },
          eventDate,
          performedByUserId: actor.userId,
          links: { orderLineId: lineId },
          unitChanges: { activeOrderLineId: null },
        });

        await createAuditLog(tx, {
          userId: actor.userId,
          action: 'UPDATE',
          resourceType: 'SmsOrderLine',
          resourceId: lineId,
          newValues: {
            returnDecision: 'REJECTED',
            returnDecisionReason: input.reason ?? null,
            status: 'PICKED_UP',
          },
        });

        return { lineId, alreadyDone: false as const, decision: 'REJECTED' as const };
      }
    },
  );
}
