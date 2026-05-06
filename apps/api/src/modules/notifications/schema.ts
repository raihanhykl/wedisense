import { z } from 'zod';
import { NotificationType } from '@prisma/client';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isRead: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v),
    z.boolean().optional(),
  ),
  type: z.nativeEnum(NotificationType).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
export type IdParam = z.infer<typeof idParamSchema>;
