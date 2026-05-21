import { z } from 'zod';

const locationTypeEnum = z.enum([
  'HEAD_OFFICE',
  'BRANCH',
  'FACTORY',
  'SHOWROOM',
  'SERVICE_CENTER',
  'OTHER',
]);

// Latitude: -90..90, longitude: -180..180. Decimal precision is enforced at
// the DB column level; we just keep the value in range at the API boundary.
const latitudeSchema = z.number().gte(-90).lte(90);
const longitudeSchema = z.number().gte(-180).lte(180);

// Operating hours: open-ended JSONB but we keep it sane by validating the
// top-level day keys. Each day is either { open, close } in HH:MM or the
// literal "closed" / null.
const dayHoursSchema = z.union([
  z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, 'open must be HH:MM'),
    close: z.string().regex(/^\d{2}:\d{2}$/, 'close must be HH:MM'),
  }),
  z.literal('closed'),
  z.null(),
]);

const operatingHoursSchema = z
  .object({
    mon: dayHoursSchema.optional(),
    tue: dayHoursSchema.optional(),
    wed: dayHoursSchema.optional(),
    thu: dayHoursSchema.optional(),
    fri: dayHoursSchema.optional(),
    sat: dayHoursSchema.optional(),
    sun: dayHoursSchema.optional(),
  })
  .strict();

// Custom fields: arbitrary JSON object. Shape is held by app-level config
// per location type, so the schema stays loose here.
const customFieldsSchema = z.record(z.unknown());

// Shared metadata fields used by both create and update. Kept separate so we
// can compose them with the required-vs-optional core fields on each side.
const locationMetadataFields = {
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  photoUrl: z.string().url().max(2048).nullable().optional(),
  qrCodeImageUrl: z.string().url().max(2048).nullable().optional(),
  contactUserId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  contactEmail: z.string().email().max(255).nullable().optional(),
  operatingHours: operatingHoursSchema.nullable().optional(),
  customFields: customFieldsSchema.nullable().optional(),
};

export const createLocationSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  type: locationTypeEnum,
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  ...locationMetadataFields,
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(50).optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  type: locationTypeEnum.optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  ...locationMetadataFields,
});

export const locationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  type: locationTypeEnum.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

/**
 * Archive a location, optionally migrating its direct assets to another
 * location first. When the location has direct assets, `migrateAssetsTo`
 * is required — the service rejects with `ASSETS_REQUIRE_MIGRATION` if
 * omitted. Subtree (descendant) assets are unaffected.
 */
export const archiveLocationSchema = z.object({
  migrateAssetsTo: z.string().uuid().nullable().optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationListQuery = z.infer<typeof locationListQuerySchema>;
export type ArchiveLocationInput = z.infer<typeof archiveLocationSchema>;
