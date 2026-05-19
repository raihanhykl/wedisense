"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-table column visibility, persisted to localStorage.
 *
 * Keys never collide with another page because callers pass a `storageKey`
 * unique to the table (e.g. "wedisense:columns:assets"). The `defaults`
 * object provides the initial visibility for new users and acts as the
 * source of truth for which columns exist — any key in localStorage that
 * isn't in defaults is silently dropped on read.
 *
 * Why not server-side? Column visibility is a per-device preference (you
 * might want fewer columns on a small laptop than on a desktop). Tier 4.1's
 * saved views already cover server-side preferences when needed.
 */
export function useColumnVisibility<TKey extends string>(
  storageKey: string,
  defaults: Record<TKey, boolean>,
): {
  visible: Record<TKey, boolean>;
  toggle: (key: TKey) => void;
  reset: () => void;
} {
  // Lazy init: read localStorage on first render so the hook starts
  // already-rehydrated (no flash of default visibility). SSR guard
  // because Next.js renders this on the server too.
  const [visible, setVisible] = useState<Record<TKey, boolean>>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<Record<TKey, boolean>>;
      // Sanitize: only keep keys present in `defaults`, fall back to
      // default visibility for missing or non-boolean entries.
      const merged = { ...defaults };
      for (const key of Object.keys(defaults) as TKey[]) {
        if (typeof parsed[key] === "boolean") {
          merged[key] = parsed[key]!;
        }
      }
      return merged;
    } catch {
      return defaults;
    }
  });

  // Persist on change. We write the entire object (not just the toggled
  // key) so a key added to `defaults` in a future release shows up in
  // storage on first toggle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visible));
    } catch {
      // Quota / privacy mode — silently ignored.
    }
  }, [visible, storageKey]);

  const toggle = useCallback((key: TKey) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const reset = useCallback(() => {
    setVisible(defaults);
  }, [defaults]);

  return { visible, toggle, reset };
}
