import { z } from 'zod';

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

export const setPermissionsSchema = z.object({
  permissionIds: z.array(z.string().uuid()),
});

/**
 * Clone a role — copy permissions wholesale into a new custom role.
 * Caller supplies the destination name; permissions inherit from the
 * source. Always produces a non-system (custom) role even when cloning
 * from SUPER_ADMIN / ADMIN — those are protected by name + permission
 * change guards, but the clone is fully customisable.
 */
export const cloneRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type SetPermissionsInput = z.infer<typeof setPermissionsSchema>;
export type CloneRoleInput = z.infer<typeof cloneRoleSchema>;
