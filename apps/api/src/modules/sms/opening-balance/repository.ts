/**
 * Data-access layer for the opening-balance slice.
 *
 * All reads use the global Prisma client. Writes go through the transaction
 * client supplied by the service layer.
 */
import { prisma } from '../../../lib/prisma.js';
import type { PrismaTransactionClient } from '../lib/types.js';
import type { VariantLookupRow, UserLookupRow, ShowroomLookupRow } from './row-validator.js';
import { SMS_STOCK_LOCATION_TYPES } from '@wedisense/shared';

// ── Location validation ───────────────────────────────────────────────────────

export async function findStockLocation(locationId: string) {
  return prisma.location.findUnique({
    where: { id: locationId, deletedAt: null },
    select: { id: true, name: true, code: true, type: true, isActive: true },
  });
}

// ── Lookup maps ───────────────────────────────────────────────────────────────

export async function findAllVariantsForMatching(): Promise<VariantLookupRow[]> {
  return prisma.smsVehicleVariant.findMany({
    select: {
      id: true,
      name: true,
      color: true,
      model: { select: { code: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function findActiveUsersForMatching(): Promise<UserLookupRow[]> {
  return prisma.user.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true, employeeId: true },
    orderBy: { name: 'asc' },
  });
}

export async function findActiveStockShowrooms(): Promise<ShowroomLookupRow[]> {
  return prisma.location.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      type: { in: [...SMS_STOCK_LOCATION_TYPES] },
    },
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });
}

// ── Conflict detection ────────────────────────────────────────────────────────

/** Returns the set of VINs (from the input list) that already exist as units. */
export async function findExistingUnitVins(vins: string[]): Promise<Set<string>> {
  if (vins.length === 0) return new Set();
  const rows = await prisma.smsUnit.findMany({
    where: { vin: { in: vins } },
    select: { vin: true },
  });
  return new Set(rows.map((r) => r.vin));
}

/**
 * Returns VINs that are PENDING in any shipment line (not yet received as a
 * unit, but already claimed by a shipment).
 */
export async function findPendingShipmentVins(vins: string[]): Promise<Set<string>> {
  if (vins.length === 0) return new Set();
  const rows = await prisma.smsShipmentLine.findMany({
    where: { vin: { in: vins }, receiptStatus: 'PENDING' },
    select: { vin: true },
  });
  return new Set(rows.map((r) => r.vin));
}

/** Returns the set of `${showroomId}|${spkNumber}` keys that already exist. */
export async function findExistingSpkKeys(candidates: Array<{ showroomId: string; spkNumber: string }>): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const rows = await prisma.smsOrder.findMany({
    where: {
      OR: candidates.map((c) => ({ showroomId: c.showroomId, spkNumber: c.spkNumber })),
    },
    select: { showroomId: true, spkNumber: true },
  });
  return new Set(rows.map((r) => `${r.showroomId}|${r.spkNumber}`));
}

export async function findExistingContractNumbers(contractNumbers: string[]): Promise<Set<string>> {
  if (contractNumbers.length === 0) return new Set();
  const rows = await prisma.smsRtoContract.findMany({
    where: { contractNumber: { in: contractNumbers } },
    select: { contractNumber: true },
  });
  return new Set(rows.map((r) => r.contractNumber));
}

// ── Return-request number sequence ───────────────────────────────────────────

/**
 * Generate the next RTR-YYYYMM-NNNN number for a given year/month,
 * atomically via the document_number_sequences table.
 *
 * MUST be called inside a transaction.
 */
export async function generateReturnRequestNumber(
  tx: PrismaTransactionClient,
  date: Date,
): Promise<string> {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const bucketKey = `SMS_RETURN_${year}${month}`;

  const rows = await tx.$queryRaw<Array<{ current_sequence: number }>>`
    INSERT INTO document_number_sequences (id, document_type, year, current_sequence)
    VALUES (gen_random_uuid(), ${bucketKey}, ${year}, 1)
    ON CONFLICT (document_type, year)
    DO UPDATE SET current_sequence = document_number_sequences.current_sequence + 1
    RETURNING current_sequence
  `;

  const seq = rows[0]?.current_sequence;
  if (seq === undefined) {
    throw new Error('Return request sequence UPSERT returned no row');
  }

  return `RTR-${year}${month}-${String(seq).padStart(4, '0')}`;
}
