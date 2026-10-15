import type { UserStatus } from '@prisma/client';

export interface UserListFilters {
  status?: UserStatus;
  roleId?: string;
  search?: string;
  /** true → only employees with a login account; false → only those without. */
  hasAccount?: boolean;
}
