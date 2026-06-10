import ExcelJS from 'exceljs';
import type { LocationType } from '@prisma/client';

/**
 * Template / parser for the Location bulk-import sheet.
 *
 * Kept small on purpose:
 *   - Fixed column order (no mapping UI). The template names the columns and
 *     users fill them in.
 *   - Sync-only validation. Sheets won't realistically exceed a few hundred
 *     locations for an internal AMS, so the async/BullMQ path the Asset
 *     import uses is overkill here.
 *   - parent_code resolution (not parent_name) — codes are unique by schema,
 *     so we never hit the "ambiguous parent" problem.
 */

export const LOCATION_IMPORT_COLUMNS = [
  { header: 'Name*', key: 'name', width: 30 },
  { header: 'Code*', key: 'code', width: 18 },
  { header: 'Type*', key: 'type', width: 18 },
  { header: 'Parent Code', key: 'parentCode', width: 18 },
  { header: 'Address', key: 'address', width: 35 },
  { header: 'City', key: 'city', width: 18 },
  { header: 'Province', key: 'province', width: 18 },
  { header: 'Is Active', key: 'isActive', width: 12 },
] as const;

export const LOCATION_TYPE_VALUES = [
  'HEAD_OFFICE',
  'BRANCH',
  'FACTORY',
  'SHOWROOM',
  'SERVICE_CENTER',
  'OTHER',
] as const satisfies readonly LocationType[];

export interface LocationImportRow {
  rowIndex: number;
  name: string;
  code: string;
  type: LocationType;
  parentCode: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  isActive: boolean;
}

export interface ImportParseError {
  rowIndex: number;
  field: string;
  message: string;
  value?: unknown;
}

export interface ParseResult {
  rows: LocationImportRow[];
  errors: ImportParseError[];
}

// ── Template builder ─────────────────────────────────────────────────

