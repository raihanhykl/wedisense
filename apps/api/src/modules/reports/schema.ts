import { z } from 'zod';

export const createReportSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['ASSET_LIST', 'MOVEMENT', 'MAINTENANCE', 'DEPRECIATION', 'AUDIT', 'CUSTOM']),
  parameters: z.record(z.unknown()).default({}),
  schedule: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).nullable().optional(),
  format: z.enum(['excel', 'pdf']).optional(),
});

export const updateReportSchema = createReportSchema.partial();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  type: z.enum(['ASSET_LIST', 'MOVEMENT', 'MAINTENANCE', 'DEPRECIATION', 'AUDIT', 'CUSTOM']).optional(),
  status: z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']).optional(),
});

export const generateReportSchema = z.object({
  format: z.enum(['excel', 'pdf']).default('excel'),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type GenerateReportInput = z.infer<typeof generateReportSchema>;
