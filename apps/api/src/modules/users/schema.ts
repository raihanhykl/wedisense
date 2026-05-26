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
  // Min 1 — a user with zero roles can't act on the system. The earlier
  // unbounded array allowed admins to silently strip all roles, leaving
  // the user authenticated but inert. The service-layer guard mirrors
  // this with a clean 422 USER_MUST_HAVE_ROLE for direct API callers.
  roles: z
    .array(
      z.object({
        roleId: z.string().uuid(),
        locationId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1, 'User must have at least one role'),
});

// Admin-driven password reset (Phase 17 v2). Distinct from
// /auth/change-password (which is self-service and verifies the CURRENT
// password of the same user). Here the actor proves their own identity
// before being allowed to overwrite someone else's password.
export const resetUserPasswordSchema = z.object({
  // Actor's own password — defence-in-depth against hijacked sessions
  // and shoulder-surfed terminals. Validated server-side via bcrypt.
  actorPassword: z.string().min(1, 'Your current password is required'),
  // Same min-length floor as createUserSchema. Stricter complexity
  // checks (uppercase / digit / symbol) can be layered on later via a
  // policy module without changing this contract.
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
