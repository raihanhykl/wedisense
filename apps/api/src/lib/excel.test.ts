import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { detectColumnMapping } from './excel.js';

// ── Helpers ───────────────────────────────────────────────────────────
// Build a single-sheet workbook with the given header row, returning the
// worksheet so each test can call detectColumnMapping directly.

function buildSheet(headers: string[]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Assets Import');
  // ExcelJS row.values: element at array index N goes to worksheet column
  // N+1 (so the first element lands in column 1 / 'A').
  ws.getRow(1).values = headers;
  return ws;
}

describe('detectColumnMapping()', () => {
  // ── Exact match (the template's own headers) ─────────────────────
  it('matches every template column when headers are exact', () => {
    const ws = buildSheet([
      'Product*',
      'Name*',
      'Location*',
      'Serial Number',
      'Status',
    ]);

    const result = detectColumnMapping(ws);

    expect(result.mapping['productId']?.source).toBe('exact');
    expect(result.mapping['name']?.source).toBe('exact');
    expect(result.mapping['locationId']?.source).toBe('exact');
    expect(result.mapping['serialNumber']?.source).toBe('exact');
    expect(result.mapping['status']?.source).toBe('exact');
    expect(result.requiredMissing).toEqual([]);
  });

  // ── Synonym match ─────────────────────────────────────────────────
  it('falls back to synonym match when the user used a near-synonym', () => {
    const ws = buildSheet([
      'Produk', // Indonesian for productId
      'Asset Name', // synonym for name
      'Lokasi', // Indonesian for locationId
      'S/N', // synonym for serialNumber
    ]);

    const result = detectColumnMapping(ws);

    expect(result.mapping['productId']?.source).toBe('synonym');
    expect(result.mapping['productId']?.actualHeader).toBe('Produk');
    expect(result.mapping['name']?.source).toBe('synonym');
    expect(result.mapping['name']?.actualHeader).toBe('Asset Name');
    expect(result.mapping['locationId']?.source).toBe('synonym');
    expect(result.mapping['serialNumber']?.source).toBe('synonym');
    expect(result.mapping['serialNumber']?.actualHeader).toBe('S/N');
    expect(result.requiredMissing).toEqual([]);
  });

  // ── Mixed match: exact + synonym in the same file ────────────────
  it('combines exact and synonym matches in one pass', () => {
    const ws = buildSheet([
      'Product*', // exact
      'Asset Name', // synonym
      'Location*', // exact
    ]);

    const result = detectColumnMapping(ws);

    expect(result.mapping['productId']?.source).toBe('exact');
    expect(result.mapping['name']?.source).toBe('synonym');
    expect(result.mapping['locationId']?.source).toBe('exact');
  });

  // ── Required column missing ───────────────────────────────────────
  it('reports the canonical key in requiredMissing when no header maps to it', () => {
    const ws = buildSheet([
      'Name*',
      'Location*',
      // No product column at all
    ]);

    const result = detectColumnMapping(ws);

    expect(result.mapping['productId']).toBeUndefined();
    expect(result.requiredMissing).toContain('productId');
    expect(result.requiredMissing).not.toContain('name');
    expect(result.requiredMissing).not.toContain('locationId');
  });

  // ── Manual override (by column number) ────────────────────────────
  it('honours a manual override given as a column number', () => {
    const ws = buildSheet([
      'Mystery Column A', // column 1
      'Mystery Column B', // column 2
      'Mystery Column C', // column 3
    ]);

    const result = detectColumnMapping(ws, {
      productId: 1,
      name: 2,
      locationId: 3,
    });

    expect(result.mapping['productId']?.source).toBe('manual');
    expect(result.mapping['productId']?.actualHeader).toBe('Mystery Column A');
    expect(result.mapping['name']?.actualHeader).toBe('Mystery Column B');
    expect(result.mapping['locationId']?.actualHeader).toBe('Mystery Column C');
  });

  // ── Manual override (by header text) ─────────────────────────────
  it('honours a manual override given as a header string', () => {
    const ws = buildSheet([
      'Nomor Aset', // not a synonym we recognise; the user picks it manually
      'Lokasi',
      'Produk',
    ]);

    const result = detectColumnMapping(ws, {
      name: 'Nomor Aset',
      productId: 'Produk',
    });

    expect(result.mapping['name']?.source).toBe('manual');
    expect(result.mapping['name']?.actualHeader).toBe('Nomor Aset');
    expect(result.mapping['productId']?.source).toBe('manual');
    // locationId wasn't in the override — it should fall through to synonym
    // match (Lokasi → locationId).
    expect(result.mapping['locationId']?.source).toBe('synonym');
  });

  // ── Manual override beats both exact and synonym ─────────────────
  it('prefers manual override over exact and synonym auto-detection', () => {
    const ws = buildSheet([
      'Name*', // would normally exact-match name
      'Custom Asset Label', // user explicitly chose this column for name
    ]);

    const result = detectColumnMapping(ws, {
      name: 2, // column 2, the "Custom Asset Label" header
    });

    expect(result.mapping['name']?.actualHeader).toBe('Custom Asset Label');
    expect(result.mapping['name']?.source).toBe('manual');
  });

  // ── Headers list ──────────────────────────────────────────────────
  it('returns all non-empty headers in column order via the `headers` array', () => {
    const ws = buildSheet(['Alpha', 'Beta', 'Gamma']);

    const result = detectColumnMapping(ws);

    expect(result.headers).toHaveLength(3);
    expect(result.headers.map((h) => h.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(result.headers[0]?.columnNumber).toBe(1);
    expect(result.headers[2]?.columnNumber).toBe(3);
  });

  // ── Case + whitespace + asterisk insensitivity ───────────────────
  it('matches headers regardless of case, surrounding whitespace, or the required-marker asterisk', () => {
    const ws = buildSheet([
      '  PRODUCT  ', // bunch of cosmetic differences vs "Product*"
      'name*',
      'LOCATION',
    ]);

    const result = detectColumnMapping(ws);

    expect(result.mapping['productId']?.source).toBe('exact');
    expect(result.mapping['name']?.source).toBe('exact');
    expect(result.mapping['locationId']?.source).toBe('exact');
  });

  // ── Empty override values are ignored ────────────────────────────
  it('ignores empty-string overrides and falls through to auto-detection', () => {
    const ws = buildSheet(['Product*', 'Name*', 'Location*']);

    const result = detectColumnMapping(ws, {
      productId: '', // empty — should be skipped
    });

    expect(result.mapping['productId']?.source).toBe('exact');
  });

  // ── Override pointing at a non-existent column is ignored ────────
  it('ignores overrides that reference a column not present in the sheet', () => {
    const ws = buildSheet(['Product*', 'Name*', 'Location*']);

    const result = detectColumnMapping(ws, {
      productId: 99, // out of range
    });

    // Should fall through to exact match, not get stuck unmapped.
    expect(result.mapping['productId']?.source).toBe('exact');
  });

  // ── Underscore/hyphen normalisation ──────────────────────────────
  it('treats underscores and hyphens as whitespace when comparing headers', () => {
    const ws = buildSheet([
      'serial_number',
      'warranty-end-date',
      'purchase_date',
    ]);

    const result = detectColumnMapping(ws);

    expect(result.mapping['serialNumber']?.source).toBe('exact');
    expect(result.mapping['warrantyEndDate']?.source).toBe('exact');
    expect(result.mapping['purchaseDate']?.source).toBe('exact');
  });
});
