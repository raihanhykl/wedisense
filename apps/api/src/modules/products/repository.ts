import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

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
    include: { category: { select: { id: true, name: true, code: true } } },
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

export function update(id: string, data: Prisma.ProductUpdateInput) {
  return prisma.product.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true, code: true } } },
  });
}
