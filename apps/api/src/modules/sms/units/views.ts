/**
 * Unit view predicates.
 *
 * Every view that appears in the unit list AND the dashboard summary must be
 * defined here — the same function used by both — so a dashboard total and
 * the list it links to can never disagree.
 */
import { Prisma } from '@prisma/client';

export type UnitView =
  | 'physical'
  | 'ready'
  | 'booked'
  | 'sold_pending_pickup'
  | 'inspection'
  | 'custody'
  | 'identity_mismatch'
  | 'outside'
  | 'all';

/**
 * Return the Prisma `where` fragment that selects units belonging to `view`
 * as seen from `showroomId`.
 *
 * physical            physicalLocationId = showroom
 * ready               physicalLocationId = showroom AND status = AVAILABLE
 * booked              physicalLocationId = showroom AND status = BOOKED
 * sold_pending_pickup physicalLocationId = showroom AND status = SOLD_PENDING_PICKUP
 * inspection          physicalLocationId = showroom AND status = INSPECTION
 * custody             physicalLocationId = showroom AND status = CUSTODY
 * identity_mismatch   physicalLocationId = showroom AND status = IDENTITY_MISMATCH
 * outside             responsibleShowroomId = showroom AND physicalLocationId IS NULL
 *                     AND status IN (SHOW_UNIT, ACTIVE_RTO)
 * all                 physicalLocationId = showroom OR responsibleShowroomId = showroom
 */
export function unitViewWhere(view: UnitView, showroomId: string): Prisma.SmsUnitWhereInput {
  switch (view) {
    case 'physical':
      return { physicalLocationId: showroomId };

    case 'ready':
      return { physicalLocationId: showroomId, status: 'AVAILABLE' };

    case 'booked':
      return { physicalLocationId: showroomId, status: 'BOOKED' };

    case 'sold_pending_pickup':
      return { physicalLocationId: showroomId, status: 'SOLD_PENDING_PICKUP' };

    case 'inspection':
      return { physicalLocationId: showroomId, status: 'INSPECTION' };

    case 'custody':
      return { physicalLocationId: showroomId, status: 'CUSTODY' };

    case 'identity_mismatch':
      return { physicalLocationId: showroomId, status: 'IDENTITY_MISMATCH' };

    case 'outside':
      return {
        responsibleShowroomId: showroomId,
        physicalLocationId: null,
        status: { in: ['SHOW_UNIT', 'ACTIVE_RTO'] },
      };

    case 'all':
      return {
        OR: [
          { physicalLocationId: showroomId },
          { responsibleShowroomId: showroomId },
        ],
      };
  }
}
