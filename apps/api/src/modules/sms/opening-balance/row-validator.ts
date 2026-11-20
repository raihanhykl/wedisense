/**
 * row-validator.ts — Pure opening-balance row normalisation and validation.
 *
 * No Prisma, no Express. Receives lookup maps (variants, users, showrooms,
 * occupied keys) and returns normalised rows + per-row errors/warnings.
 *
 * Re-used identically by preview and confirm so the two paths can never
 * disagree on what constitutes a valid row.
 */
import type { ObState, ObPreviewRow, ObRowError, ObRowWarning } from './types.js';

// ── State synonyms (case-insensitive) ─────────────────────────────────────────

const STATE_MAP: Record<string, ObState> = {
  ready: 'AVAILABLE',
  siap: 'AVAILABLE',
  available: 'AVAILABLE',
  booked: 'BOOKED',
  booking: 'BOOKED',
  sold: 'SOLD_PENDING_PICKUP',
  terjual: 'SOLD_PENDING_PICKUP',
  'terjual belum diambil': 'SOLD_PENDING_PICKUP',
  'sold pending pickup': 'SOLD_PENDING_PICKUP',
  rto: 'ACTIVE_RTO',
  'rto aktif': 'ACTIVE_RTO',
  'active rto': 'ACTIVE_RTO',
  inspection: 'INSPECTION',
  inspeksi: 'INSPECTION',
  'show unit': 'SHOW_UNIT',
  pameran: 'SHOW_UNIT',
  custody: 'CUSTODY',
  titipan: 'CUSTODY',
};

