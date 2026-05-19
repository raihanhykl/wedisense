"use client";

import { useCallback, useEffect, useState } from "react";

export type Density = "compact" | "normal" | "spacious";

const VALID_VALUES: readonly Density[] = ["compact", "normal", "spacious"];

/**
 * Per-device list density preference. Stored in localStorage so the user's
 * choice survives reloads but doesn't sync between devices (a 13" MacBook
 * and a 27" desktop want different defaults — same as column visibility).
 *
 * `storageKey` is required so different list pages can pick their own
 * starting density without interfering (e.g. the assets list could default
 * spacious while the movements list defaults compact in the future).
 */
export function useDensity(
  storageKey: string,
  initialValue: Density = "normal",
): {
  density: Density;
  setDensity: (next: Density) => void;
} {
  const [density, setDensityState] = useState<Density>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw && VALID_VALUES.includes(raw as Density)) {
        return raw as Density;
      }
    } catch {
      // Quota / privacy mode — fall through to default.
    }
    return initialValue;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, density);
    } catch {
      // Same as above.
    }
  }, [density, storageKey]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
  }, []);

  return { density, setDensity };
}
