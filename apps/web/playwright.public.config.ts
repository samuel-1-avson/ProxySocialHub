import { defineConfig, devices } from '@playwright/test';

// Run against the independently served Docs (:4023) and Explorer (:4024).
export default defineConfig({
  testDir: './e2e',
  testMatch: 'public-frontends.spec.ts',
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
