import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against their own stack and database (acme_e2e, reset and seeded with the
// full 10,000 employees by e2e/global-setup.ts), so they never touch development data.
const API_PORT = 4100;
const WEB_PORT = 3100;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://acme:acme_local_dev@localhost:54329/acme_e2e';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npm run dev:api -w @acme/api',
      // Playwright starts servers before globalSetup creates the database, so readiness uses an
      // endpoint that answers (401) without touching the database.
      url: `http://localhost:${API_PORT}/api/v1/auth/me`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
        API_RATE_LIMIT_PER_MINUTE: '100000',
      },
    },
    {
      command: `npx next dev --port ${WEB_PORT}`,
      cwd: 'apps/web',
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN: `http://localhost:${API_PORT}`, NEXT_DIST_DIR: '.next-e2e' },
    },
  ],
});
