import { z } from 'zod';

const userStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'RESIGNED']);

export const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
  employeeId: z.string().min(1).max(50),
  phone: z.string().max(20).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  preferredLanguage: z.string().max(5).optional(),
  status: userStatusEnum.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  employeeId: z.string().min(1).max(50).optional(),
  phone: z.string().max(20).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  preferredLanguage: z.string().max(5).optional(),
  status: userStatusEnum.optional(),
});

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: userStatusEnum.optional(),
  roleId: z.string().uuid().optional(),
  search: z.string().optional(),
});

export const assignRolesSchema = z.object({
  roles: z.array(
    z.object({
      roleId: z.string().uuid(),
      locationId: z.string().uuid().nullable().optional(),
    }),
  ),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
