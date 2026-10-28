import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'public-frontends.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: 'test-results/public-frontends',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: 'node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 4023', cwd: path.resolve(__dirname, '../docs'), url: 'http://127.0.0.1:4023/docs', reuseExistingServer: !process.env.CI, timeout: 90_000 },
    { command: 'node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 4024', cwd: path.resolve(__dirname, '../explorer'), url: 'http://127.0.0.1:4024', reuseExistingServer: !process.env.CI, timeout: 90_000 },
  ],
});
