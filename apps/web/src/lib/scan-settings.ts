/**
 * User preferences for the scan module. Persisted to localStorage so the
 * choice survives across sessions/devices (per browser profile).
 *
 * Read+write is synchronous + tolerant of localStorage being unavailable
 * (private browsing, quota errors) — every reader falls back to defaults.
 * No React context wiring: the surface area is tiny (two booleans) and
 * consumers either read on-demand inside an event handler (scan-feedback)
 * or subscribe via the `useScanSettings` hook.
 */

import { useEffect, useState } from "react";

export interface ScanSettings {
  /** Play the confirmation beep on successful decode. */
  soundEnabled: boolean;
  /** Trigger haptic vibration on successful decode (Android Chrome). */
  vibrateEnabled: boolean;
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  soundEnabled: true,
  vibrateEnabled: true,
};

const STORAGE_KEY = "wedisense:scan-settings";

/**
 * Synchronous read. Safe to call inside the barcode decode callback —
 * localStorage reads are fast (microseconds for a tiny JSON payload).
 * Falls back to defaults on parse error or localStorage unavailability.
 */
export function readScanSettings(): ScanSettings {
  if (typeof window === "undefined") return DEFAULT_SCAN_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCAN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ScanSettings>;
    // Defensive merge — older versions or hand-edited values might be
    // missing a key. Defaults fill any gap.
    return {
      soundEnabled: parsed.soundEnabled ?? DEFAULT_SCAN_SETTINGS.soundEnabled,
      vibrateEnabled:
        parsed.vibrateEnabled ?? DEFAULT_SCAN_SETTINGS.vibrateEnabled,
    };
  } catch {
    return DEFAULT_SCAN_SETTINGS;
  }
}

export function writeScanSettings(next: ScanSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    // Same-tab listeners that subscribed via useScanSettings re-render via
    // the custom event below; the native `storage` event only fires for
    // OTHER tabs, so we synthesize one for the writing tab too.
    window.dispatchEvent(new Event("wedisense:scan-settings-changed"));
  } catch {
    // Quota / private-browsing — silently ignore. Setting just won't
    // persist; the UI shows the new value in-memory anyway.
  }
}

/**
 * Reactive hook — re-renders consumers when settings change in this tab
 * or another. Used by the Settings dialog to drive checkboxes and by any
 * future UI that needs to reflect prefs (e.g. a status indicator).
 */
export function useScanSettings(): [ScanSettings, (next: ScanSettings) => void] {
  const [settings, setSettings] = useState<ScanSettings>(DEFAULT_SCAN_SETTINGS);

  useEffect(() => {
    setSettings(readScanSettings());
    const onChange = () => setSettings(readScanSettings());
    window.addEventListener("storage", onChange);
    window.addEventListener("wedisense:scan-settings-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("wedisense:scan-settings-changed", onChange);
    };
  }, []);

  const update = (next: ScanSettings) => {
    setSettings(next);
    writeScanSettings(next);
  };

  return [settings, update];
}
