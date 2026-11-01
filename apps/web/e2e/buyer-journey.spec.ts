import { expect as baseExpect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
import { setHeaderTheme } from "./fixtures/theme";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const expect = baseExpect.configure({ timeout: 30_000 });
async function capture(page: Page, filename: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: filename, fullPage: true });
}
const order = {
  id: "recovery-order",
  listing_id: "original-listing",
  buyer_id: "buyer-route-policy-user",
  status: "pending_payment",
  bandwidth_gb: 2,
  total_price: 3,
  created_at: "2026-10-28T08:00:00Z",
  listing: { title: "Original proxy order" },
};
type Reply = { status?: number; json: unknown };
async function setup(page: Page, overrides: Record<string, Reply> = {}) {
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  page.on("requestfailed", (request) =>
    console.log(
      "Request failed:",
      new URL(request.url()).pathname,
      request.failure()?.errorText,
    ),
  );
  const requests: { method: string; path: string; body: unknown }[] = [];
  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (ws) => ws.close(),
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    requests.push({ method, path, body: request.postDataJSON() });
    const defaults: Record<string, unknown> = {
      "/v1/orders": { orders: [order] },
      "/v1/usage/me": { total_gb: 0, total_cost_sol: 0 },
      "/v1/wallet": {
        wallet: {
          id: "wallet",
          balance_sol: 2.5,
          solana_network: "devnet",
          created_at: order.created_at,
        },
      },
      "/v1/wallet/withdrawal-security": { withdrawal_cooldown_active: false },
      "/v1/system/config/public": {
        treasury_solana: "11111111111111111111111111111111",
        sol_price_usd: 100,
      },
      "/v1/orders/recovery-order": order,
      "/v1/notifications/unread-count": { count: 0 },
      "/v1/passes/me": {
        name: "Starter",
        tier: "none",
        source: "default",
        quota: { remaining_gb: 0, limit_gb: 0, unlimited: false },
      },
      "/v1/passes/catalog": {
        passes: [
          {
            tier: "bronze",
            name: "Bronze",
            bandwidth_limit_gb: 20,
            listing_limit: 1,
            price_sol: 0.1,
            benefits: ["API access"],
          },
        ],
      },
      "/v1/passes/migration": { message: "No legacy entitlement." },
      "/v1/subscriptions/me": { subscription: null },
    };
    const response =
      overrides[`${method} ${path}`] ||
      (path in defaults
        ? { json: defaults[path] }
        : { status: 503, json: { error: "Service unavailable in this test" } });
    await route.fulfill(response);
  });
  await seedSignedAuth(page, base, "buyer");
  return requests;
}

