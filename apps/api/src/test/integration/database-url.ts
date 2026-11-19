import { readFileSync } from 'node:fs';
import path from 'node:path';

const API_ROOT = path.resolve(__dirname, '../../..');

function readDatabaseUrlFromEnvFile(): string | undefined {
  try {
    const content = readFileSync(path.join(API_ROOT, '.env'), 'utf8');
    const match = content.match(/^DATABASE_URL=(?:"([^"]*)"|'([^']*)'|(\S+))/m);
    return match?.[1] ?? match?.[2] ?? match?.[3];
  } catch {
    return undefined;
  }
}

/**
 * The database integration tests run against.
 *
 * `TEST_DATABASE_URL` wins when set (CI). Otherwise the developer's
 * DATABASE_URL is reused with the database name swapped for `wedisense_test`,
 * so the tests never touch development data.
 *
 * Safety net: the resulting database name MUST end in `_test`. The suite
 * truncates tables, so it refuses to run against anything else.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  const base = explicit ?? process.env['DEV_DATABASE_URL'] ?? readDatabaseUrlFromEnvFile();
  if (!base) {
    throw new Error(
      'No database configured for integration tests. Set TEST_DATABASE_URL, or DATABASE_URL in apps/api/.env.',
    );
  }

  const url = new URL(base);
  if (!explicit) url.pathname = '/wedisense_test';

  const databaseName = url.pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+_test$/.test(databaseName)) {
    throw new Error(
      `Refusing to run integration tests against "${databaseName}": the database name must end in "_test".`,
    );
  }
  return url.toString();
}

export function databaseNameOf(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, '');
}

export { API_ROOT };
