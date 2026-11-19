import type { prisma } from '../../../lib/prisma.js';

export type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Who is performing an SMS write, as passed from routers into services. */
export interface SmsActor {
  userId: string;
}
