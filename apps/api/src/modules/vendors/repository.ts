import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient, VendorListFilters } from './types.js';

// List view columns. We surface counts via _count so the admin's
// vendor management page can show "12 POs" next to each vendor without
// a follow-up query.
const vendorListSelect = {
  id: true,
  name: true,
  taxId: true,
  email: true,
  phone: true,
  contactPerson: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { purchaseOrders: true },
  },
} as const;

function buildWhereClause(filters: VendorListFilters): Prisma.VendorWhereInput {
  const where: Prisma.VendorWhereInput = { deletedAt: null };

  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { taxId: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { contactPerson: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export async function findMany(
  filters: VendorListFilters,
  skip: number,
  take: number,
) {
  const where = buildWhereClause(filters);
  const [data, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      skip,
      take,
      select: vendorListSelect,
      orderBy: { name: 'asc' },
    }),
    prisma.vendor.count({ where }),
  ]);
  return { data, total };
}

/**
 * Light autocomplete query — name + id + taxId only. Excludes archived
 * vendors by default so the picker only ever surfaces vendors the user
 * can actually attach to a new PO.
 */
export async function search(q: string | undefined, limit: number) {
  const where: Prisma.VendorWhereInput = {
    deletedAt: null,
    isActive: true,
  };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { taxId: { contains: q, mode: 'insensitive' } },
    ];
  }

  return prisma.vendor.findMany({
    where,
    take: limit,
    select: { id: true, name: true, taxId: true },
    orderBy: { name: 'asc' },
  });
}

export async function findById(id: string) {
  return prisma.vendor.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: { select: { purchaseOrders: true } },
    },
  });
}

export async function findByName(name: string, excludeId?: string) {
  const where: Prisma.VendorWhereInput = {
    name: { equals: name, mode: 'insensitive' },
    deletedAt: null,
  };
  if (excludeId) where.id = { not: excludeId };
  return prisma.vendor.findFirst({ where, select: { id: true, name: true } });
}

/**
 * Count POs (live, not soft-deleted) that reference this vendor.
 * Used by the delete guard — vendors with attached POs cannot be
 * deleted, only archived (isActive=false).
 */
export async function countPurchaseOrders(vendorId: string): Promise<number> {
  return prisma.purchaseOrder.count({
    where: { vendorId, deletedAt: null },
  });
}

export async function create(
  data: Prisma.VendorCreateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).vendor.create({
    data,
    select: vendorListSelect,
  });
}

export async function update(
  id: string,
  data: Prisma.VendorUpdateInput,
  tx?: PrismaTransactionClient,
) {
  return (tx ?? prisma).vendor.update({
    where: { id },
    data,
    select: vendorListSelect,
  });
}

export async function softDelete(id: string, tx?: PrismaTransactionClient) {
  return (tx ?? prisma).vendor.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
}
