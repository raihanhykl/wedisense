import { resolveTestDatabaseUrl } from './database-url.js';

// Runs in every test worker BEFORE the test file (and therefore before
// src/lib/prisma.ts) is imported, so the shared Prisma client connects to
// the test database and never to development data.
if (!process.env['DEV_DATABASE_URL'] && process.env['DATABASE_URL']) {
  process.env['DEV_DATABASE_URL'] = process.env['DATABASE_URL'];
}
process.env['DATABASE_URL'] = resolveTestDatabaseUrl();
