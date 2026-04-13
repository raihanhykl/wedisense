import { z } from 'zod';

const locationTypeEnum = z.enum([
  'HEAD_OFFICE',
  'BRANCH',
  'FACTORY',
  'SHOWROOM',
  'SERVICE_CENTER',
  'OTHER',
]);

export const createLocationSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  type: locationTypeEnum,
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(50).optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  type: locationTypeEnum.optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const locationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  type: locationTypeEnum.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationListQuery = z.infer<typeof locationListQuerySchema>;
