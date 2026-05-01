import { defineConfig, devices } from '@playwright/test';

const localDevURL = 'http://localhost:4011';
const baseURL = process.env.TEST_BASE_URL || localDevURL;
const webServer = process.env.TEST_BASE_URL
  ? undefined
  : {
      command: 'npm run dev -- --webpack',
      env: {
        ...process.env,
        PLAYWRIGHT_E2E_AUTH_BYPASS: '1',
      },
      url: localDevURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    };

export default defineConfig({
  testDir: './e2e',
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
