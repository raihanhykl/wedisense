import type { prisma } from '../../lib/prisma.js';
import type { HandoverFormStatus, HandoverType } from '@prisma/client';

export type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface HandoverFormListFilters {
  search?: string;
  status?: HandoverFormStatus[];
  handoverType?: HandoverType;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Party identity frozen onto the form at creation time and stored in
 * `partySnapshot`. The PDF reads from here, never from the live User rows —
 * a signed document must keep naming whoever actually signed it, even after
 * a rename, a role change, or a soft delete.
 */
export interface PartySnapshotEntry {
  userId: string;
  name: string;
  employeeId: string;
  email: string;
}

export interface PartySnapshot {
  itOfficer: PartySnapshotEntry | null;
  fromUser: PartySnapshotEntry | null;
  toUser: PartySnapshotEntry | null;
  acknowledgedBy: PartySnapshotEntry | null;
  fromLocationName: string | null;
  toLocationName: string | null;
}
