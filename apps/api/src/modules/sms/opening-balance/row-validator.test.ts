/**
 * Tests for the pure opening-balance row validator.
 *
 * No Prisma, no Express. All test data is built in-memory.
 */
import { describe, it, expect } from 'vitest';
import { validateRow, parseState } from './row-validator.js';
import type { RawObRow, LookupMaps, ValidateRowOptions } from './row-validator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SHOWROOM_ID = 'showroom-jkt-01';
const SHOWROOM_ID_2 = 'showroom-bdg-01';
const VARIANT_ID = 'variant-uuid-1';
const USER_ID = 'user-uuid-1';

const MAPS: LookupMaps = {
  variants: [
    { id: VARIANT_ID, name: 'Standard', color: 'Merah', model: { code: 'MDX', name: 'Model X' } },
  ],
  users: [
    { id: USER_ID, name: 'Ahmad Salesman', employeeId: 'EMP001' },
  ],
  showrooms: [
    { id: SHOWROOM_ID, code: 'JKT-01', name: 'Jakarta Showroom' },
    { id: SHOWROOM_ID_2, code: 'BDG-01', name: 'Bandung Showroom' },
  ],
  existingVins: new Set(),
  existingSpkKeys: new Set(),
  existingContractNumbers: new Set(),
};

const BALANCE_DATE = '2025-11-01';

function makeOptions(overrides?: Partial<ValidateRowOptions>): ValidateRowOptions {
  return {
    defaultShowroomId: SHOWROOM_ID,
    balanceDate: BALANCE_DATE,
    seenVinsInFile: new Set<string>(),
    seenSpkKeysInFile: new Set<string>(),
    seenContractNumbersInFile: new Set<string>(),
    ...overrides,
  };
}

function makeRaw(overrides: Partial<RawObRow> = {}): RawObRow {
  return {
    row: 2,
    vin: 'MH1JFB118NK000001',
    engineNumber: '',
    licensePlate: '',
    model: 'Model X',
    variant: 'Standard',
    color: 'Merah',
    state: 'siap',
    showroom: '',
    notes: '',
    spkNumber: '',
    customerName: '',
    customerPhone: '',
    sales: '',
    contractNumber: '',
    contractStartDate: '',
    eventName: '',
    eventLocation: '',
    expectedReturnDate: '',
    pic: '',
    heldAtShowroom: '',
    ...overrides,
  };
}

// ── parseState ────────────────────────────────────────────────────────────────

describe('parseState', () => {
  it.each([
    ['siap', 'AVAILABLE'],
    ['ready', 'AVAILABLE'],
    ['available', 'AVAILABLE'],
    ['AVAILABLE', 'AVAILABLE'],
    ['booking', 'BOOKED'],
    ['Booked', 'BOOKED'],
    ['terjual', 'SOLD_PENDING_PICKUP'],
    ['sold', 'SOLD_PENDING_PICKUP'],
    ['terjual belum diambil', 'SOLD_PENDING_PICKUP'],
    ['sold pending pickup', 'SOLD_PENDING_PICKUP'],
    ['rto', 'ACTIVE_RTO'],
    ['rto aktif', 'ACTIVE_RTO'],
    ['active rto', 'ACTIVE_RTO'],
    ['inspeksi', 'INSPECTION'],
    ['inspection', 'INSPECTION'],
    ['show unit', 'SHOW_UNIT'],
    ['pameran', 'SHOW_UNIT'],
    ['custody', 'CUSTODY'],
    ['titipan', 'CUSTODY'],
  ])('parses "%s" as %s', (input, expected) => {
    expect(parseState(input)).toBe(expected);
  });

  it('returns null for unknown state', () => {
    expect(parseState('unknown_state')).toBeNull();
    expect(parseState('')).toBeNull();
    expect(parseState('sold off')).toBeNull();
  });
});

// ── AVAILABLE ─────────────────────────────────────────────────────────────────

