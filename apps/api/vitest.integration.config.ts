import { defineConfig } from 'vitest/config';
import path from 'path';

// Integration tests run against a REAL PostgreSQL database (a throwaway
// `*_test` database, created and migrated by the global setup). They exist
// for the guarantees a mocked Prisma client cannot prove: row locking,
// unique constraints, and exactly-once writes under concurrency.
//
//   pnpm --filter api test:integration
//
// The regular `pnpm --filter api test` suite stays database-free.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.ts'],
    globalSetup: ['src/test/integration/global-setup.ts'],
    setupFiles: ['src/test/integration/setup-env.ts'],
    // One database shared by every file: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    extensions: ['.ts', '.js'],
  },
});
