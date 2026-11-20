import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { API_ROOT, databaseNameOf, resolveTestDatabaseUrl } from './database-url.js';

/**
 * Runs once before the integration suite: make sure the test database
 * exists and is migrated to the current schema.
 */
export default async function setup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  const databaseName = databaseNameOf(testUrl);

  // Connect to the maintenance database to create the test database on
  // first use. `databaseName` was validated against /^[a-z0-9_]+_test$/.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const existing = await admin.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = ${databaseName}
    `;
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // Apply every migration exactly as a deploy would.
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  process.env['DATABASE_URL'] = testUrl;
}
