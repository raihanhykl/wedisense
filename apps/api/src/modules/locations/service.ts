import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import * as locationRepo from './repository.js';
import type { LocationListFilters, LocationTreeNode } from './types.js';
import type { CreateLocationInput, UpdateLocationInput } from './schema.js';
import type { LocationType } from '@prisma/client';

export async function listLocations(
  filters: LocationListFilters,
  skip: number,
  take: number,
) {
  return locationRepo.findMany(filters, skip, take);
}

export async function getLocation(id: string) {
  const location = await locationRepo.findById(id);
  if (!location) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }
  return location;
}

export async function createLocation(input: CreateLocationInput, userId: string) {
  // Check unique code
  const existing = await locationRepo.findByCode(input.code);
  if (existing) {
    throw new AppError(409, 'DUPLICATE_CODE', `Location code "${input.code}" already exists`);
  }

  // If parentId provided, verify it exists
  if (input.parentId) {
    const parent = await locationRepo.findById(input.parentId);
    if (!parent) {
      throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent location not found');
    }
  }

  // Wrap the create + audit in a single transaction so a crash between the
  // two awaits can't leave an unaudited location row. Phase 16 Tier 6 audit
  // catch — see docs/conventions/audit-pattern.md §3a for the pattern.
  const location = await prisma.$transaction(async (tx) => {
    const created = await locationRepo.create(
      {
        name: input.name,
        code: input.code,
        address: input.address ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        type: input.type,
        isActive: input.isActive ?? true,
        ...(input.parentId && { parent: { connect: { id: input.parentId } } }),
      },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'Location',
        resourceId: created.id,
        newValues: created as unknown as Prisma.InputJsonValue,
      },
    });
    return created;
  });

  return location;
}

export async function updateLocation(id: string, input: UpdateLocationInput, userId: string) {
  const existing = await locationRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }

  // Check unique code if changing
  if (input.code && input.code !== existing.code) {
    const duplicate = await locationRepo.findByCode(input.code, id);
    if (duplicate) {
      throw new AppError(409, 'DUPLICATE_CODE', `Location code "${input.code}" already exists`);
    }
  }

  // If parentId provided, verify it exists and is not self
  if (input.parentId !== undefined) {
    if (input.parentId === id) {
      throw new AppError(400, 'SELF_PARENT', 'A location cannot be its own parent');
    }
    if (input.parentId !== null) {
      const parent = await locationRepo.findById(input.parentId);
      if (!parent) {
        throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent location not found');
      }
    }
  }

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData['name'] = input.name;
  if (input.code !== undefined) updateData['code'] = input.code;
  if (input.address !== undefined) updateData['address'] = input.address;
  if (input.city !== undefined) updateData['city'] = input.city;
  if (input.province !== undefined) updateData['province'] = input.province;
  if (input.type !== undefined) updateData['type'] = input.type;
  if (input.isActive !== undefined) updateData['isActive'] = input.isActive;
  if (input.parentId !== undefined) {
    updateData['parent'] = input.parentId
      ? { connect: { id: input.parentId } }
      : { disconnect: true };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await locationRepo.update(id, updateData, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'Location',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
        newValues: next as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });

  return updated;
}

export async function deleteLocation(id: string, userId: string) {
  const existing = await locationRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }

  const hasAssets = await locationRepo.hasAssets(id);
  if (hasAssets) {
    throw new AppError(
      409,
      'LOCATION_HAS_ASSETS',
      'Cannot delete location that has assets assigned to it',
    );
  }

  await prisma.$transaction(async (tx) => {
    await locationRepo.softDelete(id, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'Location',
        resourceId: id,
        oldValues: existing as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

export async function getLocationTree() {
  const rows = await locationRepo.findTree();

  // Build nested tree
  const nodeMap = new Map<string, LocationTreeNode>();
  const roots: LocationTreeNode[] = [];

  for (const row of rows) {
    const node: LocationTreeNode = {
      id: row.id,
      name: row.name,
      code: row.code,
      type: row.type as LocationType,
      parentId: row.parent_id,
      isActive: row.is_active,
      address: row.address,
      city: row.city,
      province: row.province,
      children: [],
    };
    nodeMap.set(row.id, node);
  }

  for (const row of rows) {
    const node = nodeMap.get(row.id)!;
    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function getChildren(parentId: string) {
  // Verify parent exists
  const parent = await locationRepo.findById(parentId);
  if (!parent) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }

  return locationRepo.findChildren(parentId);
}

export async function getAncestors(id: string) {
  const location = await locationRepo.findById(id);
  if (!location) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }

  return locationRepo.findAncestors(id);
}