export async function buildLocationImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wedisense AMS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Locations', {
    properties: { defaultColWidth: 20 },
  });

  // Header row
  ws.columns = LOCATION_IMPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };

  // Two example rows — one root, one nested — so users see how parent_code
  // wires children to parents in the same sheet.
  ws.addRow({
    name: 'Head Office Jakarta',
    code: 'HO-JKT',
    type: 'HEAD_OFFICE',
    parentCode: '',
    address: 'Jl. Jenderal Sudirman No. 1',
    city: 'Jakarta',
    province: 'DKI Jakarta',
    isActive: 'TRUE',
  });
  ws.addRow({
    name: 'Lantai 1',
    code: 'HO-JKT-L1',
    type: 'OTHER',
    parentCode: 'HO-JKT',
    address: '',
    city: 'Jakarta',
    province: 'DKI Jakarta',
    isActive: 'TRUE',
  });

  // Help sheet — keep instructions in the workbook itself so users don't
  // need an external doc to fill the template correctly.
  const help = wb.addWorksheet('Instructions');
  help.columns = [
    { header: 'Field', key: 'field', width: 18 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Notes', key: 'notes', width: 80 },
  ];
  help.getRow(1).font = { bold: true };
  const instructions: Array<[string, string, string]> = [
    ['Name', 'Yes', 'Display name. Max 255 characters.'],
    ['Code', 'Yes', 'Unique across all locations. Max 50 characters.'],
    [
      'Type',
      'Yes',
      `One of: ${LOCATION_TYPE_VALUES.join(', ')}. Case-sensitive.`,
    ],
    [
      'Parent Code',
      'No',
      'Leave blank for top-level. Otherwise must match the Code of an existing location OR another row in this sheet.',
    ],
    ['Address', 'No', 'Free text. Max 500 characters.'],
    ['City', 'No', 'Free text. Max 100 characters.'],
    ['Province', 'No', 'Free text. Max 100 characters.'],
    ['Is Active', 'No', 'TRUE or FALSE (default TRUE).'],
  ];
  for (const [field, required, notes] of instructions) {
    help.addRow({ field, required, notes });
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  return buf;
}

// ── Parser + validator ───────────────────────────────────────────────

/**
 * Parse + validate a Location import sheet. Returns each parsed row with its
 * 1-based rowIndex (matches Excel UI), and a separate errors list. The
 * service is expected to refuse the entire import if errors.length > 0 OR
 * apply rows individually (we surface partial success at the service layer).
 *
 * Field validations only — natural-key resolution (parent_code lookup,
 * duplicate-code check against DB) happens in the service layer.
 */
export async function parseLocationImportSheet(
  buffer: Buffer,
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  // First worksheet by index — be tolerant of users renaming "Locations".
  const ws = wb.worksheets[0];
  const rows: LocationImportRow[] = [];
  const errors: ImportParseError[] = [];

  if (!ws) {
    errors.push({ rowIndex: 0, field: '', message: 'Workbook has no worksheets' });
    return { rows, errors };
  }

  // Read header row to confirm the columns match what we expect. We don't
  // require exact match — just need to find each known column by header.
  const headerRow = ws.getRow(1);
  const headerToCol = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    const text = cellString(cell);
    if (text) headerToCol.set(normaliseHeader(text), colNum);
  });

  function colFor(key: string): number | undefined {
    const match = LOCATION_IMPORT_COLUMNS.find((c) => c.key === key);
    if (!match) return undefined;
    return headerToCol.get(normaliseHeader(match.header));
  }

  const colName = colFor('name');
  const colCode = colFor('code');
  const colType = colFor('type');
  if (!colName || !colCode || !colType) {
    errors.push({
      rowIndex: 1,
      field: '',
      message:
        'Required columns missing. The sheet must contain Name*, Code*, and Type* headers.',
    });
    return { rows, errors };
  }
  const colParent = colFor('parentCode');
  const colAddress = colFor('address');
  const colCity = colFor('city');
  const colProvince = colFor('province');
  const colActive = colFor('isActive');

  // Data rows start at row 2. eachRow honours the workbook's row count but
  // also skips blank rows — we still range-check defensively.
  const lastRow = ws.actualRowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (!row || row.actualCellCount === 0) continue;

    const name = cellString(row.getCell(colName));
    const code = cellString(row.getCell(colCode));
    const typeRaw = cellString(row.getCell(colType));
    const parentCode = colParent ? cellString(row.getCell(colParent)) : '';
    const address = colAddress ? cellString(row.getCell(colAddress)) : '';
    const city = colCity ? cellString(row.getCell(colCity)) : '';
    const province = colProvince ? cellString(row.getCell(colProvince)) : '';
    const activeRaw = colActive ? cellString(row.getCell(colActive)) : '';

    // Skip fully-blank rows silently (common when users delete contents but
    // leave the row in the file).
    if (!name && !code && !typeRaw) continue;

    const rowErrors: ImportParseError[] = [];

    if (!name) rowErrors.push({ rowIndex: r, field: 'name', message: 'Name is required' });
    if (name.length > 255)
      rowErrors.push({ rowIndex: r, field: 'name', message: 'Name exceeds 255 characters' });
    if (!code) rowErrors.push({ rowIndex: r, field: 'code', message: 'Code is required' });
    if (code.length > 50)
      rowErrors.push({ rowIndex: r, field: 'code', message: 'Code exceeds 50 characters' });
    if (!typeRaw) {
      rowErrors.push({ rowIndex: r, field: 'type', message: 'Type is required' });
    } else if (!LOCATION_TYPE_VALUES.includes(typeRaw.toUpperCase() as LocationType)) {
      rowErrors.push({
        rowIndex: r,
        field: 'type',
        message: `Type must be one of: ${LOCATION_TYPE_VALUES.join(', ')}`,
        value: typeRaw,
      });
    }
    if (address.length > 500)
      rowErrors.push({ rowIndex: r, field: 'address', message: 'Address exceeds 500 chars' });
    if (city.length > 100)
      rowErrors.push({ rowIndex: r, field: 'city', message: 'City exceeds 100 chars' });
    if (province.length > 100)
      rowErrors.push({
        rowIndex: r,
        field: 'province',
        message: 'Province exceeds 100 chars',
      });

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      rowIndex: r,
      name,
      code,
      type: typeRaw.toUpperCase() as LocationType,
      parentCode: parentCode || null,
      address: address || null,
      city: city || null,
      province: province || null,
      isActive: parseBoolean(activeRaw, true),
    });
  }

  // Cross-row uniqueness: same code can't appear twice in the sheet.
  const seenCodes = new Map<string, number>();
  for (const r of rows) {
    const prev = seenCodes.get(r.code);
    if (prev !== undefined) {
      errors.push({
        rowIndex: r.rowIndex,
        field: 'code',
        message: `Duplicate code "${r.code}" — also on row ${prev}`,
      });
    } else {
      seenCodes.set(r.code, r.rowIndex);
    }
  }

  return { rows, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────

function normaliseHeader(s: string): string {
  return s.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cellString(cell: ExcelJS.Cell): string {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  // ExcelJS returns objects for rich text, formulas, hyperlinks.
  if (typeof v === 'object') {
    // Rich text: { richText: [...] } — ExcelJS resolves its .text property
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    // Formula cell: extract result, which is a primitive or CellErrorValue
    if ('result' in v && v.result != null) {
      const r = v.result;
      if (typeof r === 'object') {
        // CellErrorValue: { error: '#N/A' | '#REF!' | ... }
        return 'error' in r ? String(r.error) : '';
      }
      // r is number | string | boolean | Date
      return String(r).trim();
    }
    // Hyperlink: { text: string, hyperlink: string } — already handled above,
    // but as a final fallback for any other object shape return empty string.
    return '';
  }
  return String(v).trim();
}

function parseBoolean(s: string, defaultValue: boolean): boolean {
  if (!s) return defaultValue;
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'y') return true;
  if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'n') return false;
  return defaultValue;
}
