import { z } from 'zod';

const movementTypeEnum = z.enum([
  'ASSIGNMENT',
  'UNASSIGNMENT',
  'LOCATION_TRANSFER',
  'LOAN_OUT',
  'LOAN_RETURN',
  'RESIGNATION_RETURN',
  'SWAP',
  'SEND_TO_MAINTENANCE',
  'RETURN_FROM_MAINTENANCE',
  'DISPOSAL',
  'FOUND',
  'LOST',
]);

const movementStatusEnum = z.enum([
  'PENDING',
  'APPROVED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);

export const createMovementSchema = z.object({
  assetId: z.string().uuid().optional(),
  movementType: movementTypeEnum,
  toUserId: z.string().uuid().nullable().optional(),
  toLocationId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  expectedReturnDate: z.coerce.date().nullable().optional(),
  attachments: z.any().optional(),
  // SWAP specific
  swapWithAssetId: z.string().uuid().optional(),
  // RESIGNATION_RETURN specific
  userId: z.string().uuid().optional(),
});

export const movementListFilterSchema = z.object({
  assetId: z.string().uuid().optional(),
  movementType: movementTypeEnum.optional(),
  status: movementStatusEnum.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  performedByUserId: z.string().uuid().optional(),
  // Narrow results to movements involving a specific location (as the
  // source or destination of the transfer). Used by the location detail
  // page's Activity tab. RBAC scope is applied on top regardless of this
  // explicit filter.
  locationId: z.string().uuid().optional(),
});

export type CreateMovementInput = z.infer<typeof createMovementSchema>;
export type MovementListFilterInput = z.infer<typeof movementListFilterSchema>;
