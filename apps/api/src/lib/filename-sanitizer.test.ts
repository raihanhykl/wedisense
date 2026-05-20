import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './filename-sanitizer.js';

describe('sanitizeFilename()', () => {
  describe('Path traversal protection', () => {
    it('replaces forward slashes so the result is a single path segment', () => {
      // After replacement the result contains no separators, so callers
      // can safely `path.join(dir, sanitizeFilename(...))` without traversal.
      // The literal `..` characters that survive are harmless inside a
      // filename (filesystems treat them as ordinary chars).
      const out = sanitizeFilename('../../etc/passwd.xlsx');
      expect(out).not.toContain('/');
      expect(out).not.toContain('\\');
      // Leading dots get stripped, so the result doesn't start with `..`.
      expect(out.startsWith('.')).toBe(false);
    });

    it('replaces backslashes (Windows paths)', () => {
      const out = sanitizeFilename('..\\..\\windows\\system32.xlsx');
      expect(out).not.toContain('\\');
      expect(out).not.toContain('/');
    });

    it('strips leading dots so .htaccess / .env cannot be written', () => {
      expect(sanitizeFilename('.htaccess')).toBe('htaccess');
      expect(sanitizeFilename('...env')).toBe('env');
    });

    it('handles mixed traversal attempts', () => {
      // Both separator replacement + leading-dot stripping happen.
      // Leading dots are stripped LAST so they don't get re-introduced
      // by the path separator substitution.
      const result = sanitizeFilename('../foo/bar.txt');
      expect(result).not.toContain('/');
      expect(result.startsWith('.')).toBe(false);
    });
  });

  describe('Control char / NUL removal', () => {
    it('strips ASCII control bytes', () => {
      // \x01-\x1F should be removed except for those treated as printable.
      const input = 'file\x00\x01\x02name.xlsx';
      expect(sanitizeFilename(input)).toBe('filename.xlsx');
    });

    it('handles NUL byte attempts to truncate names', () => {
      expect(sanitizeFilename('a\x00.xlsx')).toBe('a.xlsx');
    });
  });

  describe('Windows-reserved char replacement', () => {
    it('replaces < > : " | ? * with underscore', () => {
      const input = 'a<b>c:d"e|f?g*.xlsx';
      const result = sanitizeFilename(input);
      expect(result).toBe('a_b_c_d_e_f_g_.xlsx');
    });
  });

  describe('Unicode normalisation + length cap', () => {
    it('normalises NFD to NFC so visually-identical names hash the same', () => {
      // "é" composed (NFC, 1 char) vs decomposed (NFD, e + combining acute)
      const nfc = 'café.txt'; // U+00E9
      const nfd = 'café.txt'; // e + U+0301
      expect(sanitizeFilename(nfd)).toBe(sanitizeFilename(nfc));
    });

    it('caps length at 200 bytes UTF-8', () => {
      const long = 'a'.repeat(500) + '.xlsx';
      const result = sanitizeFilename(long);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    });

    it('respects byte-length not char-length for multi-byte UTF-8', () => {
      // Each "😀" is 4 bytes in UTF-8; 60 of them = 240 bytes — over the cap.
      const long = '😀'.repeat(60);
      const result = sanitizeFilename(long);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    });
  });

  describe('Edge cases', () => {
    it('returns "file" for empty input', () => {
      expect(sanitizeFilename('')).toBe('file');
    });

    it('returns "file" when every character is stripped', () => {
      expect(sanitizeFilename('\x00\x01\x02')).toBe('file');
      expect(sanitizeFilename('...')).toBe('file');
    });

    it('returns "file" for non-string defensive input', () => {
      // @ts-expect-error — testing defensive path
      expect(sanitizeFilename(null)).toBe('file');
      // @ts-expect-error — testing defensive path
      expect(sanitizeFilename(undefined)).toBe('file');
    });

    it('preserves a clean filename unchanged', () => {
      expect(sanitizeFilename('quarterly-report-Q1.xlsx')).toBe('quarterly-report-Q1.xlsx');
    });
  });
});
