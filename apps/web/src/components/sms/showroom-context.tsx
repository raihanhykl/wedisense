"use client";

/**
 * Which showroom the Stock screens are looking at, and what the signed-in
 * user may do there.
 *
 * `GET /api/sms/context` returns the showrooms the user can see together
 * with the stock permissions held at each one. The selected showroom is
 * remembered per browser so an admin lands on their own showroom next time.
 *
 * `can(permission)` is only a UI affordance (hide a button the server would
 * refuse anyway) — the server enforces every action itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SmsPermission } from "@wedisense/shared";
import { apiGet } from "@/lib/api";
import { smsErrorMessage } from "@/lib/sms/client";

export interface SmsShowroom {
  id: string;
  code: string;
  name: string;
  type: string;
  permissions: string[];
}

interface SmsContextResponse {
  showrooms: SmsShowroom[];
  globalPermissions: string[];
}

interface ShowroomContextValue {
  showrooms: SmsShowroom[];
  /** The showroom currently in view; null until loaded or when none is accessible. */
  showroom: SmsShowroom | null;
  selectShowroom: (showroomId: string) => void;
  /** Does the user hold `permission` at the selected showroom? */
  can: (permission: SmsPermission) => boolean;
  /** Does the user hold `permission` at a specific showroom? */
  canAt: (permission: SmsPermission, showroomId: string | null | undefined) => boolean;
  /** Does the user hold `permission` network-wide (unscoped role)? */
  canGlobally: (permission: SmsPermission) => boolean;
  isLoading: boolean;
  error: string | null;
  /** Load the access list again (after a network error). */
  retry: () => void;
}

const STORAGE_KEY = "wedisense:sms:showroom";

const ShowroomContext = createContext<ShowroomContextValue | null>(null);

export function ShowroomProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sms", "context"],
    queryFn: () => apiGet<SmsContextResponse>("/api/sms/context"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Restore the remembered showroom once the list is known; fall back to the
  // first accessible one if it is gone or was never set.
  useEffect(() => {
    if (!data) return;
    const remembered = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    const stillValid = data.showrooms.some((s) => s.id === (selectedId ?? remembered));
    if (selectedId && stillValid) return;
    const next = stillValid ? remembered : (data.showrooms[0]?.id ?? null);
    setSelectedId(next);
  }, [data, selectedId]);

  const selectShowroom = useCallback((showroomId: string) => {
    setSelectedId(showroomId);
    try {
      window.localStorage.setItem(STORAGE_KEY, showroomId);
    } catch {
      // Private mode / storage disabled: the selection still works for this visit.
    }
  }, []);

  const value = useMemo<ShowroomContextValue>(() => {
    const showrooms = data?.showrooms ?? [];
    const globalPermissions = new Set(data?.globalPermissions ?? []);
    const showroom = showrooms.find((s) => s.id === selectedId) ?? null;
    const canAt = (permission: SmsPermission, showroomId: string | null | undefined) => {
      if (globalPermissions.has(permission)) return true;
      if (!showroomId) return false;
      return showrooms.find((s) => s.id === showroomId)?.permissions.includes(permission) ?? false;
    };
    return {
      showrooms,
      showroom,
      selectShowroom,
      can: (permission) => canAt(permission, showroom?.id),
      canAt,
      canGlobally: (permission) => globalPermissions.has(permission),
      isLoading,
      error: error ? smsErrorMessage(error, "Could not load your stock access.") : null,
      retry: () => void refetch(),
    };
  }, [data, selectedId, selectShowroom, isLoading, error, refetch]);

  return <ShowroomContext.Provider value={value}>{children}</ShowroomContext.Provider>;
}

export function useShowroom(): ShowroomContextValue {
  const value = useContext(ShowroomContext);
  if (!value) {
    throw new Error("useShowroom must be used inside <ShowroomProvider> (the /admin/sms layout)");
  }
  return value;
}

/** Showroom picker for page headers. Renders plain text when there is only one choice. */
export function ShowroomSwitcher({ className }: { className?: string }) {
  const { showrooms, showroom, selectShowroom } = useShowroom();
  if (!showroom) return null;
  if (showrooms.length === 1) {
    return <span className={className ?? "text-sm font-medium"}>{showroom.name}</span>;
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Showroom</span>
      <select
        value={showroom.id}
        onChange={(e) => selectShowroom(e.target.value)}
        data-tour="sms-showroom-switcher"
        className={
          className ??
          "h-9 max-w-[60vw] rounded-md border border-input bg-background px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
        }
      >
        {showrooms.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
