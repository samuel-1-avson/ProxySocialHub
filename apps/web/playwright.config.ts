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
      },
      url: localDevURL,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe' as const,
      timeout: 420 * 1000,
    };

export default defineConfig({
  testDir: './e2e',
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
