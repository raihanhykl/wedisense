/**
 * People lookup for the SMS module.
 *
 * Returns active employees (with or without a login account) so that order
 * forms can search for the sales person by name or employee ID.
 *
 * Access rule: the caller must hold sms-orders:manage OR sms-show-units:manage
 * at at least one location. This is enforced by `requireAnyOrdersOrShowUnits`.
 */
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { SMS_PERMISSIONS } from '@wedisense/shared';
import { asyncHandler } from '../../../utils/async-handler.js';
import { sendSuccess } from '../../../utils/response.js';
import { canAnywhere, getSmsAccess } from '../lib/access.js';
import { AppError } from '../../../middleware/error-handler.js';
import { prisma } from '../../../lib/prisma.js';

const querySchema = z.object({
  search: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});

const router: RouterType = Router();

// GET /api/sms/people
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const access = getSmsAccess(req);

    const hasOrdersManage = canAnywhere(access, SMS_PERMISSIONS.ORDERS_MANAGE);
    const hasShowUnitsManage = canAnywhere(access, SMS_PERMISSIONS.SHOW_UNITS_MANAGE);
    if (!hasOrdersManage && !hasShowUnitsManage) {
      throw new AppError(
        403,
        'INSUFFICIENT_PERMISSION',
        'You need sms-orders:manage or sms-show-units:manage to look up people',
      );
    }

    const { search, limit } = querySchema.parse(req.query);

    const where = {
      status: 'ACTIVE' as const,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { employeeId: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const people = await prisma.user.findMany({
      where,
      select: { id: true, name: true, employeeId: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    sendSuccess(res, people);
  }),
);

export { router as smsPeopleRouter };
