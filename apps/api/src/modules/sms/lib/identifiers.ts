import { z } from 'zod';

/**
 * A VIN (frame number) typed or imported by an admin.
 *
 * Normalised the same way everywhere — trimmed and uppercased, every other
 * character kept as is (leading zeros included). Standard VINs are 17
 * characters, but older or locally assembled units may differ, so the rule
 * is deliberately loose: 5–25 letters, digits or hyphens, no spaces. It
 * stops typos such as a pasted sentence or an embedded space from becoming
 * a unit that no search will ever find.
 */
export const vinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{5,25}$/, 'VIN must be 5–25 letters, digits or hyphens, without spaces');

/** Engine numbers and similar identifiers: trimmed, uppercased, no spaces. */
export const identifierSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9./-]{1,40}$/, 'Use letters, digits, ".", "/" or "-" only, without spaces');
