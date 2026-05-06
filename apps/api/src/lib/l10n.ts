import fs from 'fs';
import path from 'path';

type LocaleCache = Map<string, Record<string, string>>;

const cache: LocaleCache = new Map();

// Resolve once: this file lives at apps/api/src/lib/l10n.ts.
// At runtime under tsx (CJS), __dirname is apps/api/src/lib;
// after `tsc` build, it's apps/api/dist/lib. From either, the
// monorepo root sits four directories up. Use that anchor so the
// path is independent of the current working directory.
const LOCALES_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'locales');

function resolveLocalePath(lang: string): string {
  return path.join(LOCALES_ROOT, lang, 'notifications.json');
}

function loadLocale(lang: string): Record<string, string> {
  const cached = cache.get(lang);
  if (cached) return cached;

  const filePath = resolveLocalePath(lang);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, string>;
    cache.set(lang, parsed);
    return parsed;
  } catch {
    return {};
  }
}

function replaceVars(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return Object.entries(vars).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }, template);
}

/**
 * Translate a notification key with variable substitution.
 * Fallback chain: requested lang → 'id' → raw key.
 */
export function t(
  lang: string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let locale = loadLocale(lang);
  let value = locale[key];

  if (!value && lang !== 'id') {
    locale = loadLocale('id');
    value = locale[key];
  }

  if (!value) {
    return replaceVars(key, vars);
  }

  return replaceVars(value, vars);
}

/** Clear the locale cache — useful in tests */
export function clearCache(): void {
  cache.clear();
}
