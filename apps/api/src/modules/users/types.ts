import type { UserStatus } from '@prisma/client';

export interface UserListFilters {
  status?: UserStatus;
  roleId?: string;
  search?: string;
}
