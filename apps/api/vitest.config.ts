import { defineConfig } from 'vitest/config';

// Integration tests use a dedicated database; never the development one.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://acme:acme_local_dev@localhost:54329/acme_test';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/integration/global-setup.ts'],
          env: { DATABASE_URL: testDatabaseUrl, NODE_ENV: 'test' },
          // Files share one database and truncate between tests, so they run one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
