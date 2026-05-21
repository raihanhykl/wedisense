import { AppError } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import * as locationRepo from './repository.js';
import { bulkMoveAssets } from '../assets/service.js';
import { generateLocationQrCode } from '../../lib/barcode.js';
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
        // Optional metadata fields. Undefined-vs-null distinction matters
        // for Prisma: undefined = "don't set", null = "explicitly null".
        // Coerce undefined to null so a freshly-created row starts clean.
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        photoUrl: input.photoUrl ?? null,
        qrCodeImageUrl: input.qrCodeImageUrl ?? null,
        ...(input.contactUserId && {
          contactUser: { connect: { id: input.contactUserId } },
        }),
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        operatingHours: (input.operatingHours ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        customFields: (input.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
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

  // Generate the location's QR code outside the transaction. Same pattern
  // as Asset create — QR is a derivative artifact (a PNG on disk encoding
  // a deterministic URL), so a transient failure shouldn't roll back the
  // row. Lazy fallback in regenerate endpoint covers any miss.
  try {
    const qrUrl = await generateLocationQrCode(location.id);
    await locationRepo.update(location.id, { qrCodeImageUrl: qrUrl });
    return { ...location, qrCodeImageUrl: qrUrl };
  } catch {
    // Don't fail the create — surface the row without a QR URL. The
    // regenerate endpoint or a re-save will fill it in later.
    return location;
  }
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

  // If parentId provided, verify it exists, is not self, and would not
  // create a cycle (e.g. moving Jakarta-HQ under one of its own descendants).
  if (input.parentId !== undefined) {
    if (input.parentId === id) {
      throw new AppError(400, 'SELF_PARENT', 'A location cannot be its own parent');
    }
    if (input.parentId !== null) {
      const parent = await locationRepo.findById(input.parentId);
      if (!parent) {
        throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent location not found');
      }
      // Walk the ancestor chain of the proposed parent. If the current
      // location appears among its ancestors, the new edge would close a
      // cycle: A → B → C → A. The recursive CTE in findAncestors() is
      // bounded by tree depth (handful of rows in practice) so this is a
      // cheap one-shot query.
      const parentAncestors = await locationRepo.findAncestors(input.parentId);
      if (parentAncestors.some((a) => a.id === id)) {
        throw new AppError(
          400,
          'CYCLIC_PARENT',
          'A location cannot be moved under one of its own descendants',
        );
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

  // Metadata fields — propagate only the keys present in input so a partial
  // update (PATCH semantics) doesn't blank fields the client didn't send.
  if (input.latitude !== undefined) updateData['latitude'] = input.latitude;
  if (input.longitude !== undefined) updateData['longitude'] = input.longitude;
  if (input.photoUrl !== undefined) updateData['photoUrl'] = input.photoUrl;
  if (input.qrCodeImageUrl !== undefined)
    updateData['qrCodeImageUrl'] = input.qrCodeImageUrl;
  if (input.contactUserId !== undefined) {
    updateData['contactUser'] = input.contactUserId
      ? { connect: { id: input.contactUserId } }
      : { disconnect: true };
  }
  if (input.contactPhone !== undefined) updateData['contactPhone'] = input.contactPhone;
  if (input.contactEmail !== undefined) updateData['contactEmail'] = input.contactEmail;
  // For JSONB fields Prisma needs a sentinel (Prisma.JsonNull) to set the
  // column to literal SQL NULL — passing JS null would store the JSON value
  // `null` instead. Coerce here.
  if (input.operatingHours !== undefined) {
    updateData['operatingHours'] =
      input.operatingHours === null ? Prisma.JsonNull : input.operatingHours;
  }
  if (input.customFields !== undefined) {
    updateData['customFields'] =
      input.customFields === null ? Prisma.JsonNull : input.customFields;
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

  // Build nested tree. The CTE already orders rows by depth, so by the time
  // we attach a child its parent is guaranteed to exist in the map — no
  // second pass needed for assembly.
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
      directAssetCount: row.direct_asset_count,
      // Filled by rollupSubtreeCounts() below — initialised to the direct
      // count so single-node (leaf) trees work without a separate pass.
      subtreeAssetCount: row.direct_asset_count,
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

  // Post-order rollup: each node's subtreeAssetCount = its directAssetCount
  // plus the sum of its children's *rolled-up* counts. O(n) traversal; safe
  // for any tree depth because we rely on the CTE-enforced DAG (cyclic
  // parents are blocked at write time — see updateLocation).
  for (const root of roots) {
    rollupSubtreeCounts(root);
  }

  return roots;
}

function rollupSubtreeCounts(node: LocationTreeNode): number {
  let total = node.directAssetCount;
  for (const child of node.children) {
    total += rollupSubtreeCounts(child);
  }
  node.subtreeAssetCount = total;
  return total;
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

/**
 * Archive a location (soft-archive — sets isActive=false; the row stays
 * queryable for history). When the location has direct assets, the caller
 * MUST supply `migrateAssetsTo` so the assets land somewhere first; we
 * never silently abandon them. Subtree (descendant) assets are not
 * touched — only the location's own immediate pins.
 *
 * Atomicity caveat: bulkMoveAssets runs one transaction per asset (so a
 * single bad asset doesn't block the rest), so we can't wrap the move and
 * the isActive=false flip in a single transaction. Sequence instead:
 *   1. Move direct assets to target
 *   2. If anything failed → abort, leave the location active, surface the
 *      partial result to the caller so they can retry or migrate manually
 *   3. Otherwise flip isActive=false + write an audit row
 */
export async function archiveLocation(
  id: string,
  migrateAssetsTo: string | null | undefined,
  userId: string,
  accessibleLocationIds: string[],
) {
  const existing = await locationRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }
  if (!existing.isActive) {
    // Idempotent — already archived. No-op success rather than a 409 so
    // double-clicks from a flaky UI don't surface an error.
    return { location: existing, moved: 0, skipped: 0 };
  }

  const directAssetIds = await locationRepo.findDirectAssetIds(id);

  // Has direct assets → caller must tell us where to put them. Subtree
  // assets in sub-locations aren't affected by the parent being archived.
  if (directAssetIds.length > 0) {
    if (!migrateAssetsTo) {
      throw new AppError(
        400,
        'ASSETS_REQUIRE_MIGRATION',
        `Location has ${directAssetIds.length} direct asset${
          directAssetIds.length === 1 ? '' : 's'
        }. Provide migrateAssetsTo to move them before archiving.`,
        [{ directAssetCount: directAssetIds.length }],
      );
    }
    if (migrateAssetsTo === id) {
      throw new AppError(
        400,
        'INVALID_MIGRATION_TARGET',
        'Cannot migrate assets to the location being archived',
      );
    }

    const moveResult = await bulkMoveAssets(
      directAssetIds,
      migrateAssetsTo,
      userId,
      accessibleLocationIds,
    );

    if (moveResult.failed.length > 0) {
      // Don't archive — bubble up the partial state so the UI can decide
      // (retry, manual cleanup, etc.). The successful moves stand (assets
      // are now at the target), which is the desired "make forward progress"
      // semantic even on partial failure.
      throw new AppError(
        409,
        'ASSET_MIGRATION_PARTIAL',
        `${moveResult.failed.length} of ${directAssetIds.length} assets could not be moved. Location not archived.`,
        moveResult.failed,
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await locationRepo.update(id, { isActive: false }, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'Location',
        resourceId: id,
        oldValues: { isActive: true } as unknown as Prisma.InputJsonValue,
        newValues: {
          isActive: false,
          archivedAssetMigrationCount: directAssetIds.length,
          archivedAssetMigrationTarget: migrateAssetsTo ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });

  return {
    location: updated,
    moved: directAssetIds.length,
    skipped: 0,
  };
}

/**
 * Reverse of archiveLocation — flip isActive back to true. Doesn't touch
 * assets (they're already wherever the archive flow left them). Idempotent
 * for already-active locations.
 */
export async function reactivateLocation(id: string, userId: string) {
  const existing = await locationRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }
  if (existing.isActive) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const next = await locationRepo.update(id, { isActive: true }, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'Location',
        resourceId: id,
        oldValues: { isActive: false } as unknown as Prisma.InputJsonValue,
        newValues: { isActive: true } as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });
}

/**
 * Regenerate the location's QR code PNG. Used for recovery (file deleted,
 * URL changed) or when an admin wants a fresh asset. Updates
 * `qrCodeImageUrl` even if it was already populated — the on-disk file is
 * overwritten and the URL stays the same (deterministic by location id),
 * so consumers caching the URL still work.
 */
export async function regenerateQrCode(id: string, userId: string) {
  const existing = await locationRepo.findById(id);
  if (!existing) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }
  const qrUrl = await generateLocationQrCode(id);
  return prisma.$transaction(async (tx) => {
    const next = await locationRepo.update(id, { qrCodeImageUrl: qrUrl }, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'Location',
        resourceId: id,
        oldValues: {
          qrCodeImageUrl: existing.qrCodeImageUrl ?? null,
        } as unknown as Prisma.InputJsonValue,
        newValues: { qrCodeImageUrl: qrUrl } as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });
}

/**
 * Asset summary for the location detail page. Returns counts grouped by
 * AssetStatus for both this exact location ("direct") and the full subtree
 * ("subtree"). The detail page surfaces both: managers want to know "how
 * many assets in Jakarta total" (subtree) but also "how many sit at this
 * exact floor" (direct).
 */
export async function getAssetSummary(id: string) {
  const location = await locationRepo.findById(id);
  if (!location) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found');
  }

  const rows = await locationRepo.findAssetSummary(id);

  // Reshape into two parallel maps keyed by status. The frontend's chart
  // legend prefers structured per-status numbers over an array of mixed-bag
  // rows; building it here keeps the consumer dumb.
  const byStatus: Record<string, { direct: number; subtree: number }> = {};
  let directTotal = 0;
  let subtreeTotal = 0;
  for (const row of rows) {
    byStatus[row.status] = {
      direct: row.direct_count,
      subtree: row.subtree_count,
    };
    directTotal += row.direct_count;
    subtreeTotal += row.subtree_count;
  }

  return {
    locationId: id,
    direct: { total: directTotal, byStatus },
    subtree: { total: subtreeTotal, byStatus },
  };
}
