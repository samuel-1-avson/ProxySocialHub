import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { stubMarketplaceBrowse } from './fixtures/marketplace-browse';

for (const theme of ['dark', 'light']) {
  test(`populated marketplace and search remain accessible in ${theme} mode`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.routeWebSocket(url => !url.pathname.includes('/_next/'), socket => socket.close());
    await stubMarketplaceBrowse(page);
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'View details' }).first()).toBeVisible({ timeout: 30_000 });
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(scan.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  });
}
