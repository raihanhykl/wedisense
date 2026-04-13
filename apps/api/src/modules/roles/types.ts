export interface RoleWithPermissions {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  rolePermissions: Array<{
    permission: {
      id: string;
      resource: string;
      action: string;
    };
  }>;
}
