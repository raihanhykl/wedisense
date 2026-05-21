/**
 * Recent scans — last N successful decodes for the current tab session.
 *
 * Persisted to sessionStorage rather than localStorage because:
 *   - History is meaningful in-context (the user just scanned these
 *     during their current shift / task); not across days.
 *   - sessionStorage clears on tab close, avoiding "I scanned this last
 *     week" stale items polluting the UI.
 *   - Multi-tab independence — two open scan tabs don't fight over a
 *     shared history.
 *
 * Stored as an array of `RecentScan`, newest first, capped at MAX_HISTORY.
 * Mutations dispatch a custom event so the React hook can re-render
 * (sessionStorage events don't fire in the writing tab, like localStorage).
 */

import { useEffect, useState } from "react";

export interface RecentScan {
  /** Raw scanned value — same input that goes through handleScan(). */
  value: string;
  /** Resolved outcome label for the history list ("Asset: WDS-...",
   *  "Product: Mikrotik ...", "Unrecognized", etc.). */
  outcome: string;
  /** Discriminator used for the icon/colour in the UI. */
  kind: "asset" | "location" | "product" | "unrecognized";
  /** Epoch ms — used for "5m ago" relative formatting. */
  ts: number;
}

const STORAGE_KEY = "wedisense:scan-history";
const MAX_HISTORY = 20;
const CHANGE_EVENT = "wedisense:scan-history-changed";

function safeRead(): RecentScan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_HISTORY) as RecentScan[];
  } catch {
    return [];
  }
}

function safeWrite(list: RecentScan[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Quota — ignore. Older entries just won't trim.
  }
}

/**
 * Append a scan to the head of history. Deduplicates against the most
 * recent entry only (back-to-back same value) so a rapid double-scan
 * doesn't create two log entries. Older duplicates are kept as separate
 * events because the user really did scan twice with intent.
 */
export function pushRecentScan(entry: Omit<RecentScan, "ts">): void {
  const current = safeRead();
  if (current[0]?.value === entry.value) {
    // Refresh timestamp on the head so "just now" stays accurate, but
    // don't push a second entry.
    current[0] = { ...current[0], ts: Date.now() };
    safeWrite(current);
    return;
  }
  const next: RecentScan[] = [{ ...entry, ts: Date.now() }, ...current].slice(
    0,
    MAX_HISTORY,
  );
  safeWrite(next);
}

export function clearRecentScans(): void {
  safeWrite([]);
}

/**
 * Reactive hook — re-renders on history change in this tab or another.
 * Returns the list newest-first. Consumers typically render a small
 * card with the last 5-10 items.
 */
export function useRecentScans(): RecentScan[] {
  const [list, setList] = useState<RecentScan[]>([]);

  useEffect(() => {
    setList(safeRead());
    const onChange = () => setList(safeRead());
    window.addEventListener("storage", onChange);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, []);

  return list;
}

/**
 * Format a timestamp as a coarse relative string suitable for the
 * history row. Avoids importing a date-fns / dayjs dependency — these
 * timestamps are all within the current tab session (≤ a few hours).
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
