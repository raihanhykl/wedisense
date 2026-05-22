import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { getCurrency } from "./currencies";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a money value using its currency's locale + decimal precision.
 * Accepts string (Decimal from API) OR number. Bad inputs (NaN, null,
 * empty) collapse to an em-dash so the UI never renders "$NaN".
 *
 * Phase 17 v2: replaces the IDR-only formatIDR — keep the old export
 * as a thin wrapper for callers that haven't migrated.
 */
export function formatCurrency(
  value: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "—";
  const def = getCurrency(currency);
  return new Intl.NumberFormat(def.locale, {
    style: "currency",
    currency: def.code,
    minimumFractionDigits: def.fractionDigits,
    maximumFractionDigits: def.fractionDigits,
  }).format(num);
}

/**
 * Strip everything except digits + a single decimal point from raw user
 * input. Returns a string ready to feed to Number() OR back to an
 * <input> in raw form. Empty string when no digits seen so callers can
 * persist `null` instead of `0` for "not entered".
 *
 * Why string-out: we want to round-trip through React Hook Form which
 * stores form values as strings, and we want to keep the user's
 * trailing-zero / decimal-precision intent.
 */
export function parseMoneyInput(raw: string): string {
  if (!raw) return "";
  // Strip thousand-separators (comma + period, locale-agnostic) — we'll
  // re-insert the canonical decimal at the end.
  let s = raw.replace(/[\s,_]/g, "");
  // Treat the LAST period as the decimal mark; collapse the rest.
  const lastDot = s.lastIndexOf(".");
  if (lastDot >= 0) {
    const head = s.slice(0, lastDot).replace(/\./g, "");
    const tail = s.slice(lastDot + 1);
    s = `${head}.${tail}`;
  }
  // Drop anything still not a digit or single dot.
  s = s.replace(/[^\d.]/g, "");
  // Squash multiple dots that survived (shouldn't be possible after the
  // lastDot split, but defensive).
  const parts = s.split(".");
  if (parts.length > 2) {
    s = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  return s;
}

/**
 * Compact display of a money input value WITHOUT the currency symbol —
 * used inside <input> fields when we want thousand-separators but the
 * code is on a sibling element.
 */
export function formatMoneyForInput(
  value: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "";
  const def = getCurrency(currency);
  return new Intl.NumberFormat(def.locale, {
    minimumFractionDigits: def.fractionDigits,
    maximumFractionDigits: def.fractionDigits,
  }).format(num);
}

/** @deprecated Use formatCurrency(value, "IDR") instead. */
export function formatIDR(value: string | number): string {
  return formatCurrency(value, "IDR");
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("id-ID");
}
