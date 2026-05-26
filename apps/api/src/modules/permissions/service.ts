import { prisma } from '../../lib/prisma.js';

/**
 * Return the full permission catalogue. Ordered (resource, action) so the
 * frontend's resource-grouped accordion renders in a predictable order
 * without client-side re-sort.
 *
 * The catalogue is small (~32 rows today, expected to grow ≤ 100 as new
 * resources are added). No pagination needed; the editor renders all of
 * them in a single scroll.
 */
export async function listPermissions() {
  return prisma.permission.findMany({
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
}
