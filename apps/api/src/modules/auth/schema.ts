import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
