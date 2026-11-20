import { z } from 'zod';
import { SmsVehicleCondition } from '@prisma/client';

export const listShowLoansQuerySchema = z.object({
  showroomId: z.string().uuid('showroomId must be a valid UUID').optional(),
  status: z.enum(['out', 'overdue', 'returned', 'all']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createShowLoanSchema = z.object({
  unitId: z.string().uuid('unitId must be a valid UUID'),
  eventName: z
    .string()
    .trim()
    .min(2, 'eventName must be at least 2 characters')
    .max(120, 'eventName must be at most 120 characters'),
  eventLocation: z
    .string()
    .trim()
    .min(2, 'eventLocation must be at least 2 characters')
    .max(200, 'eventLocation must be at most 200 characters'),
  picUserId: z.string().uuid('picUserId must be a valid UUID'),
  /** ISO 8601 datetime. Defaults to now; must not be in the future. */
  dispatchedAt: z
    .string()
    .datetime({ message: 'dispatchedAt must be a valid ISO 8601 datetime' })
    .optional(),
  /** YYYY-MM-DD. Must be on or after the dispatch business date. */
  expectedReturnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expectedReturnDate must be formatted as YYYY-MM-DD'),
  notes: z.string().max(2000).nullable().optional(),
});

export const returnShowLoanSchema = z
  .object({
    /** ISO 8601 datetime. Defaults to now; must not be in the future or before dispatchedAt. */
    returnedAt: z
      .string()
      .datetime({ message: 'returnedAt must be a valid ISO 8601 datetime' })
      .optional(),
    condition: z.nativeEnum(SmsVehicleCondition),
    hasFindings: z.boolean(),
    /** Required when hasFindings is true. */
    findings: z
      .string()
      .trim()
      .min(3, 'findings must be at least 3 characters')
      .max(1000, 'findings must be at most 1000 characters')
      .optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.hasFindings && !data.findings) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'findings is required when hasFindings is true',
        path: ['findings'],
      });
    }
  });

export type ListShowLoansQuery = z.infer<typeof listShowLoansQuerySchema>;
export type CreateShowLoanInput = z.infer<typeof createShowLoanSchema>;
export type ReturnShowLoanInput = z.infer<typeof returnShowLoanSchema>;