test.describe("buyer journey and recovery", () => {
  test.use({ actionTimeout: 30_000 });
  test.setTimeout(180_000);
  test("distinguishes account funds from wallet and escrow; prevents funding on another network", async ({
    page,
  }, info) => {
    await setup(page);
    await page.goto(`${base}/app/wallet`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("2.5 SOL", { exact: true })).toBeVisible();
    await expect(
      page.getByText("No wallet linked", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("0 orders", { exact: true })).toBeVisible();
    await page.getByLabel("Balance network").selectOption("testnet");
    await expect(
      page.getByText(/You are inspecting another network/),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Account funds", exact: true })
      .click();
    await page.getByLabel("Deposit amount (SOL)").fill("0.1");
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeDisabled();
    await setHeaderTheme(page, "light");
    await capture(page, info.outputPath("buyer-wallet.png"));
  });
  for (const width of [1440, 320]) {
    test(`shows funded linked wallet separately from an empty account at ${width}px`, async ({ page, browserName }, info) => {
      await page.setViewportSize({ width, height: 950 });
      const address = "11111111111111111111111111111111";
      await setup(page, { "GET /v1/wallet": { json: { wallet: {
        id: "wallet", balance_sol: 0, linked_solana_address: address, solana_network: "devnet",
      } } } });
      let lamports = 15_000_000_000;
      await page.route("https://api.devnet.solana.com/**", route => route.fulfill({ json: {
        jsonrpc: "2.0", id: route.request().postDataJSON()?.id,
        result: { context: { slot: 1 }, value: lamports },
      } }));
      if (browserName === "chromium") await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(`${base}/app/wallet`, { waitUntil: "domcontentloaded" });
      const paymentWallet = page.getByRole("region", { name: "Your payment wallet" });
      await expect(paymentWallet.getByText("15 SOL", { exact: true })).toBeVisible();
      await expect(paymentWallet.getByText("Reconnect to approve payments", { exact: true })).toBeVisible();
      await expect(paymentWallet.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
      await expect(page.getByText("A zero account balance does not mean your linked wallet is empty.")).toBeVisible();
      if (browserName === "chromium") {
        await paymentWallet.getByRole("button", { name: "Copy address", exact: true }).click();
        await expect(paymentWallet.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
      }
      lamports = 16_000_000_000;
      await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
      await expect(paymentWallet.getByText("16 SOL", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await setHeaderTheme(page, width === 320 ? "light" : "dark");
      await capture(page, info.outputPath(`wallet-linked-${width}.png`));
    });
  }
  test("keeps an unavailable chain balance distinct from zero account funds", async ({ page }) => {
    await setup(page, { "GET /v1/wallet": { json: { wallet: {
      id: "wallet", balance_sol: 0, linked_solana_address: "11111111111111111111111111111111", solana_network: "devnet",
    } } } });
    await page.route("https://api.devnet.solana.com/**", route => route.fulfill({ status: 503, body: "RPC unavailable" }));
    await page.goto(`${base}/app/wallet`, { waitUntil: "domcontentloaded" });
    const paymentWallet = page.getByRole("region", { name: "Your payment wallet" });
    await expect(paymentWallet.getByRole("alert")).toBeVisible();
    await expect(paymentWallet.getByText("0 SOL", { exact: true })).toHaveCount(0);
    await expect(paymentWallet.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expect(page.getByText("0 SOL", { exact: true })).toBeVisible();
  });
  test("checks original order escrow without creating an order and preserves funded cancellation errors", async ({
    page,
  }) => {
    const requests = await setup(page, {
      "POST /v1/orders/recovery-order/confirm-escrow": {
        status: 409,
        json: { error: "Escrow is still pending" },
      },
      "POST /v1/orders/recovery-order/cancel": {
        status: 409,
        json: { error: "Funded orders cannot be cancelled" },
      },
      "GET /v1/listings/original-listing": {
        json: {
          listing: {
            id: "original-listing",
            title: "Original proxy order",
            price_per_gb: 1.5,
            min_purchase_gb: 1,
            available_bandwidth_gb: 10,
            bulk_discounts: [],
            proxy_type: "residential",
          },
        },
      },
    });
    await page.goto(`${base}/app/activity/orders/recovery-order`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Check existing payment" }).click();
    await expect(
      page.getByText("Escrow is still pending", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel unfunded order…" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel unfunded order", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByText("Funded orders cannot be cancelled"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep order" }).click();
    await page
      .getByRole("button", { name: "Resume payment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("slider")).toBeDisabled();
    expect(
      requests.filter((r) => r.method === "POST" && r.path === "/v1/orders"),
    ).toHaveLength(0);
    expect(
      requests.filter((r) => r.path.endsWith("/confirm-escrow")),
    ).toHaveLength(1);
    expect(requests.filter((r) => r.path.endsWith("/cancel"))).toHaveLength(1);
  });
  test("unwraps live session counters and does not claim termination after an API failure", async ({
    page,
  }, info) => {
    const requests = await setup(page, {
      "GET /v1/sessions/session-1": {
        json: {
          session: {
            id: "session-1",
            status: "active",
            type: "sticky",
            bytes_used: 0,
            bytes_limit: 0,
            created_at: order.created_at,
          },
          bandwidth_used: 1073741824,
          bandwidth_limit: 2147483648,
        },
      },
      "GET /v1/usage/session/session-1": {
        json: { bytes_used: 1073741824, cost_sol: 0.000125 },
      },
      "DELETE /v1/sessions/session-1": {
        status: 503,
        json: { error: "Termination is temporarily unavailable" },
      },
    });
    await page.goto(`${base}/app/connections/sessions/session-1`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("1 GB", { exact: true })).toBeVisible();
    await expect(page.getByText("2 GB", { exact: true })).toBeVisible();
    await expect(page.getByText("0.000125 SOL", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/does not prove the current browser is routing/),
    ).toBeVisible();
    await setHeaderTheme(page, "dark");
    await capture(page, info.outputPath("buyer-session.png"));
    await page.getByRole("button", { name: "End session…" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Termination is temporarily unavailable"),
    ).toBeVisible();
    await expect(page.getByText("active", { exact: true })).toBeVisible();
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });
  test("reports unknown security status on failure instead of claiming two-factor authentication is off", async ({
    page,
  }) => {
    await setup(page, {
      "GET /v1/2fa/backup-codes": {
        status: 503,
        json: { error: "Security service unavailable" },
      },
    });
    await page.goto(`${base}/app/settings?tab=security`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByText("Status unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Security service unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Not enabled", { exact: true })).toHaveCount(0);
  });
  test("verifies a retained Access Pass payment without preparing or sending another payment", async ({
    page,
  }, info) => {
    const requests = await setup(page, {
      "POST /v1/passes/confirm-purchase": {
        json: { message: "Original payment verified", purchase: {} },
      },
    });
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "proxyhubb-pass-payment:buyer-route-policy-user:devnet",
        JSON.stringify({
          tier: "bronze",
          signature: "existing-public-signature",
          purchaseId: "original-purchase",
        }),
      ),
    );
    await page.goto(`${base}/app/activity?tab=billing`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", { name: "Verify existing pass payment" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Verify existing pass payment" })
      .click();
    await expect(page.getByText(/Original payment verified/)).toBeVisible();
    const confirmations = requests.filter(
      (r) => r.path === "/v1/passes/confirm-purchase",
    );
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].body).toMatchObject({
      tx_signature: "existing-public-signature",
      purchase_id: "original-purchase",
      tier: "bronze",
    });
    expect(
      requests.filter((r) => r.path === "/v1/passes/prepare-purchase"),
    ).toHaveLength(0);
    await setHeaderTheme(page, "light");
    await capture(page, info.outputPath("buyer-billing.png"));
  });
  test("restores a submitted account deposit after reload and only verifies its original signature", async ({
    page,
  }) => {
    const address = "11111111111111111111111111111111";
    const requests = await setup(page, {
      "GET /v1/wallet": {
        json: {
          wallet: {
            id: "wallet",
            balance_sol: 2.5,
            linked_solana_address: address,
            solana_network: "devnet",
          },
        },
      },
      "POST /v1/wallet/deposit/crypto": {
        status: 503,
        json: { error: "Verification temporarily unavailable" },
      },
    });
    await page.route("https://api.devnet.solana.com/**", (route) =>
      route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: route.request().postDataJSON()?.id,
          result: { context: { slot: 1 }, value: 1000000000 },
        },
      }),
    );
    await page.addInitScript(
      ({ key }) =>
        sessionStorage.setItem(
          key,
          JSON.stringify({
            amount: 0.1,
            amountInput: "0.1",
            signature: "original-account-signature",
          }),
        ),
      { key: `proxyhubb-account-deposit:${address}:devnet` },
    );
    await page.goto(`${base}/app/wallet?tab=funds`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("0.1 SOL deposit", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Existing transaction signature")).toHaveCount(0);
    await expect(page.getByText(/Confirmation is taking longer than usual/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeDisabled();
    const credits = requests.filter(
      (r) => r.path === "/v1/wallet/deposit/crypto",
    );
    expect(credits).toHaveLength(1);
    expect(credits[0].body).toMatchObject({
      tx_hash: "original-account-signature",
      amount_lamports: 100000000,
    });
  });
  test("updates profile and preserves notification preferences in the new settings utility", async ({
    page,
  }, info) => {
    const profile = {
      id: "buyer-route-policy-user",
      username: "buyer-route-policy",
      display_name: "Original name",
    };
    const prefs = {
      business_in_app: true,
      business_email: true,
      business_push: false,
      email_digest_frequency: "daily",
      digest_hour: 9,
    };
    const requests = await setup(page, {
      "GET /v1/profile": { json: profile },
      "PATCH /v1/profile": {
        json: { ...profile, display_name: "Updated buyer" },
      },
      "GET /v1/notification-preferences": { json: prefs },
      "PUT /v1/notification-preferences": { json: prefs },
    });
    await page.goto(`${base}/app/settings`, { waitUntil: "domcontentloaded" });
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Updated buyer");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(
      page.getByText("Profile saved.", { exact: true }),
    ).toBeVisible();
    expect(requests.find((r) => r.method === "PATCH")?.body).toMatchObject({
      display_name: "Updated buyer",
    });
    await page.getByRole("link", { name: "Preferences", exact: true }).click();
    await page.getByLabel("Orders & payments email", { exact: true }).uncheck();
    await page.getByLabel("Daily digest hour").selectOption("14");
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect(
      page.getByText("Preferences saved.", { exact: true }),
    ).toBeVisible();
    expect(requests.find((r) => r.method === "PUT")?.body).toMatchObject({
      business_email: false,
      business_in_app: true,
      digest_hour: 14,
    });
    await setHeaderTheme(page, "light");
    await capture(page, info.outputPath("buyer-settings.png"));
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
  test("generates the authenticator QR locally and keeps setup open after an invalid code", async ({
    page,
  }) => {
    await setup(page, {
      "GET /v1/2fa/backup-codes": {
        status: 400,
        json: { error: "2FA is not enabled" },
      },
      "POST /v1/2fa/setup": {
        json: {
          secret: "TEST-SETUP-KEY",
          otpauth_url:
            "otpauth://totp/ProxyHubb:test?secret=JBSWY3DPEHPK3PXP&issuer=ProxyHubb",
          qr_code: "https://external.invalid/private-secret",
        },
      },
      "POST /v1/2fa/enable": {
        status: 400,
        json: { error: "Invalid authenticator code" },
      },
    });
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("external.invalid"))
        externalRequests.push(request.url());
    });
    await page.goto(`${base}/app/settings?tab=security`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Set up authenticator", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: "Authenticator setup QR code" }),
    ).toBeVisible();
    await page.getByLabel("Authenticator code", { exact: true }).fill("000000");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Verify/ })
      .click();
    await expect(
      page.getByRole("dialog").getByText("Invalid authenticator code"),
    ).toBeVisible();
    expect(externalRequests).toHaveLength(0);
  });
});
