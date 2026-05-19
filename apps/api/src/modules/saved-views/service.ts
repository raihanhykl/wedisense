import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import type { CreateSavedViewInput, UpdateSavedViewInput } from './schema.js';

// ── List ─────────────────────────────────────────────────────────────
// All views the caller owns for a given resource, defaults first, then
// recency. No pagination — typical caller has <20 views.

export async function listSavedViews(userId: string, resource: string) {
  return prisma.userSavedView.findMany({
    where: { userId, resource },
    orderBy: [
      { isDefault: 'desc' },
      { updatedAt: 'desc' },
    ],
  });
}

// ── Create ───────────────────────────────────────────────────────────
// Wraps the insert in a transaction so that setting isDefault=true also
// clears the previous default for the same (userId, resource) pair — the
// invariant of "at most one default" is enforced here rather than via a
// partial unique index (see schema comment).

export async function createSavedView(
  userId: string,
  input: CreateSavedViewInput,
) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.userSavedView.updateMany({
        where: { userId, resource: input.resource, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.userSavedView.create({
      data: {
        userId,
        resource: input.resource,
        name: input.name,
        config: input.config as unknown as Prisma.InputJsonValue,
        isDefault: input.isDefault,
      },
    });
  });
}

// ── Update ───────────────────────────────────────────────────────────
// Ownership is enforced via the WHERE clause — looking up by id alone
// would expose a tampering vector where one user could update another
// user's view. The 404 path covers both "not found" and "not yours" so
// we don't leak which IDs exist.

export async function updateSavedView(
  userId: string,
  id: string,
  input: UpdateSavedViewInput,
) {
  const existing = await prisma.userSavedView.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new AppError(404, 'SAVED_VIEW_NOT_FOUND', 'Saved view not found');
  }

  return prisma.$transaction(async (tx) => {
    if (input.isDefault === true && !existing.isDefault) {
      await tx.userSavedView.updateMany({
        where: {
          userId,
          resource: existing.resource,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }
    const data: Prisma.UserSavedViewUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.config !== undefined) data.config = input.config as unknown as Prisma.InputJsonValue;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    return tx.userSavedView.update({
      where: { id },
      data,
    });
  });
}

// ── Delete ───────────────────────────────────────────────────────────
// Hard delete — saved views are user preferences, not auditable records.
// Ownership filtered into the WHERE so deleting someone else's view 404s.

export async function deleteSavedView(userId: string, id: string) {
  const existing = await prisma.userSavedView.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new AppError(404, 'SAVED_VIEW_NOT_FOUND', 'Saved view not found');
  }
  await prisma.userSavedView.delete({ where: { id } });
}
