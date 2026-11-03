import { expect as baseExpect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { seedSignedAuth } from "./fixtures/signed-auth";

const expect = baseExpect.configure({ timeout: 30_000 });
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const node = {
  id: "seller-node-1",
  name: "Accra supply",
  country: "GH",
  city: "Accra",
  status: "offline",
  latest_heartbeat_verified: false,
  quality_score: 0,
  current_tier: "standard",
  base_price_per_gb: 0.99,
  uptime_percent: 0,
  active_connections: 0,
  created_at: "2026-10-28T12:00:00Z",
};
const offer = {
  id: "seller-offer-1",
  seller_id: "provider-route-policy-user",
  node_id: node.id,
  title: "Accra residential capacity",
  description: "Metered capacity",
  proxy_type: "residential",
  protocol: "http",
  country: "GH",
  status: "active",
  price_per_gb: 0.99,
  min_purchase_gb: 1,
  available_bandwidth_gb: 20,
  max_concurrency: 10,
  orders_count: 0,
};
// Deterministic test-only node key, derived at runtime from a public seed string
// so no key material is hardcoded in the repo. It can never protect real funds.
async function deriveBoundNodeKey() {
  const seed = createHash("sha256").update("proxyhubb-seller-e2e-node-key").digest();
  const { getPublicKeyAsync } = await import("@noble/ed25519");
  const pub = await getPublicKeyAsync(seed);
  return { secret: bs58.encode(seed), hotkey: bs58.encode(pub) };
}
async function setup(
  page: Page,
  options: {
    emptyNodes?: boolean;
    tokenFailure?: boolean;
    policyFailure?: boolean;
    pendingReview?: boolean;
    boundOffer?: boolean;
    proofRequired?: boolean;
  } = {},
) {
  const nodeKey = options.boundOffer ? await deriveBoundNodeKey() : null;
  const nodeFixture: typeof node & Partial<{ hotkey: string; gateway_node_id: string }> = { ...node };
  if (options.boundOffer && nodeKey) {
    nodeFixture.hotkey = nodeKey.hotkey;
    nodeFixture.gateway_node_id = "seller-gateway-1";
  }
  const offerFixture: typeof offer & Partial<{ provider_node_id: string }> = { ...offer };
  if (options.boundOffer) offerFixture.provider_node_id = node.id;
  let registered = options.emptyNodes ? [] : [nodeFixture];
  let listings = [offerFixture];
  let tokenFails = options.tokenFailure;
  let claimFails = true;
  let revoked = false;
  let settings = {
    auto_payout_enabled: false,
    auto_payout_threshold_lamports: 1_000_000_000,
    payable_lamports: 3_000_000_000,
  };
  const calls = {
    nodes: 0,
    tokens: 0,
    offers: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    payouts: [] as Record<string, unknown>[],
    settings: [] as Record<string, unknown>[],
    deletes: 0,
    protocol: 0,
  };
  await page.routeWebSocket("**/v1/ws**", (socket) => socket.close());
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace(/^\/api/, ""),
      method = request.method();
    const body = () => request.postDataJSON() as Record<string, unknown>;
    const send = (data: unknown, status = 200) =>
      route.fulfill({ status, json: data });
    if (path === "/v1/provider/nodes" && method === "GET")
      return send({ nodes: registered });
    if (path === "/v1/provider/nodes" && method === "POST") {
      calls.nodes++;
      registered = [{ ...node, ...body() } as typeof node];
      return send(registered[0], 201);
    }
    if (path === `/v1/provider/nodes/${node.id}/connect`)
      return send({
        node_id: node.id,
        control_api_url: "https://api.proxyhubb.test",
        gateway_tunnel_addr: "gateway.proxyhubb.test:3128",
        gateway_tunnel_addrs: [],
        use_tls: true,
        connection_type: "residential",
        config_path_hint: "provider.toml",
      });
    if (path === `/v1/provider/nodes/${node.id}/uptime`)
      return send({
        node_id: node.id,
        uptime_percent: 0,
        avg_latency_ms: 0,
        checks_24h: 0,
        current_status: "offline",
        last_seen: "",
      });
    if (path === "/v1/provider/tokens" && method === "POST") {
      calls.tokens++;
      expect(body().node_id).toBe(node.id);
      if (tokenFails) {
        tokenFails = false;
        return send({ error: "Connection token service unavailable" }, 503);
      }
      return send(
        {
          id: "token-1",
          name: "Supply token",
          token: "fixture-node-scoped-token",
          is_active: true,
          created_at: node.created_at,
        },
        201,
      );
    }
    if (path === "/v1/provider/tokens" && method === "GET")
      return send({
        tokens: [
          {
            id: "token-1",
            name: "Supply token",
            masked: "fixture…token",
            is_active: !revoked,
            created_at: node.created_at,
            last_used: node.created_at,
          },
        ],
      });
    if (path === "/v1/provider/tokens/token-1" && method === "DELETE") {
      calls.deletes++;
      revoked = true;
      return send({ message: "Revoked" });
    }
    if (path === "/v1/system/provider-proof-policy")
      return options.policyFailure
        ? send({ error: "Publication requirements unavailable" }, 503)
        : send(
            options.proofRequired
              ? {
                  required: true,
                  mode: "enforce",
                  dev_server_signing: false,
                }
              : {
                  required: false,
                  mode: "optional",
                  dev_server_signing: false,
                },
          );
    if (path === "/v1/suggest-price") return send({ suggested_price: 0.99 });
    if (path === "/v1/listings/my")
      return send({ listings, total: listings.length, page: 1, limit: 20 });
    if (path === "/v1/listings" && method === "POST") {
      const payload = body();
      calls.offers.push(payload);
      listings = [
        {
          ...offer,
          ...payload,
          status: options.pendingReview ? "pending_review" : "active",
        } as typeof offer,
      ];
      return send(listings[0], 201);
    }
    if (path === `/v1/listings/${offer.id}` && method === "PATCH") {
      const payload = body();
      calls.updates.push(payload);
      listings = [{ ...listings[0], ...payload } as typeof offer];
      return send({ listing: listings[0] });
    }
    if (path === "/v1/provider/earnings/summary")
      return send({
        total_earned_sol: 4,
        pending_sol: 3,
        paid_sol: 1,
        last_30_days_sol: 4,
        last_7_days_sol: 2,
      });
    if (path === "/v1/provider/earnings/history") return send({ payouts: [] });
    if (path === "/v1/provider/earnings/payout-settings" && method === "GET")
      return send(settings);
    if (path === "/v1/provider/earnings/payout-settings" && method === "PUT") {
      const payload = body();
      calls.settings.push(payload);
      settings = { ...settings, ...payload };
      return send(settings);
    }
    if (path === "/v1/provider/earnings/claim") {
      calls.payouts.push(body());
      if (claimFails) {
        claimFails = false;
        return send({ error: "Temporary payout response failure" }, 503);
      }
      return send({
        status: "pending",
        payout_id: "payout-1",
        amount_lamports: 3_000_000_000,
        amount_sol: 3,
      });
    }
    if (path === "/v1/provider/claim/summary")
      return send({
        pending_sol: 1,
        pending_count: 1,
        payout_wallet: "different-payout-wallet",
        min_claim_sol: 0.01,
        oracle_ready: true,
      });
    if (path === "/v1/provider/claim/prepare") {
      calls.protocol++;
      return send({ error: "Should not be called" }, 500);
    }
    return send({ error: `Not used in this fixture: ${path}` }, 503);
  });
  await seedSignedAuth(page, base, "provider");
  return Object.assign(calls, { nodeKey });
}

