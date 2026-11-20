/**
 * tabular.ts — Pure, side-effect-free spreadsheet / paste reader.
 *
 * Reused by both the manifest import (this slice) and the opening-balance
 * import (another slice). No Prisma, no Express.
 *
 * Key invariants:
 *  - Leading zeros survive: a number 123 with numFmt "0000000" → "0000123"
 *  - Long digit strings never become scientific notation
 *  - Rich text and formula results are read as their displayed text
 *  - Dates become YYYY-MM-DD
 *  - Quoted paste cells may contain the delimiter or embedded newlines
 */
import ExcelJS from 'exceljs';

// ── Cell normalisation ────────────────────────────────────────────────────────

/**
 * Normalise an ExcelJS cell value to a trimmed string, preserving leading
 * zeros and avoiding scientific notation for large integers.
 */
function cellToText(cell: ExcelJS.Cell): string {
  // ExcelJS numeric cell type constant (2). Using the named enum avoids a
  // runtime import of the full enum while keeping the comparison readable.
  const type = cell.type as number;
  const value = cell.value;

  if (value === null || value === undefined) return '';

  // ── Number ──────────────────────────────────────────────────────────────
  // ValueType.Number = 2
  if (type === 2) {
    const num = value as number;
    if (Number.isNaN(num)) return '';

    const numFmt: string = (cell.numFmt as string | undefined) ?? '';

    // Leading-zero format: numFmt is entirely "0" chars (e.g. "0000000")
    if (/^0+$/.test(numFmt)) {
      const width = numFmt.length;
      const abs = Math.round(Math.abs(num));
      const sign = num < 0 ? '-' : '';
      return sign + abs.toString().padStart(width, '0');
    }

    // Integer — avoid scientific notation for large values
    if (Number.isInteger(num)) {
      // toFixed(0) returns a decimal string without 'e+' notation
      return num < 0 ? num.toFixed(0) : num.toFixed(0);
    }

    return num.toString();
  }

  // ── Date ─────────────────────────────────────────────────────────────────
  // ValueType.Date = 4
  if (type === 4) {
    const d = value as Date;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  // ── Boolean ──────────────────────────────────────────────────────────────
  // ValueType.Boolean = 9
  if (type === 9) {
    return (value as boolean) ? 'TRUE' : 'FALSE';
  }

  // ── Rich Text ────────────────────────────────────────────────────────────
  // ValueType.RichText = 8
  if (type === 8) {
    const rt = value as { richText?: Array<{ text: string }> };
    return (rt.richText ?? []).map((r) => r.text).join('').trim();
  }

  // ── Formula ──────────────────────────────────────────────────────────────
  // ValueType.Formula = 6
  if (type === 6) {
    const f = value as { formula?: string; result?: unknown; sharedFormula?: string };
    const result = f.result;
    if (result === null || result === undefined) return '';
    if (typeof result === 'number') {
      return Number.isInteger(result) ? result.toFixed(0) : result.toString();
    }
    if (result instanceof Date) return result.toISOString().slice(0, 10);
    if (typeof result === 'boolean') return result ? 'TRUE' : 'FALSE';
    if (typeof result === 'string') return result.trim();
    // Error result object
    return '';
  }

  // ── Hyperlink ────────────────────────────────────────────────────────────
  // ValueType.Hyperlink = 5
  if (type === 5) {
    const h = value as { text?: string | { richText?: Array<{ text: string }> }; hyperlink?: string };
    if (typeof h.text === 'string') return h.text.trim();
    if (h.text && typeof h.text === 'object' && 'richText' in h.text) {
      return (h.text.richText ?? []).map((r) => r.text).join('').trim();
    }
    return '';
  }

  // ── String / SharedString ────────────────────────────────────────────────
  // ValueType.String = 3, SharedString = 7
  if (type === 3 || type === 7) {
    return (value as string).trim();
  }

  // ── Null / Merge / Error / unknown ───────────────────────────────────────
  return '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all worksheets in an XLSX workbook, with their row counts.
 * Only supports XLSX / XLS (magic-byte validated before this call).
 */
export async function listWorkbookSheets(
  buffer: Buffer,
): Promise<Array<{ name: string; rowCount: number }>> {
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error -- ExcelJS typings expect old Buffer without generic; Node.js ≥22 adds Buffer<ArrayBufferLike>
  await workbook.xlsx.load(buffer);
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
  }));
}

