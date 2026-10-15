import { z } from 'zod';

const userStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'RESIGNED']);

// Empty string from a form means "none" — normalise to null before the
// email format check so an untouched field doesn't fail validation.
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().email().nullable().optional(),
);

/**
 * A User row is an EMPLOYEE record; the login account on top of it is
 * optional. `password` present ⇒ create an account, which also requires
 * `email` (login is by email). Without a password the row is a plain
 * employee: an asset holder / handover party who never signs in.
 */
export const createUserSchema = z
  .object({
    name: z.string().min(1).max(255),
    email: optionalEmail,
    password: z.string().min(8).optional(),
    employeeId: z.string().min(1).max(50),
    phone: z.string().max(20).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    preferredLanguage: z.string().max(5).optional(),
    status: userStatusEnum.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.password && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Email is required to create a login account',
      });
    }
  });

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: optionalEmail,
  employeeId: z.string().min(1).max(50).optional(),
  phone: z.string().max(20).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  preferredLanguage: z.string().max(5).optional(),
  status: userStatusEnum.optional(),
});

/**
 * Bulk employee creation — the "ten new hires started on Monday" case.
 * Plain employee rows only (no passwords): accounts are granted one by
 * one afterwards via POST /users/:id/account, which keeps credentials
 * out of a spreadsheet-shaped payload. Capped at 200 rows per call so a
 * single transaction stays short.
 */
export const bulkCreateUsersSchema = z.object({
  users: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        employeeId: z.string().trim().min(1).max(50),
        email: optionalEmail,
        phone: z.string().trim().max(20).nullable().optional(),
        status: userStatusEnum.optional(),
      }),
    )
    .min(1, 'At least one employee is required')
    .max(200, 'At most 200 employees per request'),
});

/**
 * Grant a login account to an existing employee. `email` may be omitted
 * when the employee row already carries one.
 */
export const createUserAccountSchema = z.object({
  email: optionalEmail,
  password: z.string().min(8),
});

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: userStatusEnum.optional(),
  roleId: z.string().uuid().optional(),
  search: z.string().optional(),
  // "true" → only employees with a login, "false" → only those without.
  hasAccount: z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
    .optional(),
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
export type BulkCreateUsersInput = z.infer<typeof bulkCreateUsersSchema>;
export type CreateUserAccountInput = z.infer<typeof createUserAccountSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
