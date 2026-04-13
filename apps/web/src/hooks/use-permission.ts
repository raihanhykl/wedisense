import { useAuthStore } from "@/stores/auth.store";

export function usePermission(permission: string): boolean {
  const user = useAuthStore((state) => state.user);
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function usePermissions(permissions: string[]): boolean {
  const user = useAuthStore((state) => state.user);
  if (!user) return false;
  return permissions.every((p) => user.permissions.includes(p));
}

export function useHasAnyPermission(permissions: string[]): boolean {
  const user = useAuthStore((state) => state.user);
  if (!user) return false;
  return permissions.some((p) => user.permissions.includes(p));
}
