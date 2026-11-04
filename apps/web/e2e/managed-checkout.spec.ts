import { expect, test, type Page } from '@playwright/test';
import { stubMarketplaceBrowse } from './fixtures/marketplace-browse';
import { e2eOrderId, stubPurchaseApis } from './fixtures/marketplace-purchase';
import { seedSignedAuth } from './fixtures/signed-auth';

// Google-account (managed wallet) checkout is SOL-first: SOL in the ProxyHubb wallet is
// the main way to pay, card / mobile money is only the fallback when SOL is short.

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';
const managedAddress = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

type Preview = Record<string, unknown>;

const enoughSOL: Preview = {
  active_plan: false,
  usd_total: 0.79,
  sol_price_usd: 100,
  amount_sol: 0.0079,
  required_sol: 0.0105,
  balance_sol: 0.5,
  shortfall_sol: 0,
  pay_from_balance: true,
  wallet_address: managedAddress,
  fiat_enabled: false,
};

const shortOfSOL = (fiat: boolean): Preview => ({
  ...enoughSOL,
  balance_sol: 0,
  shortfall_sol: 0.01050012,
  pay_from_balance: false,
  fiat_enabled: fiat,
  ...(fiat ? { amount_ghs: 12.5 } : {}),
});

async function setup(page: Page, initial: Preview) {
  const state = {
    preview: initial,
    previewCalls: 0,
    balancePays: 0,
    paystackQuotes: 0,
    cancels: 0,
    payBalanceStatus: 200,
  };
  await seedSignedAuth(page, BASE_URL, 'buyer');
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        id: 'managed-buyer-e2e',
        email: 'managed-buyer@example.test',
        role: 'buyer',
        wallet_address: managedAddress,
        managed_wallet: { address: managedAddress, chain: 'solana' },
      },
    }),
  );
  await stubMarketplaceBrowse(page);
  await stubPurchaseApis(page);
  await page.route('**/v1/listings/*/checkout-preview**', (route) => {
    state.previewCalls++;
    return route.fulfill({ json: state.preview });
  });
  await page.route('**/v1/listings/*/paystack-preview**', (route) =>
    route.fulfill({ status: 500, json: { error: 'the old card-only preview must not be used' } }),
  );
  await page.route(`**/v1/orders/${e2eOrderId}/pay/balance`, (route) => {
    state.balancePays++;
    if (state.payBalanceStatus === 402) {
      return route.fulfill({
        status: 402,
        json: { error: 'Your ProxyHubb balance is too low for this order', code: 'insufficient_balance' },
      });
    }
    return route.fulfill({ json: { status: 'active', order_id: e2eOrderId, escrow_tx: 'escrow-e2e' } });
  });
  await page.route(`**/v1/orders/${e2eOrderId}/pay/paystack`, (route) => {
    state.paystackQuotes++;
    return route.fulfill({ status: 503, json: { error: 'not in this test' } });
  });
  await page.route(`**/v1/orders/${e2eOrderId}/cancel`, (route) => {
    state.cancels++;
    return route.fulfill({ json: { status: 'cancelled' } });
  });
  return state;
}

async function openCheckout(page: Page) {
  await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'View details' }).first().click();
  await page.getByRole('button', { name: 'Buy bandwidth' }).click();
  const dialog = page.getByTestId('buy-listing-modal');
  await expect(dialog.getByText('Pay with', { exact: true })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test.describe('Google-account checkout pays with SOL first', () => {
  test.setTimeout(150_000);

  test('SOL is the default and pays from the ProxyHubb wallet without Paystack', async ({ page }) => {
    // Card payments are on, but a wallet holding enough SOL never uses them.
    const state = await setup(page, { ...enoughSOL, fiat_enabled: true });
    const dialog = await openCheckout(page);

    await expect(dialog.getByRole('radio', { name: /Solana \(SOL\)/ })).toBeChecked();
    await expect(dialog.getByTestId('buy-listing-price-sol')).toHaveText('0.0079 SOL');
    await expect(dialog.getByTestId('buy-method-card')).toContainText('Not needed');
    await expect(dialog.getByRole('radio', { name: /Card or mobile money/ })).toBeDisabled();
    await expect(dialog.getByTestId('buy-add-sol')).toHaveCount(0);

    const pay = page.getByTestId('buy-listing-start-connection');
    await expect(pay).toHaveText(/Pay 0\.0079 SOL/);
    await pay.click();
    await expect(page).toHaveURL(new RegExp(`/app/connections/${e2eOrderId}$`), { timeout: 30_000 });
    expect(state.balancePays).toBe(1);
    expect(state.paystackQuotes).toBe(0);
    expect(state.cancels).toBe(0);
  });

  test('short on SOL with card payments off: shows how to add SOL and pays once it arrives', async ({ page }) => {
    const state = await setup(page, shortOfSOL(false));
    const dialog = await openCheckout(page);

    const pay = page.getByTestId('buy-listing-start-connection');
    await expect(pay).toHaveText(/Add SOL to pay/);
    await expect(pay).toBeDisabled();
    const addSol = dialog.getByTestId('buy-add-sol');
    // The shortfall is rounded up so sending the shown amount is always enough.
    await expect(addSol).toContainText('Add at least 0.0106 SOL');
    await expect(addSol).toContainText(managedAddress);
    await expect(dialog.getByTestId('buy-method-card')).toContainText('Not available yet');
    await expect(dialog.getByText('Card and mobile money payments are not available yet')).toBeVisible();
    await expect(page.getByTestId('buy-pay-with-card-instead')).toHaveCount(0);

    state.preview = enoughSOL;
    await addSol.getByRole('button', { name: 'Check balance' }).click();
    await expect(pay).toBeEnabled({ timeout: 10_000 });
    await expect(pay).toHaveText(/Pay 0\.0079 SOL/);
    expect(state.balancePays).toBe(0);
  });

  test('short on SOL with card payments on: card or mobile money is the fallback', async ({ page }) => {
    const state = await setup(page, shortOfSOL(true));
    const dialog = await openCheckout(page);

    await expect(dialog.getByRole('radio', { name: /Solana \(SOL\)/ })).toBeChecked();
    await expect(page.getByTestId('buy-listing-start-connection')).toBeDisabled();
    const fallback = page.getByTestId('buy-pay-with-card-instead');
    await expect(fallback).toHaveText(/No SOL\? Pay GH₵12\.50 by card or mobile money/);
    await fallback.click();

    await expect(dialog.getByRole('radio', { name: /Card or mobile money/ })).toBeChecked();
    await expect(dialog.getByTestId('buy-listing-price-ghs')).toHaveText('GH₵12.50');
    await expect(page.getByTestId('buy-listing-start-connection')).toHaveText(/Pay GH₵12\.50/);
    await expect(page.getByTestId('buy-listing-start-connection')).toBeEnabled();

    await page.getByRole('button', { name: 'Pay with SOL instead' }).click();
    await expect(dialog.getByRole('radio', { name: /Solana \(SOL\)/ })).toBeChecked();
    expect(state.paystackQuotes).toBe(0);
  });

  test('a wallet that ran short at pay time cancels the unpaid order and explains why', async ({ page }) => {
    const state = await setup(page, enoughSOL);
    state.payBalanceStatus = 402;
    const dialog = await openCheckout(page);

    await page.getByTestId('buy-listing-start-connection').click();
    await expect(dialog.getByRole('alert')).toContainText('does not have enough SOL', { timeout: 30_000 });
    expect(state.balancePays).toBe(1);
    expect(state.cancels).toBe(1);
    expect(state.paystackQuotes).toBe(0);
  });
});
