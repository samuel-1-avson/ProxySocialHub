import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSignedAuth } from './fixtures/signed-auth';

const base = process.env.TEST_BASE_URL || 'http://localhost:4011';
const address = '5J7sQx1LQx32fY6k3i8rXQ9rC3Z1V3aNQ3fxh7c7c4yD';

async function setup(page: Page, managed = true) {
  const state = { lamports: 3_621_004_000, failure: false, clipboardFailure: false, copied: '', mutations: 0, transactions: [] as Record<string, unknown>[] };
  await seedSignedAuth(page, base, 'buyer');
  await page.routeWebSocket((url) => !url.pathname.includes('/_next/'), (ws) => ws.close());
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => {
      const result = await fetch('/test-clipboard', { method: 'POST', body: value });
      if (!result.ok) throw new Error('Clipboard permission denied');
    } } });
  });
  await page.route('**/test-clipboard', async (route) => {
    state.copied = route.request().postData() ?? '';
    await route.fulfill({ status: state.clipboardFailure ? 403 : 200, body: '' });
  });
  await page.route('https://api.devnet.solana.com/**', async (route) => {
    const body = route.request().postDataJSON();
    if (state.failure) return route.fulfill({ status: 503, json: { error: 'RPC unavailable' } });
    await route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result: { context: { slot: 1 }, value: state.lamports } } });
  });
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/auth/me') return route.fulfill({ json: {
      id: 'buyer-route-policy-user', role: 'buyer', email: 'wallet-review@example.test', wallet_address: address,
      ...(managed ? { managed_wallet: { address, chain: 'solana' } } : {}),
    } });
    if (path.startsWith('/v1/auth/')) return route.fallback();
    if (route.request().method() !== 'GET' && path.startsWith('/v1/wallet')) state.mutations++;
    if (path === '/v1/ws/ticket') return route.fulfill({ json: { ticket: 'test-websocket-ticket' } });
    if (path === '/v1/wallet') return route.fulfill({ json: { wallet: { id: 'test-wallet', balance_sol: 0, linked_solana_address: address, solana_network: 'devnet', created_at: '2026-11-04T09:00:00Z' } } });
    if (path === '/v1/wallet/transactions') return route.fulfill({ json: { transactions: state.transactions, next_cursor: '' } });
    if (path === '/v1/wallet/withdrawals') return route.fulfill({ json: { withdrawals: [] } });
    if (path === '/v1/orders') return route.fulfill({ json: { orders: [] } });
    if (path === '/v1/wallet/withdrawal-security') return route.fulfill({ json: { withdrawal_cooldown_active: false } });
    return route.fulfill({ json: {} });
  });
  return state;
}

test.describe('Google-created wallet', () => {
  test.setTimeout(90_000);

  test('shows a full wallet overview and refreshes the real RPC balance', async ({ page }) => {
    const state = await setup(page);
    await page.goto('/app/wallet');
    await expect(page.getByTestId('managed-wallet-balance')).toContainText('3.621004');
    await expect(page.getByText('Managed by ProxyHubb', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /connect wallet/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /view on solscan/i })).toHaveAttribute('href', `https://solscan.io/account/${address}?cluster=devnet`);
    state.lamports = 4_032_110_000;
    await page.getByRole('button', { name: 'Refresh wallet balance' }).click();
    await expect(page.getByTestId('managed-wallet-balance')).toContainText('4.03211');
    await page.getByRole('button', { name: 'Copy address', exact: true }).click();
    await expect.poll(() => state.copied).toBe(address);
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/managed-wallet-desktop-dark.png', fullPage: true });
    expect(state.mutations).toBe(0);
  });

  test('receive dialog exposes the correct address and network without a transfer', async ({ page }) => {
    const state = await setup(page);
    await page.goto('/app/wallet');
    const receive = page.getByRole('button', { name: 'Receive SOL', exact: true });
    await receive.click();
    const dialog = page.getByRole('dialog', { name: 'Receive SOL' });
    await expect(dialog.getByText(address, { exact: true })).toBeVisible();
    await expect(dialog.locator('svg').filter({ has: page.locator('title', { hasText: 'Your Solana wallet address' }) })).toHaveCount(1);
    await expect(dialog.getByText(/Do not send mainnet SOL or real funds/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy wallet address' }).click();
    await expect.poll(() => state.copied).toBe(address);
    await page.screenshot({ path: 'test-results/managed-wallet-receive-desktop.png', fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(receive).toBeFocused();
    expect(state.mutations).toBe(0);
  });

  test('balance errors stay visible and recover without displaying a false zero', async ({ page }) => {
    const state = await setup(page);
    state.failure = true;
    await page.goto('/app/wallet');
    const error = page.getByRole('alert').filter({ hasText: 'Balance could not be refreshed' });
    await expect(error).toBeVisible();
    await expect(page.getByTestId('managed-wallet-balance')).toContainText('—');
    state.failure = false;
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('managed-wallet-balance')).toContainText('3.621004');
    await expect(error).not.toBeVisible();
  });

  test('shows actual account activity and keeps the full ledger reachable', async ({ page }) => {
    const state = await setup(page);
    state.transactions = [{ id: 'refund-test', description: 'Unused order funds returned', type: 'refund', amount: 0.0084, amount_lamports: 8_400_000, status: 'completed', created_at: '2026-11-04T09:31:00Z' }];
    await page.goto('/app/wallet');
    await expect(page.getByText('Unused order funds returned')).toBeVisible();
    await expect(page.getByText('0.0084 SOL', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'View activity', exact: true }).click();
    await expect(page).toHaveURL(/tab=history/);
    await expect(page.getByRole('heading', { name: 'Account ledger' })).toBeVisible();
  });

  test('clipboard denial leaves a selectable address and useful feedback', async ({ page }) => {
    const state = await setup(page);
    state.clipboardFailure = true;
    await page.goto('/app/wallet');
    await page.getByRole('button', { name: 'Copy address', exact: true }).click();
    await expect(page.getByText('Copy is unavailable. Select and copy the address below.')).toBeVisible();
    await expect(page.getByText(address, { exact: true })).toBeVisible();
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`responsive ${theme} layout and receive dialog are accessible`, async ({ page }) => {
      await setup(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await page.goto('/app/wallet');
      await expect(page.getByTestId('managed-wallet-balance')).toContainText('3.621004');
      await expect(page.getByText('Your activity starts here', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const violations = (await new AxeBuilder({ page }).include('[data-testid="managed-wallet-overview"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      expect(violations).toEqual([]);
      await page.screenshot({ path: `test-results/managed-wallet-mobile-${theme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Receive SOL', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    });
  }

  test('external wallet users retain the existing connected-wallet interface', async ({ page }) => {
    await setup(page, false);
    await page.goto('/app/wallet');
    await expect(page.getByRole('heading', { name: 'Your payment wallet', exact: true })).toBeVisible();
    await expect(page.getByTestId('managed-wallet-overview')).toHaveCount(0);
  });
});
