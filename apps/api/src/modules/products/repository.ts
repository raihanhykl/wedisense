import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from './types.js';

export function findMany(args: {
  skip: number;
  take: number;
  where?: Prisma.ProductWhereInput;
  orderBy?: Prisma.ProductOrderByWithRelationInput;
}) {
  return prisma.product.findMany({
    skip: args.skip,
    take: args.take,
    where: args.where,
    orderBy: args.orderBy ?? { createdAt: 'desc' },
    include: {
      category: { select: { id: true, name: true, code: true } },
      _count: {
        select: {
          assets: { where: { deletedAt: null } },
          purchaseOrderItems: true,
        },
      },
    },
  });
}

export function count(where?: Prisma.ProductWhereInput) {
  return prisma.product.count({ where });
}

export function findById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}

export function findByEan(eanCode: string) {
  return prisma.product.findUnique({
    where: { eanCode },
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}

export function create(data: Prisma.ProductCreateInput) {
  return prisma.product.create({
    data,
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}

export function createInTransaction(
  tx: PrismaTransactionClient,
  data: Prisma.ProductCreateInput,
) {
  return tx.product.create({
    data,
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}

export function update(id: string, data: Prisma.ProductUpdateInput) {
  return prisma.product.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}

export function updateInTransaction(
  tx: PrismaTransactionClient,
  id: string,
  data: Prisma.ProductUpdateInput,
) {
  return tx.product.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}

/** Count only live (non-soft-deleted) assets referencing this product —
 * the number shown in list/detail UIs. */
export function countActiveAssets(productId: string) {
  return prisma.asset.count({ where: { productId, deletedAt: null } });
}

export function deleteById(id: string) {
  return prisma.product.delete({ where: { id } });
}

/** Count ALL asset rows (including soft-deleted) referencing this product.
 * Soft-deleted assets still hold the FK (onDelete: Restrict), so they block
 * a hard delete just as live assets do. */
export function countAllAssets(productId: string) {
  return prisma.asset.count({ where: { productId } });
}

/** Count all purchase order item rows referencing this product. */
export function countPurchaseOrderItems(productId: string) {
  return prisma.purchaseOrderItem.count({ where: { productId } });
}
