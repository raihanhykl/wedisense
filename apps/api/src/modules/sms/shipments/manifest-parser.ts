/**
 * manifest-parser.ts — Pure manifest analysis.
 *
 * Takes a parsed 2-D array of strings (output of tabular.ts) and produces
 * a structured classification of VIN candidates, component rows, and
 * ambiguous entries. No I/O, no Prisma.
 *
 * Rules:
 *  - A VIN is exactly 17 characters of [A-Z0-9] excluding I, O, Q.
 *  - Rows that share a VIN are FOLDED into one candidate; component keyword
 *    rows are SKIPPED; everything else that cannot be safely classified is
 *    marked AMBIGUOUS with a reason.
 *  - Identifier normalisation: trim + uppercase only (no stripping).
 */

export const MANIFEST_FIELD_SYNONYMS: Record<string, string[]> = {
  vin: [
    'nomor rangka',
    'no rangka',
    'no. rangka',
    'vin',
    'chassis',
    'chassis no',
    'chassis number',
    'frame no',
    'frame number',
    'nomor sasis',
    'no sasis',
  ],
  engineNumber: [
    'nomor mesin',
    'no mesin',
    'no. mesin',
    'engine no',
    'engine number',
    'engine no.',
    'nomesin',
  ],
  model: ['model', 'tipe', 'type', 'vehicle model'],
  variant: ['varian', 'variant', 'tipe kendaraan'],
  color: ['warna', 'color', 'colour'],
  itemType: [
    'jenis',
    'jenis barang',
    'item',
    'item type',
    'kategori',
    'tipe item',
    'type',
  ],
};

/** Keywords (lowercase) that identify component / accessory rows. */
const COMPONENT_KEYWORDS = [
  'baterai',
  'battery',
  'charger',
  'bms',
  'controller',
  'dinamo',
  'aki',
  'kunci',
  'helm',
  'toolkit',
  'tool kit',
  'aksesori',
  'accessory',
  'accessories',
  'spare part',
  'sparepart',
  'onderdil',
  'kabel',
  'cable',
  'adaptor',
  'adapter',
  'manual',
  'buku',
  'parts',
];

/** Returns true when the item type text clearly describes an accessory/component. */
function isComponentItemType(value: string): boolean {
  const v = value.toLowerCase().trim();
  return COMPONENT_KEYWORDS.some((kw) => v.includes(kw));
}

/**
 * A VIN is exactly 17 characters: A–Z, 0–9, excluding I, O, Q.
 * Returns the normalised (trimmed + uppercased) VIN if valid, null otherwise.
 */
function parseVin(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (v.length !== 17) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return null;
  return v;
}

