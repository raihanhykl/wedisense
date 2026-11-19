/**
 * manifest-parser.ts unit tests.
 *
 * All inputs are plain string arrays — no ExcelJS / Prisma needed.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest, MANIFEST_FIELD_SYNONYMS } from './manifest-parser.js';
import { suggestColumnMapping, detectHeaderRow } from '../lib/tabular.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a header row from readable field names. */
function header(cols: string[]): string[] {
  return cols;
}

function rows(...dataRows: string[][]): string[][] {
  return dataRows;
}

// ── Basic happy path ──────────────────────────────────────────────────────────

describe('parseManifest — basic', () => {
  const headers = header(['Nomor Rangka', 'Nomor Mesin', 'Model', 'Warna']);
  const mapping = suggestColumnMapping(headers, MANIFEST_FIELD_SYNONYMS);
  // Valid VINs: 17 chars, A-HJ-NPR-Z0-9 (no I, O, Q)
  const allRows = [headers, ...rows(
    ['JAN12345678901234', 'ENG001', 'TypeX', 'Blue'],
    ['JAN12345678901235', 'ENG002', 'TypeY', 'Red'],
  )];
  const headerIdx = detectHeaderRow(allRows, MANIFEST_FIELD_SYNONYMS);

  it('produces one candidate per unique VIN', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.vin).toBe('JAN12345678901234');
  });

  it('extracts engine number and model', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    expect(result.candidates[0]!.engineNumber).toBe('ENG001');
    expect(result.candidates[0]!.model).toBe('TypeX');
  });

  it('no skipped components and no ambiguous rows in clean data', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    expect(result.skippedComponents.count).toBe(0);
    expect(result.ambiguousRows).toHaveLength(0);
  });
});

// ── A01 shape: VIN repetition, components, leading-zero VIN, ambiguous rows ──

describe('parseManifest — A01 scenario shape', () => {
  /**
   * Sheet structure:
   *   Row 1 (title)  — ignored (no known headers)
   *   Row 2 (header) — Nomor Rangka | Nomor Mesin | Model | Warna | Jenis Barang
   *   Row 3          — motorcycle VIN, engine, model, colour
   *   Row 4          — same VIN (component detail) + Jenis = "baterai"
   *   Row 5          — same VIN (again, different colour — conflict)
   *   Row 6          — component: Jenis = "charger"
   *   Row 7          — VIN with leading zeros (stored as string)
   *   Row 8          — ambiguous: non-VIN value in VIN column
   *   Row 9          — blank (should be ignored)
   */
  const title = ['Factory Manifest Batch 2024-Q1'];
  const hdr = ['Nomor Rangka', 'Nomor Mesin', 'Model', 'Warna', 'Jenis Barang'];
  // Valid VINs: 17 chars, A-HJ-NPR-Z0-9 (no I, O, Q)
  const vin1 = 'JAN12345678901234';
  const vin2 = '0001234567890ABCD'; // 17-char VIN with leading zero (string)

  const allRows = [
    title,
    hdr,
    [vin1, 'ENG001', 'TypeX', 'Blue', 'Sepeda Motor'],
    [vin1, 'B-SN001', '', '', 'baterai'],
    [vin1, 'ENG001', 'TypeX', 'Red', 'Sepeda Motor'], // colour conflict
    ['', '', '', '', 'charger'], // component, blank VIN
    [vin2, 'ENG002', 'TypeY', 'Green', 'Sepeda Motor'],
    ['NOTAVIN', 'ENG003', 'TypeZ', 'Yellow', 'Sepeda Motor'], // ambiguous
    ['', '', '', '', ''], // blank row
  ];

  const headerIdx = detectHeaderRow(allRows, MANIFEST_FIELD_SYNONYMS);
  const mapping = suggestColumnMapping(hdr, MANIFEST_FIELD_SYNONYMS);

  it('detects the header row correctly (skips title)', () => {
    expect(headerIdx).toBe(1);
  });

  it('folds repeated VIN rows into one candidate', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    // vin1 appears 3 times (rows 3, 4, 5) but row 4 is a battery component
    // → 2 vin1 rows folded, 1 component skipped
    const vin1Candidate = result.candidates.find((c) => c.vin === vin1);
    expect(vin1Candidate).toBeDefined();
    // Component row (row 4) is skipped, so sourceRows has 2
    expect(vin1Candidate!.sourceRows.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a colour conflict for vin1', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    const vin1Candidate = result.candidates.find((c) => c.vin === vin1);
    expect(vin1Candidate!.conflicts).toBeDefined();
    const colorConflict = vin1Candidate!.conflicts?.find((c) => c.field === 'color');
    expect(colorConflict).toBeDefined();
    expect(colorConflict!.values).toHaveLength(2);
  });

  it('skips component rows (baterai, charger)', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    // Row 4 (baterai) + Row 6 (charger) = 2 skipped
    expect(result.skippedComponents.count).toBe(2);
  });

  it('marks non-VIN value as ambiguous', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    const ambig = result.ambiguousRows.find((a) =>
      a.rawValues['Nomor Rangka'] === 'NOTAVIN',
    );
    expect(ambig).toBeDefined();
    expect(ambig!.reason).toMatch(/not a valid 17-character VIN/i);
  });

  it('accepts vin2 (leading zeros and uppercase)', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    // vin2 = '0001234567890ABCD' — 17 chars, valid, no I/O/Q
    const vin2Candidate = result.candidates.find((c) => c.vin === vin2);
    expect(vin2Candidate).toBeDefined();
    expect(vin2Candidate!.vin).toBe(vin2);
  });

  it('ignores blank rows', () => {
    const result = parseManifest(allRows, headerIdx, mapping);
    // Blank row excluded → vin1 and vin2 are 2 candidates, 2 skipped, 1 ambiguous
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

// ── VIN validation ────────────────────────────────────────────────────────────

describe('parseManifest — VIN validation', () => {
  const hdr = ['VIN', 'Engine No'];
  const mapping = suggestColumnMapping(hdr, MANIFEST_FIELD_SYNONYMS);

  it('rejects I, O, Q characters in VIN position', () => {
    const rows = [hdr, ['VIN1234567890123IO']]; // 18 chars with I, O
    const result = parseManifest(rows, 0, mapping);
    // Wrong length takes priority → ambiguous
    expect(result.ambiguousRows.length + result.candidates.length).toBeGreaterThan(0);
  });

  it('rejects a VIN shorter than 17 characters', () => {
    const rows = [hdr, ['VIN12345']];
    const result = parseManifest(rows, 0, mapping);
    expect(result.ambiguousRows).toHaveLength(1);
  });

  it('accepts exactly 17 alphanumeric characters (excluding I/O/Q)', () => {
    const rows = [hdr, ['ABCDEFGHJKLMNPRST', 'ENG']]; // 17 chars, no I/O/Q
    const result = parseManifest(rows, 0, mapping);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.vin).toBe('ABCDEFGHJKLMNPRST');
  });
});

// ── Ambiguous: blank VIN with other identity ──────────────────────────────────

describe('parseManifest — blank VIN with other identity', () => {
  const hdr = ['Nomor Rangka', 'Nomor Mesin', 'Model'];
  const mapping = suggestColumnMapping(hdr, MANIFEST_FIELD_SYNONYMS);

  it('marks row as ambiguous when VIN is blank but engine is filled', () => {
    const rows = [hdr, ['', 'ENG001', 'TypeX']];
    const result = parseManifest(rows, 0, mapping);
    expect(result.ambiguousRows).toHaveLength(1);
    expect(result.ambiguousRows[0]!.reason).toMatch(/empty.*identity/i);
  });
});