test.describe("seller workflow migration", () => {
  test.setTimeout(180_000);
  test.use({ actionTimeout: 30_000 });
  test("recovers token creation without duplicating a node, then shows the node-bound join command", async ({
    page,
  }, info) => {
    const calls = await setup(page, { emptyNodes: true, tokenFailure: true });
    await page.goto(`${base}/provider/nodes/new`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("textbox", { name: "Node name", exact: true })
      .fill("Accra supply");
    // Type to search, then pick from the list.
    const country = page.getByRole("combobox", { name: "Country", exact: true });
    await country.fill("gha");
    await page.getByRole("option", { name: /^Ghana/ }).click();
    await expect(country).toHaveValue("Ghana");
    await page
      .getByRole("button", { name: "Register node & continue" })
      .click();
    await expect(
      page.getByText("Connection token service unavailable"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry connection token" }).click();
    await expect(
      page.getByRole("heading", { name: "Connect Accra supply" }),
    ).toBeVisible();
    expect(calls.nodes).toBe(1);
    expect(calls.tokens).toBe(2);
    const joinBlock = page.locator("pre.ui-code", {
      hasText: "provider-node join",
    });
    await expect(joinBlock).toContainText(`--node-id ${node.id}`);
    await expect(joinBlock).toContainText("fixture-node-scoped-token");
    await expect(
      page.getByRole("button", { name: "Copy join command" }),
    ).toBeEnabled();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy join command" }).click();
    await expect(page.getByText("Join command copied")).toBeVisible();
    await expect(
      page.getByText("Waiting for a verified heartbeat"),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("seller-node-setup.png"),
      fullPage: true,
    });
  });
  test("opening a node does not create credentials or reuse another node’s legacy token", async ({
    page,
  }) => {
    const calls = await setup(page);
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "proxyhubb_provider_api_key",
        "another-node-token",
      ),
    );
    await page.goto(`${base}/provider/nodes/${node.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", {
        name: "Create connection token",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy join command" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Copy install command" }),
    ).toBeEnabled();
    await expect(
      page.getByText("Create a connection token above first."),
    ).toBeVisible();
    expect(calls.tokens).toBe(0);
    await expect(page.getByText("Not measured", { exact: true })).toHaveCount(
      2,
    );
  });
  test("reviews before publishing, preserves canonical offer fields, and respects pending review", async ({
    page,
  }, info) => {
    const calls = await setup(page, { pendingReview: true });
    await page.goto(`${base}/provider/listings/new`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("textbox", { name: "Offer title" })
      .fill("Accra residential capacity");
    await page
      .getByLabel("Available bandwidth (GB)", { exact: true })
      .fill("20");
    await expect(
      page.getByRole("button", { name: "Review listing" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Review listing" }).click();
    expect(calls.offers).toHaveLength(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("seller-offer-review.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Publish offer" }).click();
    await expect(page).toHaveURL(
      /\/provider\/listings\?submitted=pending_review/,
    );
    expect(calls.offers).toHaveLength(1);
    expect(calls.offers[0]).toMatchObject({
      provider_node_id: node.id,
      protocol: "http",
      rotation_type: "sticky",
      country: "GH",
      available_bandwidth_gb: 20,
    });
    await expect(
      page.getByText("Your offer is awaiting review."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resume offer" }),
    ).toHaveCount(0);
  });
  test("publishes an offer for several protocols and explains what is missing", async ({
    page,
  }) => {
    const calls = await setup(page);
    await page.goto(`${base}/provider/listings/new`, {
      waitUntil: "domcontentloaded",
    });
    const title = page.getByRole("textbox", { name: "Offer title" });
    await title.fill("Abc");
    await page
      .getByLabel("Available bandwidth (GB)", { exact: true })
      .fill("20");
    await expect(
      page.getByText("Offer title needs at least 5 characters."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review listing" }),
    ).toBeDisabled();
    await title.fill("Accra mixed protocols");
    await page.getByRole("checkbox", { name: "HTTP", exact: true }).uncheck();
    await expect(page.getByText("Choose at least one protocol.")).toBeVisible();
    await page.getByRole("checkbox", { name: "All" }).check();
    await expect(
      page.getByRole("checkbox", { name: "SOCKS5" }),
    ).toBeChecked();
    await page.getByRole("checkbox", { name: "HTTPS" }).uncheck();
    await page.getByRole("button", { name: "Review listing" }).click();
    await expect(page.getByText("HTTP · SOCKS5")).toBeVisible();
    await page.getByRole("button", { name: "Publish offer" }).click();
    await expect.poll(() => calls.offers.length).toBe(1);
    expect(calls.offers[0]).toMatchObject({ protocol: "http,socks5" });
  });
  test("picks a country from the list or by searching, and can clear it", async ({
    page,
  }) => {
    const calls = await setup(page);
    await page.goto(`${base}/provider/listings/new`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("textbox", { name: "Offer title" })
      .fill("Country picker offer");
    await page
      .getByLabel("Available bandwidth (GB)", { exact: true })
      .fill("20");
    const country = page.getByRole("combobox", { name: "Country", exact: true });
    // The node's country is the default.
    await expect(country).toHaveValue("Ghana");
    await country.click();
    const options = page.getByRole("listbox", { name: "Country" }).getByRole("option");
    await expect(options).toHaveCount(249);
    await country.fill("côte");
    await expect(options).toHaveCount(1);
    await country.fill("kenya");
    await page.keyboard.press("Enter");
    await expect(country).toHaveValue("Kenya");
    await country.fill("zzzz");
    await expect(page.getByText("No country matches")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(country).toHaveValue("Kenya");
    await page.getByRole("button", { name: "Review listing" }).click();
    await page.getByRole("button", { name: "Publish offer" }).click();
    await expect.poll(() => calls.offers.length).toBe(1);
    expect(calls.offers[0]).toMatchObject({ country: "KE" });
  });
  test("blocks publishing when publication policy cannot be loaded", async ({
    page,
  }) => {
    const calls = await setup(page, { policyFailure: true });
    await page.goto(`${base}/provider/listings/new`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("textbox", { name: "Offer title" })
      .fill("Accra residential capacity");
    await page
      .getByLabel("Available bandwidth (GB)", { exact: true })
      .fill("20");
    await expect(
      page.getByRole("button", { name: "Review listing" }),
    ).toBeDisabled();
    expect(calls.offers).toHaveLength(0);
  });
  test("edits and pauses an offer within the canonical seller workspace", async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`${base}/provider/listings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Edit offer" }).click();
    const modal = page.getByRole("dialog");
    const descriptionId = await modal.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    await expect(page.locator(`[id="${descriptionId}"]`)).toContainText('Changes are checked by the marketplace');
    await modal
      .getByRole("textbox", { name: "Offer title" })
      .fill("Updated Accra capacity");
    await modal.getByRole("button", { name: "Save offer" }).click();
    await expect(
      page.getByRole("heading", { name: "Updated Accra capacity" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause offer" }).click();
    await expect(
      page.getByRole("button", { name: "Resume offer" }),
    ).toBeVisible();
  });
  test("signs bound offer edits with the node's local key", async ({
    page,
  }) => {
    const calls = await setup(page, { boundOffer: true, proofRequired: true });
    await page.addInitScript(
      ({ key, secret }: { key: string; secret: string }) =>
        localStorage.setItem(key, secret),
      {
        key: `proxyhubb_provider_signing_key_${node.id}`,
        secret: calls.nodeKey!.secret,
      },
    );
    await page.goto(`${base}/provider/listings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Edit offer" }).click();
    const modal = page.getByRole("dialog");
    await modal
      .getByRole("textbox", { name: "Offer title" })
      .fill("Signed Accra capacity");
    await modal.getByRole("button", { name: "Save offer" }).click();
    await expect(
      page.getByRole("heading", { name: "Signed Accra capacity" }),
    ).toBeVisible();
    expect(calls.updates).toHaveLength(1);
    const proof = calls.updates[0].proof as Record<string, unknown>;
    expect(proof.provider_hotkey).toBe(calls.nodeKey!.hotkey);
    expect(proof.payload_hash).toBeTruthy();
    expect(proof.signature).toBeTruthy();
  });
  test("blocks bound offer edits until the node key is available", async ({
    page,
  }) => {
    const calls = await setup(page, { boundOffer: true, proofRequired: true });
    await page.goto(`${base}/provider/listings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Edit offer" }).click();
    const modal = page.getByRole("dialog");
    await expect(
      modal.getByRole("heading", { name: "signing key" }),
    ).toBeVisible();
    await expect(
      modal.getByRole("button", { name: "Save offer" }),
    ).toBeDisabled();
    await modal
      .getByPlaceholder("Paste provider_signing_key from provider.toml")
      .fill(calls.nodeKey!.secret);
    await modal
      .getByRole("button", { name: "Save key in this browser" })
      .click();
    await expect(
      modal.getByRole("button", { name: "Save offer" }),
    ).toBeEnabled();
    await modal
      .getByRole("textbox", { name: "Offer title" })
      .fill("Recovered Accra capacity");
    await modal.getByRole("button", { name: "Save offer" }).click();
    await expect(
      page.getByRole("heading", { name: "Recovered Accra capacity" }),
    ).toBeVisible();
    expect(calls.updates).toHaveLength(1);
    const proof = calls.updates[0].proof as Record<string, unknown>;
    expect(proof.provider_hotkey).toBe(calls.nodeKey!.hotkey);
    expect(proof.signature).toBeTruthy();
  });
  test("create flow moves on right after a key replaces a wrong one, without reloading", async ({
    page,
  }) => {
    const calls = await setup(page, { boundOffer: true, proofRequired: true });
    // Another node's key was saved last, so it sits in the legacy global slot.
    await page.addInitScript(() =>
      localStorage.setItem(
        "proxyhubb_provider_signing_key",
        "3" + "1".repeat(43),
      ),
    );
    await page.goto(`${base}/provider/listings/new`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("textbox", { name: "Offer title" })
      .fill("Accra recovered key");
    await page
      .getByLabel("Available bandwidth (GB)", { exact: true })
      .fill("20");
    await page.getByRole("button", { name: "Review listing" }).click();
    const publish = page.getByRole("button", { name: "Publish offer" });
    // That other key does not belong to this node, so signing is blocked.
    await expect(publish).toBeDisabled();
    await page
      .getByPlaceholder("Paste provider_signing_key from provider.toml")
      .fill(calls.nodeKey!.secret);
    await page.getByRole("button", { name: "Save key in this browser" }).click();
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect.poll(() => calls.offers.length).toBe(1);
    const proof = calls.offers[0].proof as Record<string, unknown>;
    expect(proof.provider_hotkey).toBe(calls.nodeKey!.hotkey);
  });
  test("revokes credentials only after the in-app review and clears stale connection tokens", async ({
    page,
  }) => {
    const calls = await setup(page);
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "proxyhubb_provider_api_key_seller-node-1",
        "stale-token",
      ),
    );
    await page.goto(`${base}/provider/nodes/credentials`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Revoke…" }).click();
    expect(calls.deletes).toBe(0);
    await page
      .getByRole("button", { name: "Revoke token", exact: true })
      .click();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    expect(calls.deletes).toBe(1);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("proxyhubb_provider_api_key_seller-node-1"),
      ),
    ).toBeNull();
  });
  test("retries a payout with the same idempotency key and saves exact threshold amounts", async ({
    page,
  }, info) => {
    const calls = await setup(page);
    await page.goto(`${base}/provider/earnings?tab=payouts`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Request payable payout" }).click();
    await expect(
      page.getByText("Temporary payout response failure"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Request payable payout" }).click();
    await expect(
      page.getByRole("button", { name: "Payout request accepted" }),
    ).toBeDisabled();
    expect(calls.payouts).toHaveLength(2);
    expect(calls.payouts[0].idempotency_key).toBeTruthy();
    expect(calls.payouts[1].idempotency_key).toBe(
      calls.payouts[0].idempotency_key,
    );
    await page
      .getByRole("checkbox", { name: "Enable automatic account payouts" })
      .check();
    await page.getByLabel("Payout threshold (SOL)").fill("0.000000001");
    await page.getByRole("button", { name: "Save payout settings" }).click();
    await expect.poll(() => calls.settings.length).toBe(1);
    expect(calls.settings[0]).toEqual({
      auto_payout_enabled: true,
      auto_payout_threshold_lamports: 1,
    });
    await expect(
      page.getByRole("button", { name: "Authorize protocol payout" }),
    ).toBeDisabled();
    expect(calls.protocol).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("seller-payout-controls.png"),
      fullPage: true,
    });
  });
  test("keeps long node details usable at 320px and preserves legacy setup redirects", async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`${base}/dashboard/provider/setup`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(`${base}/provider/nodes/new`);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${base}/provider/nodes/${node.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: node.name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("navigation", { name: "Mobile primary" }),
    ).toBeVisible();
  });
});
