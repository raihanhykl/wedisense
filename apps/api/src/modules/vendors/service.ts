import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import * as vendorRepo from './repository.js';
import type {
  CreateVendorInput,
  UpdateVendorInput,
  SearchVendorQuery,
} from './schema.js';
import type { VendorListFilters } from './types.js';

// ── Read ────────────────────────────────────────────────────────────────────

export async function listVendors(
  filters: VendorListFilters,
  skip: number,
  take: number,
) {
  return vendorRepo.findMany(filters, skip, take);
}

export async function searchVendors(query: SearchVendorQuery) {
  return vendorRepo.search(query.q, query.limit ?? 20);
}

export async function getVendor(id: string) {
  const vendor = await vendorRepo.findById(id);
  if (!vendor) {
    throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
  }
  return vendor;
}

// ── Create ──────────────────────────────────────────────────────────────────
//
// Supports the spec's "Save New Vendor" inline quick-save flow: passing
// only `name` is enough. Detail fields can be filled in later from the
// vendor management page. Name uniqueness is enforced case-insensitively
// at the service layer in addition to the DB's unique index — gives a
// clean 409 instead of a raw P2002.
export async function createVendor(input: CreateVendorInput, userId: string) {
  const existing = await vendorRepo.findByName(input.name);
  if (existing) {
    throw new AppError(
      409,
      'VENDOR_NAME_EXISTS',
      `Vendor "${existing.name}" already exists`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const created = await vendorRepo.create(
      {
        name: input.name,
        taxId: input.taxId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        contactPerson: input.contactPerson ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'Vendor',
        resourceId: created.id,
        newValues: created as unknown as Prisma.InputJsonValue,
      },
    });

    return created;
  });
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateVendor(
  id: string,
  input: UpdateVendorInput,
  userId: string,
) {
  const existing = await vendorRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
  }

  // Name uniqueness check, case-insensitive, excluding self.
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const conflict = await vendorRepo.findByName(input.name, id);
    if (conflict) {
      throw new AppError(
        409,
        'VENDOR_NAME_EXISTS',
        `Vendor "${conflict.name}" already exists`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await vendorRepo.update(
      id,
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.taxId !== undefined && { taxId: input.taxId }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.contactPerson !== undefined && {
          contactPerson: input.contactPerson,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'Vendor',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
        newValues: updated as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

// ── Delete (soft) ───────────────────────────────────────────────────────────
//
// Vendors with POs cannot be deleted — DB FK is Restrict, so a hard
// delete would error out raw. We check pre-emptively and surface a
// clean 409 instead, with a clear remediation hint (archive vs delete).
export async function deleteVendor(id: string, userId: string) {
  const existing = await vendorRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
  }

  const poCount = await vendorRepo.countPurchaseOrders(id);
  if (poCount > 0) {
    throw new AppError(
      409,
      'VENDOR_HAS_PURCHASE_ORDERS',
      `Cannot delete vendor with ${poCount} purchase order(s). Archive it (set isActive=false) instead.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await vendorRepo.softDelete(id, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'Vendor',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
