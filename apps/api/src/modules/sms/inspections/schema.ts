import { z } from 'zod';
import { SmsInspectionReason, SmsInspectionResult, SmsVehicleCondition } from '@prisma/client';

export const listInspectionsQuerySchema = z.object({
  showroomId: z.string().uuid('showroomId must be a valid UUID'),
  result: z.nativeEnum(SmsInspectionResult).optional(),
  unitId: z.string().uuid('unitId must be a valid UUID').optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const startInspectionSchema = z.object({
  unitId: z.string().uuid('unitId must be a valid UUID'),
  reason: z.nativeEnum(SmsInspectionReason).default('OTHER'),
  notes: z.string().max(2000).nullable().optional(),
  /** Business date of the event (YYYY-MM-DD). Defaults to today; future dates rejected by resolveEventDate. */
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'eventDate must be formatted as YYYY-MM-DD')
    .optional(),
});

const inspectionPhotoSchema = z.object({
  url: z.string().url('Photo URL must be a valid URL'),
  caption: z.string().max(500).nullable().optional(),
});

export const setInspectionResultSchema = z.object({
  result: z.enum(['PASSED', 'FAILED']),
  condition: z.nativeEnum(SmsVehicleCondition).optional(),
  odometer: z.number().int().min(0, 'Odometer must be non-negative').optional(),
  findings: z.string().max(5000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  photos: z.array(inspectionPhotoSchema).optional(),
  inspectorUserId: z.string().uuid('inspectorUserId must be a valid UUID').optional(),
  /** ISO datetime string. Must not be in the future. Defaults to now when omitted. */
  inspectedAt: z
    .string()
    .datetime({ message: 'inspectedAt must be a valid ISO 8601 datetime' })
    .optional(),
  /** Business date of the ledger event (YYYY-MM-DD). Defaults to today. */
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'eventDate must be formatted as YYYY-MM-DD')
    .optional(),
});

export type ListInspectionsQuery = z.infer<typeof listInspectionsQuerySchema>;
export type StartInspectionInput = z.infer<typeof startInspectionSchema>;
export type SetInspectionResultInput = z.infer<typeof setInspectionResultSchema>;
