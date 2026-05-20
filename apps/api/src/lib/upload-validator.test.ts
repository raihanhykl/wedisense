import { describe, it, expect } from 'vitest';
import { validateUploadedFile, ALLOWED_IMPORT_MIMES } from './upload-validator.js';

// Build a buffer with the given prefix bytes plus padding to look like
// a real file (some validators reject suspiciously short inputs).
function fromBytes(prefix: number[], padTo = 64): Buffer {
  const buf = Buffer.alloc(padTo, 0);
  for (let i = 0; i < prefix.length; i++) buf[i] = prefix[i]!;
  return buf;
}

describe('validateUploadedFile()', () => {
  describe('XLSX (ZIP magic)', () => {
    it('accepts PK\\x03\\x04 — standard ZIP local file header', () => {
      const buf = fromBytes([0x50, 0x4b, 0x03, 0x04]);
      const result = validateUploadedFile(buf, 'application/octet-stream');
      expect(result.valid).toBe(true);
      expect(result.resolvedMime).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('accepts empty-ZIP marker PK\\x05\\x06', () => {
      const buf = fromBytes([0x50, 0x4b, 0x05, 0x06]);
      const result = validateUploadedFile(buf);
      expect(result.valid).toBe(true);
    });

    it('accepts spanned-ZIP marker PK\\x07\\x08', () => {
      const buf = fromBytes([0x50, 0x4b, 0x07, 0x08]);
      const result = validateUploadedFile(buf);
      expect(result.valid).toBe(true);
    });

    it('accepts XLSX even when client declares Safari octet-stream', () => {
      // Safari sometimes sends application/octet-stream for XLSX. The
      // magic bytes are still the source of truth — the resolvedMime
      // should be the canonical XLSX type, not the wrong client header.
      const buf = fromBytes([0x50, 0x4b, 0x03, 0x04]);
      const result = validateUploadedFile(buf, 'application/octet-stream');
      expect(result.valid).toBe(true);
      expect(result.resolvedMime).not.toBe('application/octet-stream');
    });
  });

  describe('XLS (compound document magic)', () => {
    it('accepts D0CF11E0A1B11AE1 — Microsoft Compound Document header', () => {
      const buf = fromBytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const result = validateUploadedFile(buf, 'application/vnd.ms-excel');
      expect(result.valid).toBe(true);
      expect(result.resolvedMime).toBe('application/vnd.ms-excel');
    });
  });

  describe('CSV (no magic bytes — content sniff)', () => {
    it('accepts CSV-like content when declared MIME is text/csv', () => {
      const buf = Buffer.from('name,email\nAlice,a@b.c\nBob,b@b.c\n', 'utf8');
      const result = validateUploadedFile(buf, 'text/csv');
      expect(result.valid).toBe(true);
      expect(result.resolvedMime).toBe('text/csv');
    });

    it('accepts CSV with UTF-8 BOM', () => {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const body = Buffer.from('name,email\n', 'utf8');
      const buf = Buffer.concat([bom, body]);
      const result = validateUploadedFile(buf, 'text/csv');
      expect(result.valid).toBe(true);
    });

    it('rejects plain text when MIME is NOT text/csv (no auto-promotion)', () => {
      const buf = Buffer.from('hello, world\n', 'utf8');
      const result = validateUploadedFile(buf, 'text/plain');
      expect(result.valid).toBe(false);
    });

    it('rejects CSV-declared file with binary content', () => {
      // Buffer of random binary bytes; declared as CSV but doesn't sniff.
      const buf = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xfe, 0xfd, 0xfc]);
      const result = validateUploadedFile(buf, 'text/csv');
      expect(result.valid).toBe(false);
    });
  });

  describe('Rejection paths', () => {
    it('rejects an empty buffer', () => {
      const result = validateUploadedFile(Buffer.alloc(0), 'text/csv');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });

    it('rejects an EXE renamed to .xlsx (MZ header)', () => {
      // PE/EXE files start with "MZ" (0x4D 0x5A). Multer's fileFilter
      // would accept this if the extension is .xlsx and MIME is right;
      // we catch it here.
      const buf = fromBytes([0x4d, 0x5a, 0x90, 0x00]);
      const result = validateUploadedFile(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/allowed/i);
    });

    it('rejects a PDF renamed to .xlsx', () => {
      // PDF starts with %PDF (0x25 0x50 0x44 0x46).
      const buf = fromBytes([0x25, 0x50, 0x44, 0x46]);
      const result = validateUploadedFile(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Exports', () => {
    it('ALLOWED_IMPORT_MIMES exposes the canonical MIME set', () => {
      // Sanity: callers downstream rely on this set being consistent with
      // what validateUploadedFile resolves to. If we ever add a new format,
      // both must update together.
      expect(ALLOWED_IMPORT_MIMES.has('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
      expect(ALLOWED_IMPORT_MIMES.has('application/vnd.ms-excel')).toBe(true);
      expect(ALLOWED_IMPORT_MIMES.has('text/csv')).toBe(true);
    });
  });
});