/** Normalise an identifier (VIN, engine number): trim + uppercase only. */
function normaliseId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Non-empty string after trimming. */
function nonEmpty(s: string | undefined): boolean {
  return (s?.trim() ?? '') !== '';
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface SourceRow {
  /** 1-based sheet row number. */
  row: number;
  /** Raw cell values keyed by header string. */
  values: Record<string, string>;
}

export interface ManifestConflict {
  field: 'engineNumber' | 'model' | 'variant' | 'color';
  values: string[];
}

export interface ManifestCandidate {
  vin: string;
  engineNumber: string | null;
  model: string | null;
  variant: string | null;
  color: string | null;
  /** Every source row folded into this candidate. */
  sourceRows: SourceRow[];
  /** Set when non-empty field values across repeated VIN rows disagree. */
  conflicts?: ManifestConflict[];
}

export interface AmbiguousRow {
  row: number;
  rawValues: Record<string, string>;
  reason: string;
}

export interface ManifestParseResult {
  candidates: ManifestCandidate[];
  skippedComponents: { count: number; rows: number[] };
  ambiguousRows: AmbiguousRow[];
}

// ── Column mapping helpers ────────────────────────────────────────────────────

type FieldMapping = Record<string, number | null>;

function getCell(cells: string[], mapping: FieldMapping, field: string): string {
  const col = mapping[field];
  if (col === null || col === undefined) return '';
  return cells[col] ?? '';
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a manifest from raw rows.
 *
 * @param rows           All rows from the sheet (including the header row).
 * @param headerRowIndex Index into `rows` for the header row.
 * @param mapping        Map of field name → 0-based column index (null = not found).
 */
export function parseManifest(
  rows: string[][],
  headerRowIndex: number,
  mapping: FieldMapping,
): ManifestParseResult {
  const dataRows = rows.slice(headerRowIndex + 1);
  const headerRow = rows[headerRowIndex] ?? [];

  // Build a header-name lookup from each column index
  const headerByCol: Record<number, string> = {};
  headerRow.forEach((h, idx) => {
    if (h.trim()) headerByCol[idx] = h.trim();
  });

  // Maps for model/variant/color: lowercase key → first-seen original-case value.
  // This enables case-insensitive deduplication while preserving original casing.
  const candidateMap = new Map<
    string,
    {
      engineNumbers: Set<string>;
      models: Map<string, string>;
      variants: Map<string, string>;
      colors: Map<string, string>;
      sourceRows: SourceRow[];
    }
  >();

  const skippedRows: number[] = [];
  const ambiguousRows: AmbiguousRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i] ?? [];
    // 1-based sheet row: headerRowIndex (0-based) + 1 (header takes a row)
    // + i + 1 (data row offset) = headerRowIndex + i + 2
    const sheetRow = headerRowIndex + i + 2;

    // Fully blank rows are silently ignored
    if (cells.every((c) => c.trim() === '')) continue;

    const rawVinCell = getCell(cells, mapping, 'vin');

    // ── Component skip ───────────────────────────────────────────────────
    const itemTypeCol = mapping['itemType'];
    if (itemTypeCol !== null && itemTypeCol !== undefined) {
      const itemTypeVal = cells[itemTypeCol] ?? '';
      if (isComponentItemType(itemTypeVal)) {
        skippedRows.push(sheetRow);
        continue;
      }
    }

    // ── VIN classification ───────────────────────────────────────────────
    const vin = parseVin(rawVinCell);

    if (!vin) {
      // Could be a component row without a typed item-type column
      if (itemTypeCol === null || itemTypeCol === undefined) {
        const itemHint = getCell(cells, mapping, 'itemType');
        if (nonEmpty(itemHint) && isComponentItemType(itemHint)) {
          skippedRows.push(sheetRow);
          continue;
        }
      }

      // If the VIN column was blank but other identity cells are filled,
      // flag as ambiguous (no VIN provided)
      const engineRaw = getCell(cells, mapping, 'engineNumber');
      const modelRaw = getCell(cells, mapping, 'model');
      const hasOtherIdentity = nonEmpty(engineRaw) || nonEmpty(modelRaw);

      if (!nonEmpty(rawVinCell) && hasOtherIdentity) {
        const rawValues: Record<string, string> = {};
        cells.forEach((v, idx) => {
          const key = headerByCol[idx];
          if (key) rawValues[key] = v;
        });
        ambiguousRows.push({
          row: sheetRow,
          rawValues,
          reason: 'VIN column is empty but other identity fields are present',
        });
        continue;
      }

      if (nonEmpty(rawVinCell)) {
        // Value present but doesn't look like a VIN
        const rawValues: Record<string, string> = {};
        cells.forEach((v, idx) => {
          const key = headerByCol[idx];
          if (key) rawValues[key] = v;
        });
        ambiguousRows.push({
          row: sheetRow,
          rawValues,
          reason: `Value "${rawVinCell}" in the VIN column is not a valid 17-character VIN`,
        });
        continue;
      }

      // Blank VIN with no other identity — treat as ambiguous unknown row
      const rawValues: Record<string, string> = {};
      cells.forEach((v, idx) => {
        const key = headerByCol[idx];
        if (key) rawValues[key] = v;
      });
      ambiguousRows.push({
        row: sheetRow,
        rawValues,
        reason: 'Row cannot be classified: no VIN and no recognisable item type',
      });
      continue;
    }

    // ── Fold into candidate ──────────────────────────────────────────────
    const sourceRow: SourceRow = {
      row: sheetRow,
      values: (() => {
        const v: Record<string, string> = {};
        cells.forEach((cell, idx) => {
          const key = headerByCol[idx];
          if (key) v[key] = cell;
        });
        return v;
      })(),
    };

    if (!candidateMap.has(vin)) {
      candidateMap.set(vin, {
        engineNumbers: new Set(),
        models: new Map(),
        variants: new Map(),
        colors: new Map(),
        sourceRows: [],
      });
    }

    const entry = candidateMap.get(vin)!;
    entry.sourceRows.push(sourceRow);

    const engineRaw = normaliseId(getCell(cells, mapping, 'engineNumber'));
    const modelRaw = getCell(cells, mapping, 'model').trim();
    const variantRaw = getCell(cells, mapping, 'variant').trim();
    const colorRaw = getCell(cells, mapping, 'color').trim();

    if (engineRaw) entry.engineNumbers.add(engineRaw);
    // Store first-seen original-case value keyed by lowercase for deduplication
    if (modelRaw) {
      const lower = modelRaw.toLowerCase();
      if (!entry.models.has(lower)) entry.models.set(lower, modelRaw);
    }
    if (variantRaw) {
      const lower = variantRaw.toLowerCase();
      if (!entry.variants.has(lower)) entry.variants.set(lower, variantRaw);
    }
    if (colorRaw) {
      const lower = colorRaw.toLowerCase();
      if (!entry.colors.has(lower)) entry.colors.set(lower, colorRaw);
    }
  }

  // ── Build candidates ─────────────────────────────────────────────────────

  /**
   * Resolve a map of lowercase→originalCase values to a single value, or push
   * a conflict and return null. For Sets (engineNumbers), pass Map built from Set.
   */
  const resolveField = (
    conflicts: ManifestConflict[],
    field: ManifestConflict['field'],
    valueMap: Map<string, string> | Set<string>,
  ): string | null => {
    // Normalise Set to its values array; Map values are original-case strings.
    const vals = valueMap instanceof Set
      ? [...valueMap]
      : [...valueMap.values()];
    if (vals.length === 0) return null;
    if (vals.length === 1) return vals[0]!;
    conflicts.push({ field, values: vals });
    return null;
  };

  const candidates: ManifestCandidate[] = [];

  for (const [vin, entry] of candidateMap) {
    const conflicts: ManifestConflict[] = [];

    const engineNumber = resolveField(conflicts, 'engineNumber', entry.engineNumbers);
    const model = resolveField(conflicts, 'model', entry.models);
    const variant = resolveField(conflicts, 'variant', entry.variants);
    const color = resolveField(conflicts, 'color', entry.colors);

    const candidate: ManifestCandidate = {
      vin,
      engineNumber: engineNumber ? normaliseId(engineNumber) : null,
      // model/variant/color come directly from Map values which are original-cased
      model: model ?? null,
      variant: variant ?? null,
      color: color ?? null,
      sourceRows: entry.sourceRows,
    };

    if (conflicts.length > 0) {
      candidate.conflicts = conflicts;
    }

    candidates.push(candidate);
  }

  return {
    candidates,
    skippedComponents: { count: skippedRows.length, rows: skippedRows },
    ambiguousRows,
  };
}