describe('validateRow – AVAILABLE', () => {
  it('validates a valid AVAILABLE row', () => {
    const result = validateRow(makeRaw(), MAPS, makeOptions());
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('AVAILABLE');
    expect(result.vin).toBe('MH1JFB118NK000001');
    expect(result.variantId).toBe(VARIANT_ID);
    expect(result.showroomId).toBe(SHOWROOM_ID);
  });

  it('errors when VIN is missing', () => {
    const result = validateRow(makeRaw({ vin: '' }), MAPS, makeOptions());
    const vinError = result.errors.find((e) => e.field === 'vin');
    expect(vinError).toBeTruthy();
  });

  it('errors when state is missing', () => {
    const result = validateRow(makeRaw({ state: '' }), MAPS, makeOptions());
    const stateError = result.errors.find((e) => e.field === 'state');
    expect(stateError).toBeTruthy();
  });

  it('errors on unknown state', () => {
    const result = validateRow(makeRaw({ state: 'xyz_unknown' }), MAPS, makeOptions());
    const stateError = result.errors.find((e) => e.field === 'state');
    expect(stateError).toBeTruthy();
    expect(stateError?.message).toMatch(/Unknown state/);
  });

  it('warns when variant cannot be matched', () => {
    const result = validateRow(makeRaw({ model: 'Unknown', variant: 'Unknown', color: 'Pink' }), MAPS, makeOptions());
    const variantWarning = result.warnings.find((w) => w.field === 'variant');
    expect(variantWarning).toBeTruthy();
    expect(result.variantId).toBeNull();
  });

  it('errors when VIN already exists in DB', () => {
    const mapsWithVin: LookupMaps = { ...MAPS, existingVins: new Set(['MH1JFB118NK000001']) };
    const result = validateRow(makeRaw(), mapsWithVin, makeOptions());
    const vinError = result.errors.find((e) => e.field === 'vin');
    expect(vinError).toBeTruthy();
    expect(vinError?.message).toMatch(/already registered/);
  });

  it('errors on duplicate VIN within the same file', () => {
    const opts = makeOptions();
    opts.seenVinsInFile.add('MH1JFB118NK000001');
    const result = validateRow(makeRaw(), MAPS, opts);
    const vinError = result.errors.find((e) => e.field === 'vin');
    expect(vinError).toBeTruthy();
    expect(vinError?.message).toMatch(/Duplicate VIN in this file/);
  });

  it('uses defaultShowroomId when no showroom column', () => {
    const result = validateRow(makeRaw({ showroom: '' }), MAPS, makeOptions({ defaultShowroomId: SHOWROOM_ID }));
    expect(result.showroomId).toBe(SHOWROOM_ID);
    expect(result.errors.filter((e) => e.field === 'showroom')).toHaveLength(0);
  });

  it('errors when showroom is not found', () => {
    const result = validateRow(makeRaw({ showroom: 'DOES_NOT_EXIST' }), MAPS, makeOptions({ defaultShowroomId: null }));
    const showroomError = result.errors.find((e) => e.field === 'showroom');
    expect(showroomError).toBeTruthy();
  });

  it('errors when no showroom column and no defaultShowroomId', () => {
    const result = validateRow(makeRaw({ showroom: '' }), MAPS, makeOptions({ defaultShowroomId: null }));
    const showroomError = result.errors.find((e) => e.field === 'showroom');
    expect(showroomError).toBeTruthy();
  });
});

// ── BOOKED ────────────────────────────────────────────────────────────────────

