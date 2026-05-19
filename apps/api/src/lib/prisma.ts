import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Dev log level is intentionally `['error', 'warn']` — NOT `['query']`.
// Prisma's query logger emits one line per generated SQL statement; a single
// `findMany({ include: { product: { include: { category } }, location, ... } })`
// produces 4-6 log lines per call. With multiple components fetching on a
// single page the terminal floods, which (a) burns dev-machine CPU on log
// rendering and (b) creates the impression of runaway DB activity even when
// the system is healthy. Set `PRISMA_LOG_QUERIES=1` to opt back in for
// targeted debugging.
const wantsQueryLogs =
  process.env['PRISMA_LOG_QUERIES'] === '1' ||
  process.env['PRISMA_LOG_QUERIES']?.toLowerCase() === 'true';

const devLog = wantsQueryLogs
  ? (['query', 'error', 'warn'] as const)
  : (['error', 'warn'] as const);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development'
      ? [...devLog]
      : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
