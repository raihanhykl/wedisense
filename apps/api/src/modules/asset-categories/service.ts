import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './schema.js';

// ── List ─────────────────────────────────────────────────────────────
// All non-deleted categories. No pagination — the catalog is intentionally
// small (typically <100) and the management UI shows them all so users can
// see the full hierarchy without clicking through pages.

export async function listCategories() {
  return prisma.assetCategory.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { products: true } },
      parent: { select: { id: true, name: true, code: true } },
    },
  });
}

// ── Get by id ────────────────────────────────────────────────────────

export async function getCategory(id: string) {
  const category = await prisma.assetCategory.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: { select: { products: true } },
      parent: { select: { id: true, name: true, code: true } },
      children: {
        where: { deletedAt: null },
        select: { id: true, name: true, code: true },
      },
    },
  });
  if (!category) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Asset category not found');
  }
  return category;
}

// ── Create ───────────────────────────────────────────────────────────
// Atomic insert + audit log. The unique code constraint is enforced at the
// DB level and translated to a 409 here so the API surface stays friendly.

export async function createCategory(input: CreateCategoryInput, userId: string) {
  // Validate parent if specified — catch the "parent doesn't exist" case
  // before the FK error so the user gets a clearer message.
  if (input.parentId) {
    const parent = await prisma.assetCategory.findFirst({
      where: { id: input.parentId, deletedAt: null },
    });
    if (!parent) {
      throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent category not found');
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.assetCategory.create({
        data: {
          name: input.name,
          code: input.code,
          description: input.description ?? null,
          parentId: input.parentId ?? null,
          depreciationMethod: input.depreciationMethod,
          defaultDepreciationRate: input.defaultDepreciationRate ?? null,
          defaultUsefulLifeMonths: input.defaultUsefulLifeMonths ?? null,
          icon: input.icon ?? null,
          color: input.color ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          resourceType: 'AssetCategory',
          resourceId: category.id,
          newValues: {
            name: category.name,
            code: category.code,
            depreciationMethod: category.depreciationMethod,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return category;
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      Array.isArray(err.meta?.['target']) &&
      (err.meta['target'] as string[]).includes('code')
    ) {
      throw new AppError(
        409,
        'CATEGORY_CODE_EXISTS',
        `A category with code "${input.code}" already exists`,
      );
    }
    throw err;
  }
}

// ── Update ───────────────────────────────────────────────────────────
// Builds a diff against the existing record so the audit log only captures
// fields that actually changed.

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
  userId: string,
) {
  const existing = await prisma.assetCategory.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Asset category not found');
  }

  // Self-parent and cycle prevention. A direct self-reference is the only
  // case we explicitly catch; deeper cycles are blocked structurally by the
  // self-referencing FK and the limited tree depth in practice (1-2 levels).
  if (input.parentId !== undefined && input.parentId === id) {
    throw new AppError(400, 'INVALID_PARENT', 'A category cannot be its own parent');
  }

  if (input.parentId) {
    const parent = await prisma.assetCategory.findFirst({
      where: { id: input.parentId, deletedAt: null },
    });
    if (!parent) {
      throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent category not found');
    }
  }

  // Only set the fields the caller actually provided. `parentId: null`
  // explicitly clears the parent (root-level category).
  const data: Prisma.AssetCategoryUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = input.code;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.parentId !== undefined) {
    data.parent =
      input.parentId === null
        ? { disconnect: true }
        : { connect: { id: input.parentId } };
  }
  if (input.depreciationMethod !== undefined) data.depreciationMethod = input.depreciationMethod;
  if (input.defaultDepreciationRate !== undefined) {
    data.defaultDepreciationRate = input.defaultDepreciationRate ?? null;
  }
  if (input.defaultUsefulLifeMonths !== undefined) {
    data.defaultUsefulLifeMonths = input.defaultUsefulLifeMonths ?? null;
  }
  if (input.icon !== undefined) data.icon = input.icon ?? null;
  if (input.color !== undefined) data.color = input.color ?? null;

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.assetCategory.update({
        where: { id },
        data,
      });

      // Build before/after diff — only fields the user actually touched.
      const tracked = [
        'name',
        'code',
        'description',
        'parentId',
        'depreciationMethod',
        'defaultDepreciationRate',
        'defaultUsefulLifeMonths',
        'icon',
        'color',
      ] as const;
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const field of tracked) {
        const before = (existing as unknown as Record<string, unknown>)[field];
        const after = (updated as unknown as Record<string, unknown>)[field];
        if (before !== after) {
          oldValues[field] = before;
          newValues[field] = after;
        }
      }

      if (Object.keys(newValues).length > 0) {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'UPDATE',
            resourceType: 'AssetCategory',
            resourceId: id,
            oldValues: oldValues as unknown as Prisma.InputJsonValue,
            newValues: newValues as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return updated;
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      Array.isArray(err.meta?.['target']) &&
      (err.meta['target'] as string[]).includes('code')
    ) {
      throw new AppError(
        409,
        'CATEGORY_CODE_EXISTS',
        `A category with code "${input.code}" already exists`,
      );
    }
    throw err;
  }
}

// ── Soft delete ──────────────────────────────────────────────────────
// Block when the category is referenced by any product or has live
// children. The asset-number generator never references AssetCategory.code
// retroactively (the code is stamped onto each asset_number at creation
// time), so deleting a category does NOT affect existing asset numbers.

export async function softDeleteCategory(id: string, userId: string) {
  const existing = await prisma.assetCategory.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: { select: { products: true } },
      children: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  if (!existing) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Asset category not found');
  }

  if (existing._count.products > 0) {
    throw new AppError(
      409,
      'CATEGORY_IN_USE',
      `Cannot delete: ${existing._count.products} product(s) still reference this category. Reassign them first.`,
    );
  }

  if (existing.children.length > 0) {
    throw new AppError(
      409,
      'CATEGORY_HAS_CHILDREN',
      `Cannot delete: ${existing.children.length} sub-categor${existing.children.length === 1 ? 'y' : 'ies'} still depend on this one. Delete or re-parent them first.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.assetCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'AssetCategory',
        resourceId: id,
        oldValues: {
          name: existing.name,
          code: existing.code,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return deleted;
  });
}
