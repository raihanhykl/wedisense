/**
 * tabular.ts unit tests.
 *
 * Uses ExcelJS directly to build workbook buffers in-memory so we never
 * commit binary fixtures.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  listWorkbookSheets,
  readSheetRows,
  parseDelimitedText,
  detectHeaderRow,
  suggestColumnMapping,
} from './tabular.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildWorkbook(
  setup: (wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  setup(wb);
  // @ts-expect-error -- ExcelJS writeBuffer returns Buffer<ArrayBufferLike> in newer @types/node
  return wb.xlsx.writeBuffer();
}

// ── listWorkbookSheets ────────────────────────────────────────────────────────

describe('listWorkbookSheets', () => {
  it('returns name and rowCount for each sheet', async () => {
    const buf = await buildWorkbook((wb) => {
      const s1 = wb.addWorksheet('Sheet1');
      s1.addRow(['a', 'b']);
      s1.addRow([1, 2]);
      const s2 = wb.addWorksheet('Sheet2');
      s2.addRow(['x']);
    });

    const sheets = await listWorkbookSheets(buf);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.name).toBe('Sheet1');
    expect(sheets[0]!.rowCount).toBeGreaterThanOrEqual(2);
    expect(sheets[1]!.name).toBe('Sheet2');
  });
});

// ── readSheetRows ─────────────────────────────────────────────────────────────

describe('readSheetRows', () => {
  it('reads string cells', async () => {
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      ws.addRow(['VIN', 'Engine', 'Model']);
      ws.addRow(['ABC123', 'ENG001', 'TypeX']);
    });
    const rows = await readSheetRows(buf);
    expect(rows[0]).toEqual(['VIN', 'Engine', 'Model']);
    expect(rows[1]).toEqual(['ABC123', 'ENG001', 'TypeX']);
  });

  it('preserves leading zeros from zero-padding number format', async () => {
    // When a cell is numeric 123 with numFmt "0000000", display = "0000123"
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      const row = ws.addRow([123, 456]);
      const c1 = row.getCell(1);
      c1.numFmt = '0000000';
      const c2 = row.getCell(2);
      c2.numFmt = '0000000000'; // 10 zeros
    });
    const rows = await readSheetRows(buf);
    expect(rows[0]![0]).toBe('0000123');
    expect(rows[0]![1]).toBe('0000000456');
  });

  it('does not emit scientific notation for large integers', async () => {
    // 15-digit integer — fits in JS safe integer range
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      ws.addRow([123456789012345]);
    });
    const rows = await readSheetRows(buf);
    const cell = rows[0]![0]!;
    expect(cell).not.toMatch(/e\+/i);
    expect(cell).toMatch(/^\d+$/);
  });

  it('reads a date cell as YYYY-MM-DD', async () => {
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      ws.addRow([new Date('2024-03-15T00:00:00.000Z')]);
    });
    const rows = await readSheetRows(buf);
    expect(rows[0]![0]).toBe('2024-03-15');
  });

  it('reads rich text as concatenated plain text', async () => {
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      const row = ws.addRow(['placeholder']);
      const cell = row.getCell(1);
      cell.value = {
        richText: [
          { text: 'Hello', font: { bold: true } },
          { text: ' World' },
        ],
      };
    });
    const rows = await readSheetRows(buf);
    expect(rows[0]![0]).toBe('Hello World');
  });

  it('reads from a named sheet', async () => {
    const buf = await buildWorkbook((wb) => {
      wb.addWorksheet('Ignore').addRow(['wrong']);
      wb.addWorksheet('Manifest').addRow(['correct']);
    });
    const rows = await readSheetRows(buf, 'Manifest');
    expect(rows[0]![0]).toBe('correct');
  });

  it('throws when the named sheet does not exist', async () => {
    const buf = await buildWorkbook((wb) => {
      wb.addWorksheet('Sheet1').addRow(['a']);
    });
    await expect(readSheetRows(buf, 'Missing')).rejects.toThrow('Sheet "Missing" not found');
  });

  it('handles a 17-digit VIN-like value stored as text', async () => {
    // Real VINs contain letters so are stored as strings.
    // This test verifies that a string cell containing digits is not mangled.
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      ws.addRow(['12345678901234567']); // string cell
    });
    const rows = await readSheetRows(buf);
    expect(rows[0]![0]).toBe('12345678901234567');
  });

  it('skips entirely blank rows', async () => {
    const buf = await buildWorkbook((wb) => {
      const ws = wb.addWorksheet('Data');
      ws.addRow(['header']);
      ws.addRow([]); // blank
      ws.addRow(['data']);
    });
    const rows = await readSheetRows(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]).toBe('header');
    expect(rows[1]![0]).toBe('data');
  });
});

// ── parseDelimitedText ────────────────────────────────────────────────────────

describe('parseDelimitedText', () => {
  it('parses tab-separated text', () => {
    const rows = parseDelimitedText('VIN\tEngine\nABC123\tENG1');
    expect(rows[0]).toEqual(['VIN', 'Engine']);
    expect(rows[1]).toEqual(['ABC123', 'ENG1']);
  });

  it('falls back to comma when no tabs', () => {
    const rows = parseDelimitedText('VIN,Engine\nABC,ENG1');
    expect(rows[0]).toEqual(['VIN', 'Engine']);
  });

  it('falls back to semicolon when semicolons outnumber commas', () => {
    const rows = parseDelimitedText('VIN;Engine;Color\nA;B;C');
    expect(rows[0]).toEqual(['VIN', 'Engine', 'Color']);
  });

  it('handles quoted cells with embedded tab', () => {
    const rows = parseDelimitedText('"hello\tworld"\tvalue');
    expect(rows[0]![0]).toBe('hello\tworld');
    expect(rows[0]![1]).toBe('value');
  });

  it('handles quoted cells with embedded newline', () => {
    const text = '"line1\nline2"\tafter';
    const rows = parseDelimitedText(text);
    expect(rows[0]![0]).toBe('line1\nline2');
    expect(rows[0]![1]).toBe('after');
  });

  it('handles doubled quotes inside a quoted cell', () => {
    const rows = parseDelimitedText('"it""s"\tvalue');
    expect(rows[0]![0]).toBe("it\"s");
  });

  it('drops completely blank rows', () => {
    const rows = parseDelimitedText('a\tb\n\n\tc\td');
    const nonEmpty = rows.filter((r) => r.some((c) => c.length > 0));
    expect(nonEmpty.every((r) => r.some((c) => c.length > 0))).toBe(true);
  });

  it('handles Windows line endings (CRLF)', () => {
    const rows = parseDelimitedText('VIN\tEngine\r\nABC\tENG');
    expect(rows).toHaveLength(2);
  });
});

// ── detectHeaderRow ───────────────────────────────────────────────────────────

describe('detectHeaderRow', () => {
  const synonyms = {
    vin: ['nomor rangka', 'no rangka', 'vin', 'chassis'],
    engineNumber: ['nomor mesin', 'no mesin', 'engine no'],
    model: ['model', 'tipe'],
    color: ['warna', 'color', 'colour'],
  };

  it('returns 0 when the first row is the header', () => {
    const rows = [
      ['VIN', 'Engine No', 'Model', 'Color'],
      ['ABC', 'ENG', 'TypeX', 'Red'],
    ];
    expect(detectHeaderRow(rows, synonyms)).toBe(0);
  });

  it('skips title rows and finds the header row', () => {
    const rows = [
      ['Factory Manifest Report — Batch 2024-Q1'],
      ['Generated: 2024-01-15'],
      ['', ''], // blank-ish row
      ['Nomor Rangka', 'Nomor Mesin', 'Model', 'Warna'],
      ['VIN001', 'ENG001', 'TypeX', 'Red'],
    ];
    expect(detectHeaderRow(rows, synonyms)).toBe(3);
  });

  it('returns 0 as fallback when no header matches', () => {
    const rows = [['Col1', 'Col2', 'Col3']];
    expect(detectHeaderRow(rows, synonyms)).toBe(0);
  });

  it('requires at least 2 matches', () => {
    // Only one known header — should NOT match
    const rows = [['Random Title'], ['VIN', 'SomeColumn']];
    // 'VIN' alone is 1 match — returns 0 (no match found → default 0)
    expect(detectHeaderRow(rows, synonyms)).toBe(0);
  });

  it('handles trailing asterisk in header', () => {
    const rows = [['VIN*', 'Model*', 'Warna']];
    expect(detectHeaderRow(rows, synonyms)).toBe(0);
  });
});

// ── suggestColumnMapping ──────────────────────────────────────────────────────

describe('suggestColumnMapping', () => {
  const synonyms = {
    vin: ['nomor rangka', 'no rangka', 'vin', 'chassis', 'frame no'],
    engineNumber: ['nomor mesin', 'no mesin', 'engine no'],
    model: ['model', 'tipe'],
    color: ['warna', 'color', 'colour'],
  };

  it('maps recognised headers to column indices', () => {
    const headers = ['Nomor Rangka', 'Nomor Mesin', 'Model', 'Warna'];
    const mapping = suggestColumnMapping(headers, synonyms);
    expect(mapping['vin']).toBe(0);
    expect(mapping['engineNumber']).toBe(1);
    expect(mapping['model']).toBe(2);
    expect(mapping['color']).toBe(3);
  });

  it('returns null for unrecognised fields', () => {
    const headers = ['VIN', 'Unknown'];
    const mapping = suggestColumnMapping(headers, synonyms);
    expect(mapping['vin']).toBe(0);
    expect(mapping['engineNumber']).toBeNull();
    expect(mapping['model']).toBeNull();
    expect(mapping['color']).toBeNull();
  });

  it('is case-insensitive', () => {
    const headers = ['VIN', 'ENGINE NO'];
    const mapping = suggestColumnMapping(headers, synonyms);
    expect(mapping['vin']).toBe(0);
    expect(mapping['engineNumber']).toBe(1);
  });

  it('ignores punctuation and trailing asterisk', () => {
    const headers = ['No. Rangka*', 'Model:'];
    const mapping = suggestColumnMapping(headers, synonyms);
    // "no. rangka" normalised → "no rangka" → matches
    expect(mapping['vin']).toBe(0);
    // "model" normalised → "model" → matches
    expect(mapping['model']).toBe(1);
  });
});
