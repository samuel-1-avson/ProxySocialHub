import { defineConfig, devices } from '@playwright/test';

const localDevURL = 'http://localhost:4011';
const baseURL = process.env.TEST_BASE_URL || localDevURL;
const e2eJwtSecret = process.env.TEST_JWT_SECRET || process.env.JWT_SECRET || 'proxyhubb-e2e-route-policy-secret-at-least-64-characters-long';
const webServer = process.env.TEST_BASE_URL
  ? undefined
  : {
      command: 'npm run dev:e2e',
      env: {
        ...process.env,
        JWT_SECRET: e2eJwtSecret,
        TEST_JWT_SECRET: e2eJwtSecret,
        PLAYWRIGHT_E2E_AUTH_BYPASS: '1',
        NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY: '1',
        ...(process.env.PLAYWRIGHT_UNIFIED_NETWORK === '1' || process.env.NEXT_PUBLIC_UNIFIED_NETWORK === '1'
          ? { NEXT_PUBLIC_UNIFIED_NETWORK: '1' }
          : {}),
        ...(process.env.PLAYWRIGHT_GLOBE_TOPOLOGY === '1' || process.env.NEXT_PUBLIC_GLOBE_TOPOLOGY === '1'
          ? { NEXT_PUBLIC_GLOBE_TOPOLOGY: '1' }
          : {}),
      },
      url: localDevURL,
      // Default: start fresh dev:e2e (JWT_SECRET + bypass env). Opt in with PLAYWRIGHT_REUSE_SERVER=1 only when
      // you already run `npm run dev:e2e` on :4011 — plain `npm run dev` breaks signed-auth / moderation E2E.
      reuseExistingServer:
        !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === '1',
      stdout: 'pipe' as const,
      timeout: 420 * 1000,
    };

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/public-frontends.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer,
});
