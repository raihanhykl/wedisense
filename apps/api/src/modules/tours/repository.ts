import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

// Subset of the Prisma client surface exposed inside a $transaction callback —
// used by repo functions that accept an optional tx so callers (notably
// service.ts) can stitch them into larger atomic operations.
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ── Tours ────────────────────────────────────────────────────────────────────

export async function findToursForUser(userRoleIds: string[]) {
  if (userRoleIds.length === 0) return [];
  return prisma.onboardingTour.findMany({
    where: {
      isActive: true,
      roleId: { in: userRoleIds },
    },
    orderBy: { name: 'asc' },
  });
}

export async function findProgressForUser(
  userId: string,
  tourIds: string[],
): Promise<Map<string, Awaited<ReturnType<typeof prisma.userTourProgress.findFirst>>>> {
  if (tourIds.length === 0) return new Map();
  const rows = await prisma.userTourProgress.findMany({
    where: { userId, tourId: { in: tourIds } },
  });
  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    map.set(row.tourId, row);
  }
  return map;
}

export async function findTourById(id: string) {
  return prisma.onboardingTour.findUnique({ where: { id } });
}

export async function listAllTours(skip: number, take: number) {
  const [tours, total] = await Promise.all([
    prisma.onboardingTour.findMany({
      skip,
      take,
      orderBy: { name: 'asc' },
    }),
    prisma.onboardingTour.count(),
  ]);
  return { tours, total };
}

export async function createTour(
  data: {
    roleId: string;
    name: string;
    description: string | null;
    isActive: boolean;
    steps: Prisma.InputJsonValue;
  },
) {
  return prisma.onboardingTour.create({ data });
}

export async function updateTour(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    isActive: boolean;
    steps: Prisma.InputJsonValue;
  }>,
) {
  return prisma.onboardingTour.update({ where: { id }, data });
}

export async function deleteTour(id: string) {
  return prisma.onboardingTour.delete({ where: { id } });
}

// ── Progress ─────────────────────────────────────────────────────────────────

export async function upsertProgress(
  userId: string,
  tourId: string,
  data: {
    completedSteps: Prisma.InputJsonValue;
    isCompleted: boolean;
    isSkipped: boolean;
    lastSeenAt: Date;
  },
  tx?: PrismaTransactionClient,
) {
  const client = (tx ?? prisma) as typeof prisma;
  return client.userTourProgress.upsert({
    where: { userId_tourId: { userId, tourId } },
    create: { userId, tourId, ...data },
    update: data,
  });
}

// ── Enrichment ───────────────────────────────────────────────────────────────

export async function getRoleNameMap(roleIds: string[]): Promise<Map<string, string>> {
  if (roleIds.length === 0) return new Map();
  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, name: true },
  });
  const map = new Map<string, string>();
  for (const r of roles) {
    map.set(r.id, r.name);
  }
  return map;
}

export async function countToursForRole(roleId: string): Promise<number> {
  return prisma.onboardingTour.count({ where: { roleId } });
}
