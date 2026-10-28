import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.EXPLORER_TEST_PORT || 4026);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Explorer test port');
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    timeout: 90_000,
  },
});
