import { z } from 'zod';

export const dashboardShowroomQuerySchema = z.object({
  showroomId: z.string().uuid('showroomId must be a valid UUID'),
});

export type DashboardShowroomQuery = z.infer<typeof dashboardShowroomQuerySchema>;
