import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/integration/global-setup.ts';

// Integration tests use a dedicated database (checked in global setup); never the development one.
const testDatabase = testDatabaseUrl();

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
          env: { DATABASE_URL: testDatabase, NODE_ENV: 'test' },
          // Files share one database and truncate between tests, so they run one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
