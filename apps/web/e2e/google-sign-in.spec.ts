import { expect, test, type Page } from '@playwright/test';

const clientId = '123-test.apps.googleusercontent.com';

async function mockGoogle(page: Page) {
  await page.route('**/api/auth/google-config', (route) => route.fulfill({ json: { clientId } }));
  await page.route('**/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: { error: 'No session' } }));
  await page.route('**/v1/auth/capabilities', (route) => route.fulfill({ json: { managed_wallet_signup: true } }));
  // Stub only the external provider for deterministic application-flow tests.
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.google={accounts:{id:{initialize(options){window.googleOptions=options},renderButton(el){el.replaceChildren();const button=document.createElement('button');button.textContent='Sign in with Google';button.onclick=()=>window.googleOptions.callback({credential:'test-google-credential'});el.append(button)}}}};`,
  }));
}

for (const path of ['/login', '/register']) {
  test(`runtime Google configuration displays the button on ${path}`, async ({ page }) => {
    await mockGoogle(page);
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeVisible();
    await expect(page.getByText('Continue with Google, or', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { googleOptions: { client_id: string } }).googleOptions.client_id)).toBe(clientId);
  });
}

test('runtime endpoint exposes only the public client ID and disables caching', async ({ request }) => {
  const response = await request.get('/api/auth/google-config');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ clientId: (process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim() });
});

test('Google credential establishes the app session without a wallet connection', async ({ page }) => {
  await mockGoogle(page);
  const user = { id: 'google-user', role: 'user', email: 'test@example.com' };
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  await page.route('**/v1/auth/google', async (route) => {
    expect(route.request().postDataJSON().credential).toBe('test-google-credential');
    await route.fulfill({ json: { token: `test.${payload}.test`, user } });
  });
  await page.route('**/v1/auth/me', (route) => route.fulfill({ json: user }));
  await page.goto('/login?next=/help');
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await expect(page).toHaveURL(/\/help$/);
});

test('rejected Google credentials leave the visitor signed out and show the error', async ({ page }) => {
  await mockGoogle(page);
  await page.route('**/v1/auth/google', (route) => route.fulfill({ status: 401, json: { error: 'Google sign-in failed. Please try again.' } }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Google sign-in failed' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('missing runtime configuration keeps wallet sign-in available', async ({ page }) => {
  await mockGoogle(page);
  await page.route('**/api/auth/google-config', (route) => route.fulfill({ json: { clientId: '' } }));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toHaveCount(0);
});

test('a Google script failure has a working retry', async ({ page }) => {
  await mockGoogle(page);
  let first = true;
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    if (first) { first = false; await route.abort(); } else { await route.fallback(); }
  });
  await page.goto('/login');
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't load Google sign-in" })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeVisible();
});

test('configuration request failure is visible and can be retried', async ({ page }) => {
  await mockGoogle(page);
  await page.route('**/api/auth/google-config', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/login');
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't load Google sign-in" })).toBeVisible();
  await page.route('**/api/auth/google-config', (route) => route.fulfill({ json: { clientId } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeVisible();
});
