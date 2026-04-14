import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { generateMovementRef } from '../../utils/movement-ref.js';
import * as repo from './repository.js';
import type { CreateMovementInput } from './schema.js';
import type { MovementListFilters, PrismaTransactionClient } from './types.js';
import type { PaginationQuery } from '@wedisense/shared';

// ── Build where clause ───────────────────────────────────────────────

function buildWhereClause(
  filters: MovementListFilters,
): Prisma.AssetMovementWhereInput {
  const where: Prisma.AssetMovementWhereInput = {};

  if (filters.assetId) {
    where.assetId = filters.assetId;
  }

  if (filters.movementType) {
    where.movementType = filters.movementType as Prisma.EnumMovementTypeFilter;
  }

  if (filters.status) {
    where.status = filters.status as Prisma.EnumMovementStatusFilter;
  }

  if (filters.performedByUserId) {
    where.performedByUserId = filters.performedByUserId;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom && { gte: filters.dateFrom }),
      ...(filters.dateTo && { lte: filters.dateTo }),
    };
  }

  return where;
}

function buildOrderBy(sort?: string, order?: 'asc' | 'desc'): Prisma.AssetMovementOrderByWithRelationInput {
  const dir = order ?? 'desc';
  const validSorts: Record<string, Prisma.AssetMovementOrderByWithRelationInput> = {
    createdAt: { createdAt: dir },
    movementType: { movementType: dir },
    status: { status: dir },
  };

  if (sort && sort in validSorts) {
    return validSorts[sort]!;
  }

  return { createdAt: dir };
}

// ── List Movements ──────────────────────────────────────────────────

export async function listMovements(
  query: PaginationQuery & MovementListFilters,
) {
  const { skip, take, page, limit } = parsePagination(query);
  const where = buildWhereClause(query);
  const orderBy = buildOrderBy(query.sort, query.order);

  const [movements, total] = await Promise.all([
    repo.findMany({ skip, take, where, orderBy }),
    repo.count(where),
  ]);

  return { movements, meta: buildPaginationMeta(page, limit, total) };
}

// ── Get Movement ────────────────────────────────────────────────────

export async function getMovement(id: string) {
  const movement = await repo.findById(id);
  if (!movement) {
    throw new AppError(404, 'MOVEMENT_NOT_FOUND', 'Movement not found');
  }
  return movement;
}

// ── Create Movement ─────────────────────────────────────────────────