describe('validateRow – BOOKED', () => {
  function bookedRaw(overrides: Partial<RawObRow> = {}): RawObRow {
    return makeRaw({
      state: 'booking',
      spkNumber: 'SPK-001',
      customerName: 'Budi Santoso',
      customerPhone: '081234567890',
      sales: 'Ahmad Salesman',
      ...overrides,
    });
  }

  it('validates a valid BOOKED row', () => {
    const result = validateRow(bookedRaw(), MAPS, makeOptions());
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('BOOKED');
    expect(result.spkNumber).toBe('SPK-001');
    expect(result.customerName).toBe('Budi Santoso');
    expect(result.salesUserId).toBe(USER_ID);
  });

  it('errors when spkNumber is missing', () => {
    const result = validateRow(bookedRaw({ spkNumber: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'spkNumber')).toBeTruthy();
  });

  it('errors when customerName is missing', () => {
    const result = validateRow(bookedRaw({ customerName: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'customerName')).toBeTruthy();
  });

  it('errors when SPK already exists in DB', () => {
    const mapsWithSpk: LookupMaps = {
      ...MAPS,
      existingSpkKeys: new Set([`${SHOWROOM_ID}|SPK-001`]),
    };
    const result = validateRow(bookedRaw(), mapsWithSpk, makeOptions());
    expect(result.errors.find((e) => e.field === 'spkNumber')).toBeTruthy();
  });

  it('warns when sales user is not found', () => {
    const result = validateRow(bookedRaw({ sales: 'Unknown Person' }), MAPS, makeOptions());
    const warn = result.warnings.find((w) => w.field === 'sales');
    expect(warn).toBeTruthy();
    expect(result.salesUserId).toBeNull();
  });

  it('matches sales user by employee id', () => {
    const result = validateRow(bookedRaw({ sales: 'EMP001' }), MAPS, makeOptions());
    expect(result.salesUserId).toBe(USER_ID);
  });

  it('two rows sharing one SPK share the same SPK key (no in-file duplicate error)', () => {
    const opts = makeOptions();
    // First row creates the SPK key in file tracker
    const r1 = validateRow(makeRaw({ vin: 'MH1JFB118NK000001', state: 'booking', spkNumber: 'SPK-999', customerName: 'A' }), MAPS, opts);
    expect(r1.errors.filter((e) => e.field === 'spkNumber')).toHaveLength(0);
    // Second row with same SPK — SPK tracking is at the showroom level, not
    // used for in-file dedup (SPKs are order-level, multiple units per SPK ok)
    const r2 = validateRow(makeRaw({ vin: 'MH1JFB118NK000002', state: 'booking', spkNumber: 'SPK-999', customerName: 'A' }), MAPS, opts);
    // seenSpkKeysInFile accumulates all keys but doesn't block re-use (multiple units per SPK allowed)
    expect(r2.state).toBe('BOOKED');
  });
});

// ── SOLD_PENDING_PICKUP ───────────────────────────────────────────────────────

describe('validateRow – SOLD_PENDING_PICKUP', () => {
  it('validates a valid sold row', () => {
    const result = validateRow(
      makeRaw({ state: 'terjual', spkNumber: 'SPK-002', customerName: 'Siti' }),
      MAPS,
      makeOptions(),
    );
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('SOLD_PENDING_PICKUP');
  });
});

// ── ACTIVE_RTO ────────────────────────────────────────────────────────────────

describe('validateRow – ACTIVE_RTO', () => {
  function rtoRaw(overrides: Partial<RawObRow> = {}): RawObRow {
    return makeRaw({
      state: 'rto aktif',
      contractNumber: 'KTR-001',
      customerName: 'Hendra',
      customerPhone: '083456789012',
      contractStartDate: '2025-01-01',
      ...overrides,
    });
  }

  it('validates a valid ACTIVE_RTO row', () => {
    const result = validateRow(rtoRaw(), MAPS, makeOptions());
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('ACTIVE_RTO');
    expect(result.contractNumber).toBe('KTR-001');
    expect(result.contractStartDate).toBe('2025-01-01');
  });

  it('errors when contractNumber is missing', () => {
    const result = validateRow(rtoRaw({ contractNumber: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'contractNumber')).toBeTruthy();
  });

  it('errors when customerName is missing', () => {
    const result = validateRow(rtoRaw({ customerName: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'customerName')).toBeTruthy();
  });

  it('errors when contract number already exists in DB', () => {
    const mapsWithContract: LookupMaps = {
      ...MAPS,
      existingContractNumbers: new Set(['KTR-001']),
    };
    const result = validateRow(rtoRaw(), mapsWithContract, makeOptions());
    expect(result.errors.find((e) => e.field === 'contractNumber')).toBeTruthy();
  });

  it('errors when contract number is duplicated in the file', () => {
    const opts = makeOptions();
    opts.seenContractNumbersInFile.add('KTR-001');
    const result = validateRow(rtoRaw(), MAPS, opts);
    expect(result.errors.find((e) => e.field === 'contractNumber')).toBeTruthy();
    expect(result.errors.find((e) => e.field === 'contractNumber')?.message).toMatch(/more than once/);
  });

  it('defaults contractStartDate to balanceDate when not provided', () => {
    const result = validateRow(rtoRaw({ contractStartDate: '' }), MAPS, makeOptions());
    expect(result.contractStartDate).toBe(BALANCE_DATE);
  });
});

// ── INSPECTION ────────────────────────────────────────────────────────────────

describe('validateRow – INSPECTION', () => {
  it('validates a valid INSPECTION row', () => {
    const result = validateRow(makeRaw({ state: 'inspeksi' }), MAPS, makeOptions());
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('INSPECTION');
  });
});

// ── SHOW_UNIT ─────────────────────────────────────────────────────────────────

describe('validateRow – SHOW_UNIT', () => {
  function showRaw(overrides: Partial<RawObRow> = {}): RawObRow {
    return makeRaw({
      state: 'pameran',
      eventName: 'IIMS 2025',
      eventLocation: 'JIExpo',
      expectedReturnDate: '2025-12-31',
      ...overrides,
    });
  }

  it('validates a valid SHOW_UNIT row', () => {
    const result = validateRow(showRaw(), MAPS, makeOptions());
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('SHOW_UNIT');
    expect(result.eventName).toBe('IIMS 2025');
    expect(result.expectedReturnDate).toBe('2025-12-31');
  });

  it('errors when eventName is missing', () => {
    const result = validateRow(showRaw({ eventName: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'eventName')).toBeTruthy();
  });

  it('errors when eventLocation is missing', () => {
    const result = validateRow(showRaw({ eventLocation: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'eventLocation')).toBeTruthy();
  });

  it('errors when expectedReturnDate is missing', () => {
    const result = validateRow(showRaw({ expectedReturnDate: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'expectedReturnDate')).toBeTruthy();
  });
});

// ── CUSTODY ───────────────────────────────────────────────────────────────────

describe('validateRow – CUSTODY', () => {
  function custodyRaw(overrides: Partial<RawObRow> = {}): RawObRow {
    return makeRaw({
      state: 'titipan',
      contractNumber: 'KTR-003',
      customerName: 'Maya',
      heldAtShowroom: 'BDG-01',
      ...overrides,
    });
  }

  it('validates a valid CUSTODY row', () => {
    const result = validateRow(custodyRaw(), MAPS, makeOptions());
    expect(result.errors).toHaveLength(0);
    expect(result.state).toBe('CUSTODY');
    expect(result.heldAtShowroomId).toBe(SHOWROOM_ID_2);
  });

  it('errors when heldAtShowroom is missing', () => {
    const result = validateRow(custodyRaw({ heldAtShowroom: '' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'heldAtShowroom')).toBeTruthy();
  });

  it('errors when heldAtShowroom matches responsible showroom', () => {
    const result = validateRow(custodyRaw({ heldAtShowroom: 'JKT-01' }), MAPS, makeOptions());
    const err = result.errors.find((e) => e.field === 'heldAtShowroom');
    expect(err).toBeTruthy();
    expect(err?.message).toMatch(/must differ/);
  });

  it('errors when heldAtShowroom is not found', () => {
    const result = validateRow(custodyRaw({ heldAtShowroom: 'NONEXISTENT' }), MAPS, makeOptions());
    expect(result.errors.find((e) => e.field === 'heldAtShowroom')).toBeTruthy();
  });
});

// ── Friendly state synonyms ───────────────────────────────────────────────────

describe('state synonym coverage (Indonesian + English)', () => {
  const cases: Array<[string, string]> = [
    ['siap', 'AVAILABLE'],
    ['available', 'AVAILABLE'],
    ['booking', 'BOOKED'],
    ['Booked', 'BOOKED'],
    ['terjual', 'SOLD_PENDING_PICKUP'],
    ['Terjual Belum Diambil', 'SOLD_PENDING_PICKUP'],
    ['rto', 'ACTIVE_RTO'],
    ['RTO Aktif', 'ACTIVE_RTO'],
    ['Active RTO', 'ACTIVE_RTO'],
    ['Inspeksi', 'INSPECTION'],
    ['Inspection', 'INSPECTION'],
    ['Show Unit', 'SHOW_UNIT'],
    ['Pameran', 'SHOW_UNIT'],
    ['Custody', 'CUSTODY'],
    ['Titipan', 'CUSTODY'],
  ];

  it.each(cases)('state synonym "%s" → %s', (input, expected) => {
    expect(parseState(input)).toBe(expected);
  });
});
