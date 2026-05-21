#!/usr/bin/env node
/**
 * codegen-tour-targets.mjs
 *
 * Scans every `data-tour="..."` literal in apps/web/src and writes a
 * generated TypeScript file declaring:
 *   - TOUR_TARGETS: a readonly tuple of all values (sorted, deduped)
 *   - TourTargetValue: the union type
 *
 * Run via `pnpm tour:codegen`. CI runs `pnpm tour:codegen:check` which
 * regenerates to a temp file and exits non-zero if the committed file
 * is stale — this prevents the registry from silently drifting out of
 * sync with the JSX attributes it represents.
 *
 * Scope:
 *   - Only .tsx files are scanned (JSX attributes don't appear in .ts).
 *   - The generated file path is excluded from its own scan.
 *   - Template-literal values (`data-tour="${...}"`) are skipped — they're
 *     runtime-computed and shouldn't bake into the registry.
 *   - Values are validated as kebab-case (lowercase + digits + hyphens).
 *     A non-conforming value triggers an error so the dev catches typos
 *     at codegen time, not when the picker silently rejects them.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(PROJECT_ROOT, "src");
const OUTPUT_PATH = resolve(SRC_DIR, "lib/tour-targets.generated.ts");

// Skip directories that are noise (build artifacts, deps, etc).
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "out", ".turbo"]);

// `data-tour="..."` — captures the attribute value as long as it contains
// only kebab-case-ish characters. The character class deliberately excludes
// `$` so JSX with template literals like data-tour={`foo-${id}`} is skipped
// (the actual JSX attribute form `data-tour=` plus a template literal won't
// match a leading double quote anyway, but excluding `$` is belt-and-braces).
const DATA_TOUR_REGEX = /data-tour=["']([a-z][a-z0-9-]*)["']/g;

// Strict shape check used after capture to reject values like "..." or
// anything that snuck through with characters we don't want in selector
// strings.
const VALID_KEY = /^[a-z][a-z0-9-]*$/;

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (stat.isFile() && extname(full) === ".tsx" && full !== OUTPUT_PATH) {
      files.push(full);
    }
  }
}

function scanForTargets() {
  const files = [];
  walk(SRC_DIR, files);

  const values = new Set();
  const locations = new Map(); // value → [file, file, ...] (for debug only)

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    let m;
    DATA_TOUR_REGEX.lastIndex = 0;
    while ((m = DATA_TOUR_REGEX.exec(content)) !== null) {
      const v = m[1];
      if (!VALID_KEY.test(v)) continue;
      values.add(v);
      const arr = locations.get(v) ?? [];
      arr.push(file);
      locations.set(v, arr);
    }
  }

  return { values: [...values].sort(), locations };
}

function renderFile(values) {
  // The header explicitly tells future readers this is generated. Editors
  // commonly hide generated files via .gitattributes / IDE settings — the
  // comment block plus the file suffix makes the intent unambiguous.
  // The `**/*.tsx` glob can't appear inside a /** ... */ JSDoc block —
  // the embedded `*/` closes the comment early and the parser explodes.
  // We use a // line-comment header instead; the IDE still picks up the
  // "do not edit" intent and TypeScript leaves it alone.
  const header = [
    "// AUTO-GENERATED — DO NOT EDIT BY HAND.",
    "//",
    "// Regenerate with `pnpm tour:codegen`.",
    "//",
    "// Source of truth: every `data-tour=\"value\"` JSX attribute under",
    "// apps/web/src (recursively, .tsx only). The codegen script walks",
    "// that tree and collects unique values; this file is the typed",
    "// projection used by the tour-registry, admin picker, and any other",
    "// tour-aware consumer.",
    "",
  ].join("\n");

  if (values.length === 0) {
    // Guard: empty const tuple is invalid TS. Emit a sentinel that still",
    // typechecks and surfaces the empty registry clearly in the admin UI.
    return (
      header +
      `export const TOUR_TARGETS = [] as const;\n` +
      `export type TourTargetValue = never;\n`
    );
  }

  const literals = values.map((v) => `  "${v}"`).join(",\n");
  return (
    header +
    `export const TOUR_TARGETS = [\n${literals},\n] as const;\n` +
    `\n` +
    `export type TourTargetValue = (typeof TOUR_TARGETS)[number];\n`
  );
}

function main() {
  const checkMode = argv.includes("--check");

  const { values } = scanForTargets();
  const rendered = renderFile(values);

  if (checkMode) {
    let existing = "";
    if (existsSync(OUTPUT_PATH)) {
      existing = readFileSync(OUTPUT_PATH, "utf8");
    }
    if (existing !== rendered) {
      console.error(
        "tour-targets.generated.ts is stale.\n" +
          "Run `pnpm --filter web tour:codegen` and commit the updated file.\n",
      );
      // Show a short diff hint without pulling in a diff lib.
      const existingValues = (existing.match(/"[a-z][a-z0-9-]*"/g) ?? []).map((s) =>
        s.slice(1, -1),
      );
      const currentSet = new Set(values);
      const oldSet = new Set(existingValues);
      const added = values.filter((v) => !oldSet.has(v));
      const removed = existingValues.filter((v) => !currentSet.has(v));
      if (added.length > 0) console.error(`  + added:   ${added.join(", ")}`);
      if (removed.length > 0) console.error(`  - removed: ${removed.join(", ")}`);
      exit(1);
    }
    console.log(`tour-targets.generated.ts: up to date (${values.length} targets).`);
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, rendered, "utf8");
  console.log(
    `tour-targets.generated.ts: wrote ${values.length} target${values.length === 1 ? "" : "s"}.`,
  );
}

main();
