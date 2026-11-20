import { z } from 'zod';

export const lookupQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required').max(100),
});

export const createReturnRequestSchema = z.object({
  unitId: z.string().uuid('unitId must be a UUID'),
  toShowroomId: z.string().uuid('toShowroomId must be a UUID'),
  reason: z.string().min(3, 'Reason must be at least 3 characters').max(500),
  /** ISO datetime — present means the motorcycle is already physically at toShowroom. */
  custodyReceivedAt: z.string().datetime({ offset: true }).optional(),
  condition: z
    .enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'])
    .optional(),
  notes: z.string().max(1000).optional(),
});

export const custodyReceivedSchema = z.object({
  custodyReceivedAt: z.string().datetime({ offset: true }).optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
  notes: z.string().max(1000).optional(),
});

export const decideSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().min(1).max(500).optional(),
  })
  .refine(
    (d) => d.decision !== 'REJECTED' || (d.reason !== undefined && d.reason.length > 0),
    { message: 'reason is required when rejecting a return request', path: ['reason'] },
  );

export const officialReceiptSchema = z.object({
  officialReceivedAt: z.string().datetime({ offset: true }).optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']),
  odometer: z.number().int().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
});

export const custodyHandbackSchema = z.object({
  handedBackAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(1000).optional(),
});

export const listReturnRequestsQuerySchema = z.object({
  showroomId: z.string().uuid().optional(),
  direction: z.enum(['incoming', 'outgoing', 'all']).default('all'),
  status: z.enum(['pending', 'approved', 'rejected_custody', 'closed', 'all']).default('all'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type LookupQuery = z.infer<typeof lookupQuerySchema>;
export type CreateReturnRequestInput = z.infer<typeof createReturnRequestSchema>;
export type CustodyReceivedInput = z.infer<typeof custodyReceivedSchema>;
export type DecideInput = z.infer<typeof decideSchema>;
export type OfficialReceiptInput = z.infer<typeof officialReceiptSchema>;
export type CustodyHandbackInput = z.infer<typeof custodyHandbackSchema>;
export type ListReturnRequestsQuery = z.infer<typeof listReturnRequestsQuerySchema>;
