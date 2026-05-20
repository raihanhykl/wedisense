/**
 * Magic-byte upload validator.
 *
 * Why hand-rolled, not `file-type`:
 *
 * The popular `file-type` library is pure ESM from v19 onward; pulling it
 * into our CommonJS API means dynamic `await import()` at every call site —
 * a lot of friction for the two file types this codebase actually accepts
 * (XLSX + XLS). The shapes we need to detect are well-defined byte sequences;
 * a 40-line table beats a 200-kB dependency.
 *
 * What this catches:
 *
 *  - Browser sends `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
 *    on an XLSX. We accept.
 *  - Attacker renames `evil.exe` to `report.xlsx`. Multer's fileFilter
 *    accepts (extension + MIME header look right) but THIS validator
 *    inspects the first bytes, doesn't find a ZIP signature, rejects.
 *  - Safari uploads an XLSX with MIME `application/octet-stream` (it
 *    sometimes drops the proper type). The magic bytes are correct, so
 *    we accept and override the declared MIME to the canonical one.
 *
 * What this does NOT catch:
 *
 *  - Polyglot files that ARE a valid ZIP but contain malicious content
 *    inside (e.g. a macro-laden XLSM masquerading as XLSX). For that we'd
 *    need full content inspection — out of scope for Phase 16.
 *  - CSV is plain text with no magic bytes; we fall back to the declared
 *    MIME + a printable-ASCII sniff of the first KB.
 *
 * Add a new file type by appending to MAGIC_SIGNATURES below.
 */

export interface ValidationResult {
  valid: boolean;
  /** Human-readable reason on failure; undefined on success. */
  reason?: string;
  /** Canonical MIME we derived from the bytes, regardless of what the client
   *  sent. Use this downstream instead of trusting `file.mimetype`. */
  resolvedMime?: string;
}

/** Allowed canonical MIME types for the bulk-import flow. Keep aligned with
 *  the multer fileFilter's whitelist — this is the *post*-magic-byte truth. */
export const ALLOWED_IMPORT_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv', // .csv
]);

/**
 * Signature table. Each entry says: "if the first `bytes.length` bytes of
 * the file match this hex pattern, the file is of this `mime`".
 *
 * XLSX/DOCX/etc. are ZIP archives; we treat all ZIP-magic files as XLSX
 * here because the caller only allows XLSX upload — the next layer
 * (exceljs parser) will reject ZIPs that aren't valid spreadsheets.
 */
interface Signature {
  /** Byte values to compare against the file start. */
  bytes: number[];
  /** Canonical MIME to report on match. */
  mime: string;
}

const MAGIC_SIGNATURES: Signature[] = [
  // ZIP container — XLSX, XLSM, DOCX, PPTX, ODF all share this. We map to
  // XLSX since that's the only ZIP type this validator's caller accepts;
  // the spreadsheet parser will reject non-Excel ZIPs downstream.
  {
    bytes: [0x50, 0x4b, 0x03, 0x04], // "PK\x03\x04" — local file header
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  // Empty ZIP — `[0x50, 0x4b, 0x05, 0x06]`. Rare for spreadsheets, but
  // an attacker could craft one. We still recognise it as ZIP/XLSX and
  // let the parser reject empties as no rows.
  {
    bytes: [0x50, 0x4b, 0x05, 0x06],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  // Spanned ZIP — extremely rare; included for completeness.
  {
    bytes: [0x50, 0x4b, 0x07, 0x08],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  // Microsoft Compound Document (legacy XLS, DOC, PPT).
  {
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    mime: 'application/vnd.ms-excel',
  },
];

/** Return true iff `buffer` starts with `signature`. */
function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Heuristic CSV detection. CSV has no magic bytes; we sniff the first KB
 * and require:
 *   - Mostly printable ASCII / common whitespace
 *   - At least one comma or newline within the first 1024 bytes
 *
 * False-positives (a plain text file passed off as CSV) reach the parser
 * which validates row shape. False-negatives (CSV with leading BOM or
 * unusual encoding) are accepted because we tolerate UTF-8 BOM + just
 * skip past the first 3 bytes for the sniff.
 */
function looksLikeCsv(buffer: Buffer): boolean {
  // Skip UTF-8 BOM if present.
  const start = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  const slice = buffer.subarray(start, Math.min(start + 1024, buffer.length));
  if (slice.length === 0) return false;

  let printable = 0;
  let hasDelimiter = false;
  for (const byte of slice) {
    // Tab, LF, CR, or printable ASCII range.
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) {
      printable++;
      if (byte === 0x2c /* , */ || byte === 0x0a /* \n */) hasDelimiter = true;
    }
  }
  return hasDelimiter && printable / slice.length > 0.95;
}

/**
 * Validate a buffer against the allowed import-MIME whitelist using magic
 * bytes. The declared `mimeHint` is the client's `Content-Type`; we ignore
 * it for the actual decision but include it in the error message for
 * debugging when something is wrong.
 *
 * Returns `{ valid: true, resolvedMime }` on accept; the caller should use
 * `resolvedMime` downstream rather than the original header.
 */
export function validateUploadedFile(buffer: Buffer, mimeHint?: string): ValidationResult {
  if (buffer.length === 0) {
    return { valid: false, reason: 'File is empty' };
  }

  for (const sig of MAGIC_SIGNATURES) {
    if (startsWith(buffer, sig.bytes)) {
      return { valid: true, resolvedMime: sig.mime };
    }
  }

  // CSV path — only allow if the declared MIME claims CSV. We don't auto-
  // promote arbitrary text to CSV because then any text file would slip
  // past the import filter.
  if (mimeHint === 'text/csv' && looksLikeCsv(buffer)) {
    return { valid: true, resolvedMime: 'text/csv' };
  }

  return {
    valid: false,
    reason: `File contents do not match any allowed type (declared MIME: ${mimeHint ?? 'unknown'}). Allowed: .xlsx, .xls, .csv.`,
  };
}