export function parseState(raw: string): ObState | null {
  const normalised = raw.trim().toLowerCase();
  return STATE_MAP[normalised] ?? null;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD string from a cell that may also be a spreadsheet date
 *  (already converted to YYYY-MM-DD by tabular.ts). Returns null for empty. */
export function parseIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

// ── Lookup maps passed in by the service ──────────────────────────────────────

export interface VariantLookupRow {
  id: string;
  name: string;
  color: string;
  model: { code: string; name: string };
}

export interface UserLookupRow {
  id: string;
  name: string;
  employeeId: string | null;
}

export interface ShowroomLookupRow {
  id: string;
  code: string;
  name: string;
}

export interface LookupMaps {
  variants: VariantLookupRow[];
  users: UserLookupRow[];
  showrooms: ShowroomLookupRow[];
  /** VINs that already exist as units or as PENDING shipment lines. */
  existingVins: ReadonlySet<string>;
  /** SPK numbers that already exist per showroom id: `${showroomId}|${spkNumber}`. */
  existingSpkKeys: ReadonlySet<string>;
  /** Contract numbers that already exist in the database. */
  existingContractNumbers: ReadonlySet<string>;
}

// ── Column values extracted from one raw row ──────────────────────────────────

export interface RawObRow {
  row: number;
  vin: string;
  engineNumber: string;
  licensePlate: string;
  model: string;
  variant: string;
  color: string;
  state: string;
  showroom: string;
  notes: string;
  spkNumber: string;
  customerName: string;
  customerPhone: string;
  sales: string;
  contractNumber: string;
  contractStartDate: string;
  eventName: string;
  eventLocation: string;
  expectedReturnDate: string;
  pic: string;
  heldAtShowroom: string;
}

// ── Variant matching ──────────────────────────────────────────────────────────

export function matchVariant(
  variants: VariantLookupRow[],
  rawModel: string,
  rawVariant: string,
  rawColor: string,
): string | null {
  if (!rawModel && !rawVariant && !rawColor) return null;
  const rm = rawModel.toLowerCase();
  const rv = rawVariant.toLowerCase();
  const rc = rawColor.toLowerCase();

  const matched = variants.find((v) => {
    const modelMatch = !rm || v.model.code.toLowerCase() === rm || v.model.name.toLowerCase() === rm;
    const variantMatch = !rv || v.name.toLowerCase() === rv;
    const colorMatch = !rc || v.color.toLowerCase() === rc;
    return modelMatch && variantMatch && colorMatch;
  });

  return matched?.id ?? null;
}

/** Match a user by employee id (exact) or by name (case-insensitive exact). */
function matchUser(users: UserLookupRow[], raw: string): string | null {
  if (!raw.trim()) return null;
  const lower = raw.trim().toLowerCase();
  const byEmpId = users.find((u) => u.employeeId && u.employeeId.toLowerCase() === lower);
  if (byEmpId) return byEmpId.id;
  const byName = users.find((u) => u.name.toLowerCase() === lower);
  return byName?.id ?? null;
}

/** Match a showroom by code or name (case-insensitive). */
function matchShowroom(showrooms: ShowroomLookupRow[], raw: string): string | null {
  if (!raw.trim()) return null;
  const lower = raw.trim().toLowerCase();
  const byCode = showrooms.find((s) => s.code.toLowerCase() === lower);
  if (byCode) return byCode.id;
  const byName = showrooms.find((s) => s.name.toLowerCase() === lower);
  return byName?.id ?? null;
}

// ── Main validator ────────────────────────────────────────────────────────────

export interface ValidateRowOptions {
  /** Id of the form-level showroom (used when the row has no showroom column). */
  defaultShowroomId: string | null;
  /** Cutover date string YYYY-MM-DD. */
  balanceDate: string;
  /** VINs already seen earlier in the same file (before this row). */
  seenVinsInFile: Set<string>;
  /** SPK keys already created earlier in this file: `${showroomId}|${spkNumber}`. */
  seenSpkKeysInFile: Set<string>;
  /** Contract numbers already seen earlier in this file. */
  seenContractNumbersInFile: Set<string>;
}

/**
 * Validate and normalise one raw opening-balance row.
 *
 * Returns the normalised preview row (always, even when there are errors).
 * Errors must be empty for the row to be accepted by confirm.
 *
 * Side-effects: mutates `options.seenVinsInFile`, `seenSpkKeysInFile`,
 * `seenContractNumbersInFile` to track in-file duplicates.
 */
export function validateRow(
  raw: RawObRow,
  maps: LookupMaps,
  options: ValidateRowOptions,
): ObPreviewRow {
  const errors: ObRowError[] = [];
  const warnings: ObRowWarning[] = [];

  const vin = raw.vin.trim().toUpperCase();

  // VIN presence
  if (!vin) {
    errors.push({ field: 'vin', message: 'VIN is required' });
  }

  // Duplicate VIN in file
  if (vin && options.seenVinsInFile.has(vin)) {
    errors.push({ field: 'vin', message: `Duplicate VIN in this file: ${vin}` });
  } else if (vin) {
    options.seenVinsInFile.add(vin);
  }

  // VIN already exists in DB
  if (vin && maps.existingVins.has(vin)) {
    errors.push({
      field: 'vin',
      message: `VIN ${vin} is already registered as a unit or pending in a shipment`,
    });
  }

  // State
  const state = raw.state.trim() ? parseState(raw.state) : null;
  if (!raw.state.trim()) {
    errors.push({ field: 'state', message: 'State (kondisi) is required' });
  } else if (!state) {
    errors.push({ field: 'state', message: `Unknown state: "${raw.state}"` });
  }

  // Showroom
  const showroomId: string | null =
    raw.showroom.trim()
      ? matchShowroom(maps.showrooms, raw.showroom)
      : options.defaultShowroomId;

  if (!showroomId) {
    if (raw.showroom.trim()) {
      errors.push({ field: 'showroom', message: `Showroom not found: "${raw.showroom}"` });
    } else {
      errors.push({ field: 'showroom', message: 'Showroom is required' });
    }
  }

  // Variant matching
  const variantId = matchVariant(maps.variants, raw.model, raw.variant, raw.color);
  if (!variantId && (raw.model.trim() || raw.variant.trim() || raw.color.trim())) {
    // Warning only at preview; the client can supply variantId manually.
    // At confirm, missing variantId becomes an error (enforced by Zod schema).
    warnings.push({
      field: 'variant',
      message: `Variant not found in product master (model="${raw.model}", variant="${raw.variant}", color="${raw.color}")`,
    });
  }

  // State-specific fields
  let spkNumber: string | null = null;
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  let salesUserId: string | null = null;
  let contractNumber: string | null = null;
  let contractStartDate: string | null = null;
  let eventName: string | null = null;
  let eventLocation: string | null = null;
  let expectedReturnDate: string | null = null;
  let picUserId: string | null = null;
  let heldAtShowroomId: string | null = null;

  if (state === 'BOOKED' || state === 'SOLD_PENDING_PICKUP') {
    spkNumber = raw.spkNumber.trim() || null;
    customerName = raw.customerName.trim() || null;
    customerPhone = raw.customerPhone.trim() || null;

    if (!spkNumber) {
      errors.push({ field: 'spkNumber', message: 'SPK number is required for BOOKED / SOLD_PENDING_PICKUP' });
    }
    if (!customerName) {
      errors.push({ field: 'customerName', message: 'Customer name is required for BOOKED / SOLD_PENDING_PICKUP' });
    }

    // SPK duplicate check in DB
    if (spkNumber && showroomId) {
      const spkKey = `${showroomId}|${spkNumber}`;
      if (maps.existingSpkKeys.has(spkKey)) {
        errors.push({
          field: 'spkNumber',
          message: `SPK number "${spkNumber}" already exists for this showroom`,
        });
      }
      // Track within file (new SPKs accumulate per showroom+spk)
      options.seenSpkKeysInFile.add(spkKey);
    }

    // Sales user matching
    if (raw.sales.trim()) {
      salesUserId = matchUser(maps.users, raw.sales);
      if (!salesUserId) {
        warnings.push({
          field: 'sales',
          message: `Sales user not found: "${raw.sales}" — will be saved as null`,
        });
      }
    }
  }

  if (state === 'ACTIVE_RTO' || state === 'CUSTODY') {
    contractNumber = raw.contractNumber.trim() || null;
    contractStartDate = parseIsoDate(raw.contractStartDate) ?? options.balanceDate;

    if (!contractNumber) {
      errors.push({ field: 'contractNumber', message: 'Contract number is required for ACTIVE_RTO / CUSTODY' });
    } else {
      // DB duplicate check
      if (maps.existingContractNumbers.has(contractNumber)) {
        errors.push({
          field: 'contractNumber',
          message: `Contract number "${contractNumber}" already exists`,
        });
      }
      // In-file duplicate check
      if (options.seenContractNumbersInFile.has(contractNumber)) {
        errors.push({
          field: 'contractNumber',
          message: `Contract number "${contractNumber}" appears more than once in this file`,
        });
      } else {
        options.seenContractNumbersInFile.add(contractNumber);
      }
    }

    customerName = raw.customerName.trim() || null;
    customerPhone = raw.customerPhone.trim() || null;
    if (!customerName) {
      errors.push({ field: 'customerName', message: 'Customer name is required for ACTIVE_RTO / CUSTODY' });
    }

    if (raw.sales.trim()) {
      salesUserId = matchUser(maps.users, raw.sales);
      if (!salesUserId) {
        warnings.push({
          field: 'sales',
          message: `Sales user not found: "${raw.sales}" — will be saved as null`,
        });
      }
    }
  }

  if (state === 'CUSTODY') {
    const heldAtRaw = raw.heldAtShowroom.trim();
    if (!heldAtRaw) {
      errors.push({ field: 'heldAtShowroom', message: 'heldAtShowroom is required for CUSTODY' });
    } else {
      heldAtShowroomId = matchShowroom(maps.showrooms, heldAtRaw);
      if (!heldAtShowroomId) {
        errors.push({ field: 'heldAtShowroom', message: `Showroom not found: "${heldAtRaw}"` });
      } else if (heldAtShowroomId === showroomId) {
        errors.push({
          field: 'heldAtShowroom',
          message: 'heldAtShowroom must differ from the responsible showroom for CUSTODY',
        });
      }
    }
  }

  if (state === 'SHOW_UNIT') {
    eventName = raw.eventName.trim() || null;
    eventLocation = raw.eventLocation.trim() || null;
    expectedReturnDate = parseIsoDate(raw.expectedReturnDate);

    if (!eventName) {
      errors.push({ field: 'eventName', message: 'eventName is required for SHOW_UNIT' });
    }
    if (!eventLocation) {
      errors.push({ field: 'eventLocation', message: 'eventLocation is required for SHOW_UNIT' });
    }
    if (!expectedReturnDate) {
      errors.push({ field: 'expectedReturnDate', message: 'expectedReturnDate (YYYY-MM-DD) is required for SHOW_UNIT' });
    }

    if (raw.pic.trim()) {
      picUserId = matchUser(maps.users, raw.pic);
      if (!picUserId) {
        warnings.push({
          field: 'pic',
          message: `PIC user not found: "${raw.pic}" — will be saved as null`,
        });
      }
    }
  }

  return {
    row: raw.row,
    vin,
    state,
    showroomId,
    variantId,
    engineNumber: raw.engineNumber.trim() || null,
    licensePlate: raw.licensePlate.trim() || null,
    notes: raw.notes.trim() || null,
    spkNumber,
    customerName,
    customerPhone,
    salesUserId,
    contractNumber,
    contractStartDate,
    eventName,
    eventLocation,
    expectedReturnDate,
    picUserId,
    heldAtShowroomId,
    errors,
    warnings,
  };
}

// ── Confirm-time requirements ────────────────────────────────────────────────

/** The state-dependent fields of a normalised row, as sent to confirm. */
export interface ConfirmRowRequirements {
  state: ObState;
  showroomId: string;
  spkNumber?: string;
  customerName?: string;
  contractNumber?: string;
  eventName?: string;
  eventLocation?: string;
  expectedReturnDate?: string;
  heldAtShowroomId?: string;
}

/**
 * What a normalised row must carry for its state.
 *
 * The preview reports these on the raw spreadsheet values; confirm MUST
 * re-check them on the payload it actually receives, because the client is
 * never trusted to have sent what the preview approved. Returning problems
 * (instead of throwing) lets confirm report every bad row at once.
 */
export function validateConfirmRow(
  row: ConfirmRowRequirements,
): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  const missing = (value: string | undefined) => value === undefined || value.trim() === '';
  const require = (field: keyof ConfirmRowRequirements, label: string) => {
    if (missing(row[field])) {
      problems.push({ field, message: `${label} is required for a unit that is ${row.state}` });
    }
  };

  switch (row.state) {
    case 'BOOKED':
    case 'SOLD_PENDING_PICKUP':
      require('spkNumber', 'SPK number');
      require('customerName', 'Customer name');
      break;
    case 'ACTIVE_RTO':
      require('contractNumber', 'Contract number');
      require('customerName', 'Customer name');
      break;
    case 'CUSTODY':
      require('contractNumber', 'Contract number');
      require('customerName', 'Customer name');
      require('heldAtShowroomId', 'The showroom holding the unit');
      if (!missing(row.heldAtShowroomId) && row.heldAtShowroomId === row.showroomId) {
        problems.push({
          field: 'heldAtShowroomId',
          message: 'The showroom holding the unit must differ from the responsible showroom',
        });
      }
      break;
    case 'SHOW_UNIT':
      require('eventName', 'Event name');
      require('eventLocation', 'Event location');
      require('expectedReturnDate', 'Expected return date');
      break;
    case 'AVAILABLE':
    case 'INSPECTION':
      break;
  }
  return problems;
}
