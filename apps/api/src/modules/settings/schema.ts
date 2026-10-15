import { z } from 'zod';

/**
 * Every field except `name` is optional and nullable: a letterhead is
 * useful with just a company name, and operators fill in the rest over
 * time. Empty strings are coerced to null so the PDF renderer only has to
 * check for null, never for "" as well.
 */
const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v));

export const updateCompanySettingSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(150),
  address: nullableTrimmed(300),
  city: nullableTrimmed(100),
  province: nullableTrimmed(100),
  postalCode: nullableTrimmed(20),
  phone: nullableTrimmed(50),
  email: z
    .string()
    .trim()
    .email()
    .max(150)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === undefined || v === '' ? null : v)),
  website: nullableTrimmed(200),
  // Uppercased because they land verbatim in the document number
  // (".../BAST-IT/WDS/...") where mixed case would look like a typo.
  // Restricted to A-Z/0-9 so a stray slash can't corrupt the number's shape.
  documentCode: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, 'Document code must be letters and digits only')
    .transform((v) => v.toUpperCase()),
  divisionCode: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, 'Division code must be letters and digits only')
    .transform((v) => v.toUpperCase()),
});

export type UpdateCompanySettingInput = z.infer<typeof updateCompanySettingSchema>;
