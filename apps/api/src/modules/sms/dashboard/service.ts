import { AppError } from '../../../middleware/error-handler.js';
import { prisma } from '../../../lib/prisma.js';
import { assertCan, type SmsAccess } from '../lib/access.js';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import * as dashboardRepo from './repository.js';
import type { DashboardSummary, DashboardTasks } from './types.js';

export async function getDashboardSummary(
  showroomId: string,
  access: SmsAccess,
): Promise<DashboardSummary> {
  assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, showroomId);

  const showroom = await prisma.location.findUnique({
    where: { id: showroomId },
    select: { id: true, code: true, name: true },
  });
  if (!showroom) {
    throw new AppError(404, 'SMS_SHOWROOM_NOT_FOUND', 'Showroom not found.');
  }

  // All view counts are computed with a single DB query.
  const [byVariant, expected] = await Promise.all([
    dashboardRepo.getVariantCounts(showroomId),
    dashboardRepo.countExpected(showroomId),
  ]);

  const totals = dashboardRepo.aggregateTotals(byVariant, expected);

  return { showroom, totals, byVariant };
}

export async function getDashboardTasks(
  showroomId: string,
  access: SmsAccess,
): Promise<DashboardTasks> {
  assertCan(access, SMS_PERMISSIONS.STOCK_VIEW, showroomId);

  const now = new Date();

  const [
    openShipments,
    inspections,
    identityMismatches,
    staleBookings,
    awaitingPickup,
    overdueShowUnits,
    returnsToDecide,
    returnsAwaitingReceipt,
    custodyHeld,
    rtoReturnedNotClosed,
    saleReturnsToDecide,
  ] = await Promise.all([
    dashboardRepo.getOpenShipments(showroomId),
    dashboardRepo.getInspectionUnits(showroomId),
    dashboardRepo.getIdentityMismatchUnits(showroomId),
    dashboardRepo.getStaleBookings(showroomId, now),
    dashboardRepo.getAwaitingPickup(showroomId, now),
    dashboardRepo.getOverdueShowUnits(showroomId, now),
    dashboardRepo.getReturnsToDecide(showroomId),
    dashboardRepo.getReturnsAwaitingReceipt(showroomId),
    dashboardRepo.getCustodyHeld(showroomId),
    dashboardRepo.getRtoReturnedNotClosed(showroomId),
    dashboardRepo.getSaleReturnsToDecide(showroomId),
  ]);

  return {
    openShipments,
    inspections,
    identityMismatches,
    staleBookings,
    awaitingPickup,
    overdueShowUnits,
    returnsToDecide,
    returnsAwaitingReceipt,
    custodyHeld,
    rtoReturnedNotClosed,
    saleReturnsToDecide,
  };
}
