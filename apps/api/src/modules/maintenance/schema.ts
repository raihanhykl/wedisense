import { z } from 'zod';

const frequencyTypeEnum = z.enum([
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
]);

const assetConditionEnum = z.enum([
  'NEW',
  'GOOD',
  'FAIR',
  'POOR',
  'DAMAGED',
]);

// ── Schedule schemas ───────────────────────────────────────

export const createScheduleSchema = z.object({
  assetId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  frequencyType: frequencyTypeEnum,
  nextDueDate: z.coerce.date(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateScheduleSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  frequencyType: frequencyTypeEnum.optional(),
  nextDueDate: z.coerce.date().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const scheduleListFilterSchema = z.object({
  assetId: z.string().uuid().optional(),
  frequencyType: frequencyTypeEnum.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ── Log schemas ────────────────────────────────────────────

export const createLogSchema = z.object({
  assetId: z.string().uuid(),
  maintenanceScheduleId: z.string().uuid().nullable().optional(),
  performedAt: z.coerce.date(),
  description: z.string().min(1),
  findings: z.string().nullable().optional(),
  actionTaken: z.string().nullable().optional(),
  cost: z.coerce.number().nonnegative().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  invoiceUrl: z.string().url().nullable().optional(),
  conditionBefore: assetConditionEnum,
  conditionAfter: assetConditionEnum,
  attachments: z.any().optional(),
});

export const logListFilterSchema = z.object({
  assetId: z.string().uuid().optional(),
  scheduleId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type CreateLogInput = z.infer<typeof createLogSchema>;
