import { describe, it, expect, vi } from 'vitest';
import {
  formatHandoverFormNumber,
  generateHandoverFormNumber,
  DOCUMENT_TYPE_BAST,
} from './document-number.js';

const OPTS = { divisionCode: 'IT', documentCode: 'WDS', date: new Date(2026, 7, 12) };

describe('formatHandoverFormNumber()', () => {
  it('renders the Indonesian letter shape', () => {
    expect(formatHandoverFormNumber(1, OPTS)).toBe('001/BAST-IT/WDS/VIII/2026');
  });

  it('pads the sequence to three digits', () => {
    expect(formatHandoverFormNumber(7, OPTS)).toBe('007/BAST-IT/WDS/VIII/2026');
    expect(formatHandoverFormNumber(42, OPTS)).toBe('042/BAST-IT/WDS/VIII/2026');
    expect(formatHandoverFormNumber(999, OPTS)).toBe('999/BAST-IT/WDS/VIII/2026');
  });

  it('does not truncate a sequence that outgrows three digits', () => {
    // Padding is a minimum width, not a cap — the 1000th form of the year
    // must still get a unique, well-formed number rather than wrapping.
    expect(formatHandoverFormNumber(1000, OPTS)).toBe('1000/BAST-IT/WDS/VIII/2026');
  });

  it('maps every month to the correct Roman numeral', () => {
    const expected = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    for (let month = 0; month < 12; month++) {
      const number = formatHandoverFormNumber(1, { ...OPTS, date: new Date(2026, month, 15) });
      expect(number).toBe(`001/BAST-IT/WDS/${expected[month]}/2026`);
    }
  });

  it('takes the year from the supplied date, not the clock', () => {
    expect(formatHandoverFormNumber(3, { ...OPTS, date: new Date(2031, 0, 1) })).toBe(
      '003/BAST-IT/WDS/I/2031',
    );
  });

  it('reflects division and company codes from company settings', () => {
    expect(
      formatHandoverFormNumber(1, { divisionCode: 'HRD', documentCode: 'WDI', date: OPTS.date }),
    ).toBe('001/BAST-HRD/WDI/VIII/2026');
  });

  it('throws rather than emitting "undefined" into a document number', () => {
    expect(() => formatHandoverFormNumber(1, { ...OPTS, date: new Date('nope') })).toThrow(
      /invalid date/i,
    );
  });
});

describe('generateHandoverFormNumber()', () => {
  function makeTx(sequence: number) {
    return { $queryRaw: vi.fn().mockResolvedValue([{ current_sequence: sequence }]) };
  }

  it('formats the sequence returned by the UPSERT', async () => {
    const tx = makeTx(5);
    const result = await generateHandoverFormNumber(
      tx as unknown as Parameters<typeof generateHandoverFormNumber>[0],
      OPTS,
    );
    expect(result).toBe('005/BAST-IT/WDS/VIII/2026');
  });

  it('buckets the sequence by the date year and BAST document type', async () => {
    const tx = makeTx(1);
    await generateHandoverFormNumber(
      tx as unknown as Parameters<typeof generateHandoverFormNumber>[0],
      OPTS,
    );
    // Tagged-template call: (strings, ...values) — values carry the bindings.
    const values = tx.$queryRaw.mock.calls[0]!.slice(1);
    expect(values).toContain(DOCUMENT_TYPE_BAST);
    expect(values).toContain(2026);
  });

  it('throws when the UPSERT returns no row', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(
      generateHandoverFormNumber(
        tx as unknown as Parameters<typeof generateHandoverFormNumber>[0],
        OPTS,
      ),
    ).rejects.toThrow(/returned no row/i);
  });

  it('refuses an invalid date before touching the database', async () => {
    const tx = makeTx(1);
    await expect(
      generateHandoverFormNumber(
        tx as unknown as Parameters<typeof generateHandoverFormNumber>[0],
        { ...OPTS, date: new Date('nope') },
      ),
    ).rejects.toThrow(/invalid date/i);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
