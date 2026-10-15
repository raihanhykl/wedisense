import type { prisma } from '../lib/prisma.js';

type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Indonesian administrative letters number their month in Roman numerals.
 * Indexed by `Date#getMonth()` (0-based), so January is at index 0.
 */
const ROMAN_MONTHS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
] as const;

/** Document type key stored in `document_number_sequences.document_type`. */
export const DOCUMENT_TYPE_BAST = 'BAST';

export interface HandoverFormNumberOptions {
  /** Division segment, e.g. "IT" → ".../BAST-IT/...". From CompanySetting. */
  divisionCode: string;
  /** Company segment, e.g. "WDS". From CompanySetting. */
  documentCode: string;
  /**
   * Date the number is issued against. Drives both the Roman month and the
   * yearly sequence bucket. Pass the handover date, not `new Date()`, so a
   * form prepared for a future date still numbers consistently.
   */
  date: Date;
}

/**
 * Formats an already-allocated sequence into a BAST letter number.
 * Split out from allocation so tests can assert formatting without a DB.
 *
 * Shape: `001/BAST-IT/WDS/VIII/2026`
 */
export function formatHandoverFormNumber(
  sequence: number,
  options: HandoverFormNumberOptions,
): string {
  const seq = String(sequence).padStart(3, '0');
  const month = ROMAN_MONTHS[options.date.getMonth()];
  if (!month) {
    // Unreachable for a valid Date, but an Invalid Date yields NaN from
    // getMonth() and would otherwise silently produce "undefined" in the
    // middle of a legal document number.
    throw new Error(`Cannot format handover form number: invalid date ${String(options.date)}`);
  }
  return `${seq}/${DOCUMENT_TYPE_BAST}-${options.divisionCode}/${options.documentCode}/${month}/${options.date.getFullYear()}`;
}

/**
 * Allocates the next BAST number for the given year, atomically.
 *
 * Uses the same single-round-trip UPSERT as `generateAssetNumber`: Postgres
 * serialises concurrent writers on the `(document_type, year)` row, so two
 * simultaneous form creations can never receive the same sequence. Because
 * this runs on the caller's `tx`, a later failure in the same transaction
 * rolls the counter back rather than burning a number.
 *
 * MUST be called inside a transaction — passing the top-level client would
 * commit the increment independently of the form insert.
 */
export async function generateHandoverFormNumber(
  tx: PrismaTransactionClient,
  options: HandoverFormNumberOptions,
): Promise<string> {
  const year = options.date.getFullYear();
  if (!Number.isFinite(year)) {
    throw new Error(`Cannot generate handover form number: invalid date ${String(options.date)}`);
  }

  const rows = await tx.$queryRaw<Array<{ current_sequence: number }>>`
    INSERT INTO document_number_sequences (id, document_type, year, current_sequence)
    VALUES (gen_random_uuid(), ${DOCUMENT_TYPE_BAST}, ${year}, 1)
    ON CONFLICT (document_type, year)
    DO UPDATE SET current_sequence = document_number_sequences.current_sequence + 1
    RETURNING current_sequence
  `;

  const sequence = rows[0]?.current_sequence;
  if (sequence === undefined) {
    throw new Error('Document number sequence UPSERT returned no row');
  }

  return formatHandoverFormNumber(sequence, options);
}
