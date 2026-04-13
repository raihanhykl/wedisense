export interface JwtAccessPayload {
  userId: string;
  email: string;
  type: 'access';
}

export interface JwtRefreshPayload {
  userId: string;
  type: 'refresh';
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  preferredLanguage: string;
  status: string;
  roles: Array<{
    id: string;
    name: string;
    locationId: string | null;
  }>;
  permissions: string[];
  accessibleLocationIds: string[];
}
