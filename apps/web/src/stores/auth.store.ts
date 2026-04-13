import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUserRole {
  id: string;
  name: string;
  locationId: string | null;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  preferredLanguage: string;
  status: string;
  roles: AuthUserRole[];
  permissions: string[];
  accessibleLocationIds: string[];
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
}

interface AuthActions {
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  updateUser: (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,

      setAuth: (token, user) =>
        set({ accessToken: token, user, isAuthenticated: true }),

      logout: () =>
        set({ accessToken: null, user: null, isAuthenticated: false }),

      updateUser: (user) => set({ user }),
    }),
    {
      name: "wedisense-auth",
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
