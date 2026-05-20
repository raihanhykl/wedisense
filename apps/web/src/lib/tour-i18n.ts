/**
 * Minimal i18n resolver for tour step titles/descriptions.
 *
 * Tour steps carry i18n keys (e.g. "admin.dashboard.title"). This helper
 * resolves them against the shared locale JSONs without requiring the full
 * react-i18next stack, which lets TourProvider use it server-side-safe and
 * outside the i18next provider tree.
 *
 * Fallback chain: requested lang → 'id' (default) → raw key (never blank UI)
 */

// JSON imports — resolveJsonModule is enabled in tsconfig.json
import en from "@wedisense/shared/locales/en/tours.json";
import id from "@wedisense/shared/locales/id/tours.json";

type Lang = "en" | "id";

const dicts: Record<Lang, unknown> = { en, id };

/**
 * Walk a dot-separated path into a nested object.
 * Returns the string value if found, or undefined otherwise.
 */
function getNested(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Resolve an i18n key from the tours namespace.
 *
 * @param lang   User's preferred language ('en' | 'id' | any other → falls back to 'id')
 * @param key    Dot-path key. Accepts both "admin.dashboard.title" and
 *               "tours.admin.dashboard.title" (the leading "tours." prefix
 *               is stripped automatically so both seed formats work).
 * @param vars   Optional substitution map for {{placeholder}} tokens
 */
export function tTour(
  lang: string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  // Strip leading namespace prefix that the seed appends (e.g. "tours.")
  const normalised = key.startsWith("tours.") ? key.slice("tours.".length) : key;

  const safeLang: Lang = lang === "en" ? "en" : "id";
  const raw =
    getNested(dicts[safeLang], normalised) ??
    getNested(dicts.id, normalised) ??
    key;

  if (!vars) return raw;

  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k as string] ?? ""));
}
