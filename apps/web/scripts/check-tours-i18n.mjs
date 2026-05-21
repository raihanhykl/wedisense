#!/usr/bin/env node
/**
 * check-tours-i18n.mjs
 *
 * Validates the tours namespace locale files (en + id) for key parity:
 *
 *   1. Every key in en/tours.json must exist in id/tours.json.
 *   2. Every key in id/tours.json must exist in en/tours.json.
 *   3. No empty-string values (a placeholder key with "" silently hides
 *      copy from users in that language).
 *
 * Exits non-zero on any mismatch so CI catches drift the same way the
 * tour-targets codegen catches data-tour drift. Run via `pnpm tour:i18n:check`.
 *
 * NOTE: the validator looks at the full tours.json namespace, not just
 * the keys referenced by seeded tour steps. That's intentional — copy
 * gets added speculatively (e.g. while authoring an upcoming feature)
 * and missing translations should fail loud at PR time even before the
 * tour step that references them lands.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Hop from apps/web/scripts/ up to the monorepo root, then into shared/locales.
const LOCALES_ROOT = resolve(__dirname, "../../../packages/shared/locales");
const EN_PATH = resolve(LOCALES_ROOT, "en/tours.json");
const ID_PATH = resolve(LOCALES_ROOT, "id/tours.json");

function load(path) {
  if (!existsSync(path)) {
    console.error(`Missing locale file: ${path}`);
    exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
}

/**
 * Flatten a nested JSON locale into a Map<dotPath, value>. Arrays aren't
 * expected in tour copy and are treated as a parse error if encountered —
 * we want explicit object structure so missing keys are obvious.
 */
function flatten(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, out);
    } else if (typeof value === "string") {
      out.set(path, value);
    } else {
      console.error(
        `Unsupported value type at "${path}" — tour copy must be plain strings.`,
      );
      exit(1);
    }
  }
  return out;
}

function main() {
  const en = flatten(load(EN_PATH));
  const id = flatten(load(ID_PATH));

  const enKeys = new Set(en.keys());
  const idKeys = new Set(id.keys());

  const missingInId = [...enKeys].filter((k) => !idKeys.has(k)).sort();
  const missingInEn = [...idKeys].filter((k) => !enKeys.has(k)).sort();

  // An empty string value would render a blank step title/description —
  // that's worse than a missing key (no graceful fallback).
  const emptyInEn = [...en.entries()].filter(([, v]) => v === "").map(([k]) => k).sort();
  const emptyInId = [...id.entries()].filter(([, v]) => v === "").map(([k]) => k).sort();

  let failed = false;

  if (missingInId.length > 0) {
    console.error(`Missing in id/tours.json (${missingInId.length}):`);
    for (const k of missingInId) console.error(`  - ${k}`);
    failed = true;
  }
  if (missingInEn.length > 0) {
    console.error(`Missing in en/tours.json (${missingInEn.length}):`);
    for (const k of missingInEn) console.error(`  - ${k}`);
    failed = true;
  }
  if (emptyInEn.length > 0) {
    console.error(`Empty strings in en/tours.json (${emptyInEn.length}):`);
    for (const k of emptyInEn) console.error(`  - ${k}`);
    failed = true;
  }
  if (emptyInId.length > 0) {
    console.error(`Empty strings in id/tours.json (${emptyInId.length}):`);
    for (const k of emptyInId) console.error(`  - ${k}`);
    failed = true;
  }

  if (failed) {
    console.error("\ntour i18n check FAILED — update the locale files and re-run.\n");
    exit(1);
  }

  console.log(
    `tour i18n check passed (${enKeys.size} keys aligned across en + id).`,
  );
}

main();