/**
 * Read every non-empty row of a worksheet as an array of trimmed strings.
 *
 * Row arrays may be ragged (different lengths). Trailing empty cells within
 * a row ARE included up to the last non-empty cell so column positions
 * remain stable across rows.
 */
export async function readSheetRows(buffer: Buffer, sheetName?: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error -- ExcelJS typings expect old Buffer without generic; Node.js ≥22 adds Buffer<ArrayBufferLike>
  await workbook.xlsx.load(buffer);

  let sheet: ExcelJS.Worksheet | undefined;
  if (sheetName) {
    sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found in workbook`);
    }
  } else {
    sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error('Workbook contains no worksheets');
    }
  }

  const rows: string[][] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToText(cell));
    });

    // Drop trailing empty cells while preserving internal empty cells
    let last = cells.length - 1;
    while (last >= 0 && cells[last] === '') last--;
    const trimmed = cells.slice(0, last + 1);

    if (trimmed.length > 0) {
      rows.push(trimmed);
    }
  });

  return rows;
}

// ── Delimited text parser ─────────────────────────────────────────────────────

/**
 * Detect which delimiter dominates a line of text.
 * Tabs win unconditionally; ties between comma and semicolon go to comma.
 */
function detectDelimiter(text: string): string {
  if (text.includes('\t')) return '\t';
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return commas >= semis ? ',' : ';';
}

/**
 * Parse a delimited string (Excel paste, CSV export) into a 2-D array of
 * trimmed strings.
 *
 * Rules:
 *  - Delimiter is auto-detected: tab → comma → semicolon
 *  - RFC-4180 quoting: a cell wrapped in `"…"` may contain the delimiter
 *    or literal newlines; `""` inside quotes is a literal `"`
 *  - Entirely blank rows are dropped
 */
export function parseDelimitedText(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  // Normalise line endings so we only deal with \n
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < normalised.length) {
    const ch = normalised[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Peek: doubled quote inside quotes → literal "
        if (normalised[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"' && cell.length === 0) {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\n') {
        row.push(cell.trim());
        if (row.some((c) => c.length > 0)) {
          rows.push(row);
        }
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }

    i++;
  }

  // Flush remaining data
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

// ── Header detection & column mapping ────────────────────────────────────────

/** Strip punctuation, collapse spaces, lowercase, remove trailing '*'. */
function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\*\s*$/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scan the first 20 rows and return the index of the first row that
 * contains at least two cells matching known header synonyms.
 * Returns 0 (assume row 0 is the header) when no match is found.
 *
 * @param rows      The full parsed row array.
 * @param synonyms  Map of canonical field name → list of accepted header texts.
 */
export function detectHeaderRow(
  rows: string[][],
  synonyms: Record<string, string[]>,
): number {
  const known = new Set(
    Object.values(synonyms)
      .flat()
      .map(normaliseHeader),
  );

  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const matches = row.filter((cell) => known.has(normaliseHeader(cell))).length;
    if (matches >= 2) return i;
  }

  return 0;
}

/**
 * Map canonical field names to 0-based column indices using fuzzy header
 * matching (case-insensitive, ignores punctuation / trailing '*').
 *
 * @param headers   The header row cells (0-based).
 * @param synonyms  Map of canonical field name → list of accepted header texts.
 * @returns         Record of field → column index (or null when not found).
 */
export function suggestColumnMapping(
  headers: string[],
  synonyms: Record<string, string[]>,
): Record<string, number | null> {
  const normHeaders = headers.map(normaliseHeader);
  const result: Record<string, number | null> = {};

  for (const [field, fieldSynonyms] of Object.entries(synonyms)) {
    const normSynonyms = fieldSynonyms.map(normaliseHeader);
    let found: number | null = null;

    for (let col = 0; col < normHeaders.length; col++) {
      if (normSynonyms.includes(normHeaders[col]!)) {
        found = col;
        break;
      }
    }

    result[field] = found;
  }

  return result;
}
