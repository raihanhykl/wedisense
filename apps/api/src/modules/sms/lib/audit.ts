/**
 * Audit helper for SMS services.
 *
 * Audit answers "who recorded or corrected this, and when" (spec §7); the
 * unit ledger answers "what happened to the motorcycle". Every SMS mutation
 * writes its audit row inside the same transaction as the change itself, per
 * docs/conventions/audit-pattern.md.
 */
import type { AuditAction, Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from './types.js';

export type SmsAuditResource =
  | 'SmsVehicleModel'
  | 'SmsVehicleVariant'
  | 'SmsShipment'
  | 'SmsShipmentLine'
  | 'SmsUnit'
  | 'SmsOrder'
  | 'SmsOrderLine'
  | 'SmsRtoContract'
  | 'SmsReturnRequest'
  | 'SmsInspection'
  | 'SmsShowLoan';

export interface SmsAuditEntry {
  userId: string | null;
  action: AuditAction;
  resourceType: SmsAuditResource;
  /** Row id, or `'bulk'` for one summary row covering an import. */
  resourceId: string;
  /** Changed fields only — see `objectDiff` in utils/diff.ts. */
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

export async function createAuditLog(tx: PrismaTransactionClient, entry: SmsAuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      oldValues: (entry.oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
      newValues: (entry.newValues ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