export async function createMovement(input: CreateMovementInput, performedByUserId: string) {
  const { movementType } = input;

  // Dispatch to specific handler
  switch (movementType) {
    case 'ASSIGNMENT':
      return handleAssignment(input, performedByUserId);
    case 'UNASSIGNMENT':
      return handleUnassignment(input, performedByUserId);
    case 'LOCATION_TRANSFER':
      return handleLocationTransfer(input, performedByUserId);
    case 'LOAN_OUT':
      return handleLoanOut(input, performedByUserId);
    case 'LOAN_RETURN':
      return handleLoanReturn(input, performedByUserId);
    case 'SWAP':
      return handleSwap(input, performedByUserId);
    case 'SEND_TO_MAINTENANCE':
      return handleSendToMaintenance(input, performedByUserId);
    case 'RETURN_FROM_MAINTENANCE':
      return handleReturnFromMaintenance(input, performedByUserId);
    case 'DISPOSAL':
      return handleDisposal(input, performedByUserId);
    case 'RESIGNATION_RETURN':
      return handleResignationReturn(input, performedByUserId);
    case 'FOUND':
      return handleFound(input, performedByUserId);
    case 'LOST':
      return handleLost(input, performedByUserId);
    default:
      throw new AppError(400, 'INVALID_MOVEMENT_TYPE', `Unsupported movement type: ${movementType as string}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function requireAsset(tx: PrismaTransactionClient, assetId: string | undefined, movementType?: string) {
  if (!assetId) {
    throw new AppError(400, 'ASSET_REQUIRED', 'assetId is required');
  }
  const asset = await repo.findAssetById(tx, assetId);
  if (!asset) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }
  if (movementType) {
    validateAssetStatusForMovement(asset, movementType);
  }
  return asset;
}

/**
 * Validates that the asset's current status allows the requested movement type.
 * Prevents double-inputs like sending an already IN_MAINTENANCE asset to maintenance again.
 */
function validateAssetStatusForMovement(asset: { id: string; status: string; assignedToUserId: string | null }, movementType: string) {
  const s = asset.status;

  switch (movementType) {
    case 'ASSIGNMENT':
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot assign a disposed asset');
      if (s === 'LOST') throw new AppError(400, 'ASSET_LOST', 'Cannot assign a lost asset');
      if (s === 'IN_MAINTENANCE') throw new AppError(400, 'ASSET_IN_MAINTENANCE', 'Cannot assign an asset currently in maintenance');
      if (s === 'BORROWED') throw new AppError(400, 'ASSET_BORROWED', 'Cannot assign a borrowed asset — return it first');
      break;

    case 'UNASSIGNMENT':
      if (!asset.assignedToUserId) throw new AppError(400, 'ASSET_NOT_ASSIGNED', 'Asset is not assigned to anyone');
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot unassign a disposed asset');
      break;

    case 'LOCATION_TRANSFER':
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot transfer a disposed asset');
      break;

    case 'LOAN_OUT':
      if (s === 'BORROWED') throw new AppError(400, 'ASSET_ALREADY_BORROWED', 'Asset is already on loan');
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot loan a disposed asset');
      if (s === 'LOST') throw new AppError(400, 'ASSET_LOST', 'Cannot loan a lost asset');
      if (s === 'IN_MAINTENANCE') throw new AppError(400, 'ASSET_IN_MAINTENANCE', 'Cannot loan an asset in maintenance');
      break;

    case 'LOAN_RETURN':
      if (s !== 'BORROWED') throw new AppError(400, 'ASSET_NOT_BORROWED', 'Asset is not currently on loan');
      break;

    case 'SEND_TO_MAINTENANCE':
      if (s === 'IN_MAINTENANCE') throw new AppError(400, 'ASSET_ALREADY_IN_MAINTENANCE', 'Asset is already in maintenance');
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot send a disposed asset to maintenance');
      break;

    case 'RETURN_FROM_MAINTENANCE':
      if (s !== 'IN_MAINTENANCE') throw new AppError(400, 'ASSET_NOT_IN_MAINTENANCE', 'Asset is not currently in maintenance');
      break;

    case 'DISPOSAL':
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_ALREADY_DISPOSED', 'Asset is already disposed');
      break;

    case 'LOST':
      if (s === 'LOST') throw new AppError(400, 'ASSET_ALREADY_LOST', 'Asset is already marked as lost');
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot mark a disposed asset as lost');
      break;

    case 'FOUND':
      if (s !== 'LOST') throw new AppError(400, 'ASSET_NOT_LOST', 'Only lost assets can be marked as found');
      break;

    case 'SWAP':
      if (s === 'DISPOSED') throw new AppError(400, 'ASSET_DISPOSED', 'Cannot swap a disposed asset');
      if (s === 'LOST') throw new AppError(400, 'ASSET_LOST', 'Cannot swap a lost asset');
      if (s === 'IN_MAINTENANCE') throw new AppError(400, 'ASSET_IN_MAINTENANCE', 'Cannot swap an asset in maintenance');
      break;
  }
}

function createAuditLog(
  tx: PrismaTransactionClient,
  userId: string,
  action: 'CREATE' | 'UPDATE',
  resourceId: string,
  newValues: Prisma.InputJsonValue,
) {
  return repo.createAuditLogInTransaction(tx, {
    user: { connect: { id: userId } },
    action,
    resourceType: 'AssetMovement',
    resourceId,
    newValues,
  });
}

// ── ASSIGNMENT ──────────────────────────────────────────────────────

async function handleAssignment(input: CreateMovementInput, performedByUserId: string) {
  const toUserId = input.toUserId;
  if (!toUserId) {
    throw new AppError(400, 'TO_USER_REQUIRED', 'toUserId is required for ASSIGNMENT');
  }

  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'ASSIGNMENT');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'ASSIGNMENT',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      ...(asset.assignedToUserId && { fromUser: { connect: { id: asset.assignedToUserId } } }),
      toUser: { connect: { id: toUserId } },
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      assignedTo: { connect: { id: toUserId } },
      status: 'ACTIVE',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'ASSIGNMENT',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── UNASSIGNMENT ────────────────────────────────────────────────────

async function handleUnassignment(input: CreateMovementInput, performedByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'UNASSIGNMENT');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'UNASSIGNMENT',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      ...(asset.assignedToUserId && { fromUser: { connect: { id: asset.assignedToUserId } } }),
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      assignedTo: { disconnect: true },
      status: 'IDLE',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'UNASSIGNMENT',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── LOCATION_TRANSFER ───────────────────────────────────────────────

async function handleLocationTransfer(input: CreateMovementInput, performedByUserId: string) {
  const toLocationId = input.toLocationId;
  if (!toLocationId) {
    throw new AppError(400, 'TO_LOCATION_REQUIRED', 'toLocationId is required for LOCATION_TRANSFER');
  }

  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'LOCATION_TRANSFER');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'LOCATION_TRANSFER',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      fromLocation: { connect: { id: asset.locationId } },
      toLocation: { connect: { id: toLocationId } },
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      location: { connect: { id: toLocationId } },
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'LOCATION_TRANSFER',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── LOAN_OUT ────────────────────────────────────────────────────────

async function handleLoanOut(input: CreateMovementInput, performedByUserId: string) {
  const toUserId = input.toUserId;
  const expectedReturnDate = input.expectedReturnDate;
  if (!toUserId) {
    throw new AppError(400, 'TO_USER_REQUIRED', 'toUserId is required for LOAN_OUT');
  }
  if (!expectedReturnDate) {
    throw new AppError(400, 'EXPECTED_RETURN_DATE_REQUIRED', 'expectedReturnDate is required for LOAN_OUT');
  }

  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'LOAN_OUT');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'LOAN_OUT',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      toUser: { connect: { id: toUserId } },
      performedBy: { connect: { id: performedByUserId } },
      expectedReturnDate,
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'BORROWED',
      assignedTo: { connect: { id: toUserId } },
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'LOAN_OUT',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── LOAN_RETURN ─────────────────────────────────────────────────────

async function handleLoanReturn(input: CreateMovementInput, performedByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'LOAN_RETURN');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'LOAN_RETURN',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      ...(asset.assignedToUserId && { fromUser: { connect: { id: asset.assignedToUserId } } }),
      performedBy: { connect: { id: performedByUserId } },
      actualReturnDate: new Date(),
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'ACTIVE',
      assignedTo: { disconnect: true },
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'LOAN_RETURN',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── SWAP ────────────────────────────────────────────────────────────

async function handleSwap(input: CreateMovementInput, performedByUserId: string) {
  if (!input.assetId) {
    throw new AppError(400, 'ASSET_REQUIRED', 'assetId is required for SWAP');
  }
  if (!input.swapWithAssetId) {
    throw new AppError(400, 'SWAP_ASSET_REQUIRED', 'swapWithAssetId is required for SWAP');
  }

  return prisma.$transaction(async (tx) => {
    const assetA = await requireAsset(tx, input.assetId, 'SWAP');
    const assetB = await requireAsset(tx, input.swapWithAssetId, 'SWAP');
    const refA = generateMovementRef();
    const refB = generateMovementRef();

    const userA = assetA.assignedToUserId;
    const userB = assetB.assignedToUserId;

    // Movement 1: assetA from userA to userB
    const movementA = await repo.createInTransaction(tx, {
      referenceNumber: refA,
      movementType: 'SWAP',
      status: 'COMPLETED',
      asset: { connect: { id: assetA.id } },
      ...(userA && { fromUser: { connect: { id: userA } } }),
      ...(userB && { toUser: { connect: { id: userB } } }),
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
    });

    // Movement 2: assetB from userB to userA
    await repo.createInTransaction(tx, {
      referenceNumber: refB,
      movementType: 'SWAP',
      status: 'COMPLETED',
      asset: { connect: { id: assetB.id } },
      ...(userB && { fromUser: { connect: { id: userB } } }),
      ...(userA && { toUser: { connect: { id: userA } } }),
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
    });

    // Update assetA: assign to userB
    if (userB) {
      await repo.updateAssetInTransaction(tx, assetA.id, {
        assignedTo: { connect: { id: userB } },
      });
    } else {
      await repo.updateAssetInTransaction(tx, assetA.id, {
        assignedTo: { disconnect: true },
      });
    }

    // Update assetB: assign to userA
    if (userA) {
      await repo.updateAssetInTransaction(tx, assetB.id, {
        assignedTo: { connect: { id: userA } },
      });
    } else {
      await repo.updateAssetInTransaction(tx, assetB.id, {
        assignedTo: { disconnect: true },
      });
    }

    await createAuditLog(tx, performedByUserId, 'CREATE', movementA.id, {
      movementType: 'SWAP',
      referenceNumberA: refA,
      referenceNumberB: refB,
      assetIdA: assetA.id,
      assetIdB: assetB.id,
    });

    return movementA;
  });
}

// ── SEND_TO_MAINTENANCE ─────────────────────────────────────────────

async function handleSendToMaintenance(input: CreateMovementInput, performedByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'SEND_TO_MAINTENANCE');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'SEND_TO_MAINTENANCE',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'IN_MAINTENANCE',
    });

    // Create stub maintenance log
    await repo.createMaintenanceLogInTransaction(tx, {
      asset: { connect: { id: asset.id } },
      performedBy: { connect: { id: performedByUserId } },
      performedAt: new Date(),
      description: input.notes ?? 'Sent to maintenance',
      conditionBefore: asset.condition,
      conditionAfter: asset.condition,
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'SEND_TO_MAINTENANCE',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── RETURN_FROM_MAINTENANCE ─────────────────────────────────────────

async function handleReturnFromMaintenance(input: CreateMovementInput, performedByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'RETURN_FROM_MAINTENANCE');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'RETURN_FROM_MAINTENANCE',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'ACTIVE',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'RETURN_FROM_MAINTENANCE',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── DISPOSAL ────────────────────────────────────────────────────────

async function handleDisposal(input: CreateMovementInput, performedByUserId: string) {
  if (!input.notes) {
    throw new AppError(400, 'NOTES_REQUIRED', 'notes (reason) is required for DISPOSAL');
  }

  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'DISPOSAL');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'DISPOSAL',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      performedBy: { connect: { id: performedByUserId } },
      notes: `${input.notes} | Final book value: ${asset.currentBookValue?.toString() ?? 'N/A'}`,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'DISPOSED',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'DISPOSAL',
      referenceNumber: ref,
      assetId: asset.id,
      finalBookValue: asset.currentBookValue?.toString() ?? null,
    });

    return movement;
  });
}

// ── RESIGNATION_RETURN ──────────────────────────────────────────────

async function handleResignationReturn(input: CreateMovementInput, performedByUserId: string) {
  if (!input.userId) {
    throw new AppError(400, 'USER_ID_REQUIRED', 'userId is required for RESIGNATION_RETURN');
  }

  return prisma.$transaction(async (tx) => {
    const assets = await repo.findAssetsByUserId(tx, input.userId!);

    if (assets.length === 0) {
      throw new AppError(404, 'NO_ASSETS_FOUND', 'No assets assigned to this user');
    }

    const movements = [];

    for (const asset of assets) {
      const ref = generateMovementRef();

      const movement = await repo.createInTransaction(tx, {
        referenceNumber: ref,
        movementType: 'RESIGNATION_RETURN',
        status: 'COMPLETED',
        asset: { connect: { id: asset.id } },
        fromUser: { connect: { id: input.userId! } },
        performedBy: { connect: { id: performedByUserId } },
        notes: input.notes ?? null,
      });

      await repo.updateAssetInTransaction(tx, asset.id, {
        assignedTo: { disconnect: true },
        status: 'IDLE',
      });

      movements.push(movement);
    }

    // Mark user as RESIGNED
    await repo.updateUserInTransaction(tx, input.userId!, {
      status: 'RESIGNED',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movements[0]!.id, {
      movementType: 'RESIGNATION_RETURN',
      userId: input.userId,
      assetCount: assets.length,
    });

    return movements;
  });
}

// ── FOUND ───────────────────────────────────────────────────────────

async function handleFound(input: CreateMovementInput, performedByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'FOUND');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'FOUND',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'ACTIVE',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'FOUND',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── LOST ────────────────────────────────────────────────────────────

async function handleLost(input: CreateMovementInput, performedByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const asset = await requireAsset(tx, input.assetId, 'LOST');
    const ref = generateMovementRef();

    const movement = await repo.createInTransaction(tx, {
      referenceNumber: ref,
      movementType: 'LOST',
      status: 'COMPLETED',
      asset: { connect: { id: asset.id } },
      performedBy: { connect: { id: performedByUserId } },
      notes: input.notes ?? null,
      attachments: input.attachments ?? null,
    });

    await repo.updateAssetInTransaction(tx, asset.id, {
      status: 'LOST',
    });

    await createAuditLog(tx, performedByUserId, 'CREATE', movement.id, {
      movementType: 'LOST',
      referenceNumber: ref,
      assetId: asset.id,
    });

    return movement;
  });
}

// ── Approve Movement ────────────────────────────────────────────────

export async function approveMovement(id: string, approvedByUserId: string) {
  const movement = await repo.findById(id);
  if (!movement) {
    throw new AppError(404, 'MOVEMENT_NOT_FOUND', 'Movement not found');
  }
  if (movement.status !== 'PENDING') {
    throw new AppError(400, 'INVALID_STATUS', 'Only PENDING movements can be approved');
  }

  await prisma.$transaction(async (tx) => {
    await repo.updateMovementStatus(id, 'APPROVED', approvedByUserId);
    await tx.auditLog.create({
      data: {
        userId: approvedByUserId,
        action: 'APPROVE',
        resourceType: 'AssetMovement',
        resourceId: id,
        newValues: { status: 'APPROVED' },
      },
    });
  });

  return repo.findById(id);
}

// ── Reject Movement ─────────────────────────────────────────────────

export async function rejectMovement(id: string, rejectedByUserId: string) {
  const movement = await repo.findById(id);
  if (!movement) {
    throw new AppError(404, 'MOVEMENT_NOT_FOUND', 'Movement not found');
  }
  if (movement.status !== 'PENDING') {
    throw new AppError(400, 'INVALID_STATUS', 'Only PENDING movements can be rejected');
  }

  await prisma.$transaction(async (tx) => {
    await repo.updateMovementStatus(id, 'REJECTED');
    await tx.auditLog.create({
      data: {
        userId: rejectedByUserId,
        action: 'REJECT',
        resourceType: 'AssetMovement',
        resourceId: id,
        newValues: { status: 'REJECTED' },
      },
    });
  });

  return repo.findById(id);
}

// ── Complete Movement ───────────────────────────────────────────────

export async function completeMovement(id: string, userId: string) {
  const movement = await repo.findById(id);
  if (!movement) {
    throw new AppError(404, 'MOVEMENT_NOT_FOUND', 'Movement not found');
  }
  if (movement.status !== 'PENDING' && movement.status !== 'APPROVED') {
    throw new AppError(400, 'INVALID_STATUS', 'Only PENDING or APPROVED movements can be completed');
  }

  await prisma.$transaction(async (tx) => {
    await repo.updateMovementStatus(id, 'COMPLETED');
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'AssetMovement',
        resourceId: id,
        newValues: { status: 'COMPLETED' },
      },
    });
  });

  return repo.findById(id);
}
