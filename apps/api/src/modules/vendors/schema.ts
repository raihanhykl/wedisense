import { z } from 'zod';

// Shared field definitions. Used in both create + update where create
// requires `name` and update has every field optional.
const sharedFields = {
  name: z.string().min(1, 'Vendor name is required').max(255),
  // NPWP — 15 digits typical, but we keep it free-text for now. The
  // eFaktur integration phase will tighten this to the DJP format.
  taxId: z.string().max(50).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  // Phone numbers come in many shapes (+62, 021-, 08…); permissive
  // length cap only.
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  contactPerson: z.string().max(255).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const createVendorSchema = z.object(sharedFields);

export const updateVendorSchema = z.object({
  name: sharedFields.name.optional(),
  taxId: sharedFields.taxId,
  email: sharedFields.email,
  phone: sharedFields.phone,
  address: sharedFields.address,
  contactPerson: sharedFields.contactPerson,
  notes: sharedFields.notes,
  isActive: sharedFields.isActive,
});

export const listVendorQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(255).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// Autocomplete — light query for the picker in PO/asset forms.
// Returns only the columns the picker needs; capped at 20 by default
// so a wide query doesn't ship the entire vendor list.
export const searchVendorQuerySchema = z.object({
  q: z.string().max(255).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type ListVendorQuery = z.infer<typeof listVendorQuerySchema>;
export type SearchVendorQuery = z.infer<typeof searchVendorQuerySchema>;
