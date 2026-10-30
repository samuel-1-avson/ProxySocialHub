import { test, expect as baseExpect, type Page } from "@playwright/test";
import { Keypair, Transaction, SystemInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { verifyAsync } from "@noble/ed25519";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const expect = baseExpect.configure({ timeout: 30_000 });
const treasury = Keypair.generate().publicKey;
type State = {
  balance: number;
  available: boolean;
  broadcasts: number;
  loseBroadcast: boolean;
  loseWithdrawal: boolean;
  completed: boolean;
  opsRequired: boolean;
  depositBodies: Record<string, unknown>[];
  withdrawalBodies: Record<string, unknown>[];
  signatures: string[];
  chainFailure: boolean;
  wrongNetwork: boolean;
  badChallenge: boolean;
  cooldown: boolean;
};
async function setup(
  page: Page,
  connected = true,
  linkedOverride?: string,
  buyerOverride?: Keypair,
) {
  const buyer = buyerOverride ?? Keypair.generate();
  const address = buyer.publicKey.toBase58();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const state: State = {
    balance: 2.5,
    available: true,
    broadcasts: 0,
    loseBroadcast: false,
    loseWithdrawal: false,
    completed: false,
    opsRequired: false,
    depositBodies: [],
    withdrawalBodies: [],
    signatures: [],
    chainFailure: false,
    wrongNetwork: false,
    badChallenge: false,
    cooldown: false,
  };
  if (connected)
    await page.addInitScript((secret) => {
      window.__PLAYWRIGHT_SOLANA_TEST_WALLET__ = true;
      window.__PLAYWRIGHT_SOLANA_WALLET_SECRET__ = secret;
    }, Buffer.from(buyer.secretKey).toString("base64"));
  await seedSignedAuth(page, base, "buyer");
  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (ws) => ws.close(),
  );
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON();
    let result: unknown;
    switch (body.method) {
      case "getGenesisHash":
        result = state.wrongNetwork
          ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
          : "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
        break;
      case "getBalance":
        result = { context: { slot: 1 }, value: 15_000_000_000 };
        break;
      case "getLatestBlockhash":
        result = {
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 1_000 },
        };
        break;
      case "getBlockHeight":
        result = 500;
        break;
      case "getSignatureStatuses":
        result = {
          context: { slot: 1 },
          value: [
            {
              slot: 1,
              confirmations: 1,
              err: state.chainFailure
                ? { InstructionError: [0, "InsufficientFunds"] }
                : null,
              confirmationStatus: "confirmed",
            },
          ],
        };
        break;
      case "sendTransaction": {
        const tx = Transaction.from(Buffer.from(body.params[0], "base64"));
        const transfer = SystemInstruction.decodeTransfer(tx.instructions[0]);
        expect(transfer.fromPubkey.toBase58()).toBe(address);
        expect(transfer.toPubkey.toBase58()).toBe(treasury.toBase58());
        expect(transfer.lamports).toBe(100_000_000n);
        const signature = bs58.encode(tx.signature!);
        state.signatures.push(signature);
        state.broadcasts++;
        if (state.loseBroadcast) return route.abort("failed");
        result = signature;
        break;
      }
      default:
        throw new Error(`Unexpected test RPC method: ${body.method}`);
    }
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
  });
  let challengeNumber = 0;
  let challenge = {
    message: "",
    nonce: "",
    destination: address,
    amount_lamports: 200_000_000,
    expires_in_secs: 300,
  };
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/v1/auth/")) return route.fallback();
    const body = request.postDataJSON();
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === "/v1/wallet")
      return json({
        wallet: {
          id: "automatic-wallet",
          linked_solana_address: linkedOverride ?? address,
          balance_sol: state.balance,
          solana_network: "devnet",
          created_at: "2026-10-30T00:00:00Z",
        },
      });
    if (path === "/v1/system/config/public")
      return json({ treasury_solana: treasury.toBase58() });
    if (path === "/v1/wallet/withdrawal-security")
      return json({ withdrawal_cooldown_active: state.cooldown });
    if (path === "/v1/orders") return json({ orders: [] });
    if (path === "/v1/notifications/unread-count") return json({ count: 0 });
    if (path === "/v1/wallet/deposit/crypto") {
      state.depositBodies.push(body);
      if (!state.available)
        return route.fulfill({
          status: 503,
          json: { error: "Verification temporarily unavailable" },
        });
      state.balance = 2.6;
      return json({ status: "success", credited: 0.1, new_balance: 2.6 });
    }
    if (path === "/v1/wallet/withdraw/challenge") {
      expect(body.amount_lamports).toBe(challenge.amount_lamports);
      const nonce = `server-withdrawal-nonce-${++challengeNumber}`;
      challenge = {
        ...challenge,
        nonce,
        message: `Withdraw 200000000 lamports to ${address}; ${nonce}`,
      };
      return json({
        ...challenge,
        amount_lamports: state.badChallenge ? 200_000_001 : 200_000_000,
      });
    }
    if (path === "/v1/wallet/withdraw/sol") {
      state.withdrawalBodies.push(body);
      expect(body.amount_lamports).toBe(200_000_000);
      expect(body.challenge_nonce).toBe(challenge.nonce);
      expect(
        await verifyAsync(
          bs58.decode(body.signature),
          new TextEncoder().encode(challenge.message),
          buyer.publicKey.toBytes(),
        ),
      ).toBe(true);
      if (state.loseWithdrawal) return route.abort("failed");
      return json({
        status: "requested",
        reference: "withdrawal-original",
        new_balance: 2.3,
      });
    }
    if (path === "/v1/wallet/withdrawals")
      return json({
        withdrawals: [
          {
            id: "withdrawal",
            reference: "withdrawal-original",
            amount_sol: 0.2,
            destination: address,
            status: state.opsRequired
              ? "ops_required"
              : state.completed
                ? "completed"
                : "requested",
            tx_hash: state.completed
              ? bs58.encode(new Uint8Array(64).fill(3))
              : undefined,
            created_at: "2026-10-30T00:00:00Z",
          },
        ],
      });
    if (path === "/v1/wallet/transactions")
      return json({ transactions: [], next_cursor: "" });
    return route.fulfill({
      status: 503,
      json: { error: "Not used in this wallet test" },
    });
  });
  return { state, address };
}
async function deposit(page: Page, doubleClick = false) {
  await page.goto(`${base}/app/wallet?tab=funds`);
  await page.getByLabel("Deposit amount (SOL)").fill("0.1");
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const confirm = page.getByRole("button", {
    name: "Confirm deposit in wallet",
    exact: true,
  });
  if (doubleClick) await confirm.dblclick();
  else await confirm.click();
}
async function withdrawal(page: Page) {
  await page.goto(`${base}/app/wallet?tab=funds&action=withdraw`);
  await page.getByLabel("Withdrawal amount (SOL)").fill("0.2");
  await expect(
    page.getByRole("button", { name: "Review withdrawal", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm withdrawal in wallet", exact: true })
    .click();
}
test.describe("automatic wallet transfers", () => {
  test.setTimeout(150_000);
  test("signs a deposit and credits it automatically without a signature input", async ({
    page,
  }) => {
    const { state } = await setup(page);
    await deposit(page, true);
    await expect(
      page.getByText("0.1 SOL added to your account funds.", { exact: true }),
    ).toBeVisible();
    // The connected wallet is remembered so the workspace restores the same
    // wallet after navigation instead of asking for a fresh connection.
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("proxyhubb:wallet-name")),
      )
      .toBe("Playwright Devnet Wallet");
    expect(state.broadcasts).toBe(1);
    expect(state.depositBodies).toHaveLength(1);
    expect(state.depositBodies[0]).toMatchObject({
      tx_hash: state.signatures[0],
      amount_lamports: 100_000_000,
    });
    await expect(
      page.getByRole("textbox", { name: /signature|transaction reference/i }),
    ).toHaveCount(0);
    await expect(page.getByText("2.6 SOL", { exact: true })).toBeVisible();
  });
  test("recovers an accepted deposit after a lost broadcast response and reload without paying twice", async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.loseBroadcast = true;
    state.available = false;
    await deposit(page);
    await expect(
      page.getByText(/Confirmation is taking longer than usual/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeDisabled();
    state.available = true;
    await page.reload();
    await expect(
      page.getByText("0.1 SOL added to your account funds.", { exact: true }),
    ).toBeVisible();
    expect(state.broadcasts).toBe(1);
    expect(state.depositBodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(state.depositBodies.map((body) => body.tx_hash))).toEqual(
      new Set(state.signatures),
    );
    await expect(page.getByRole("textbox", { name: /signature/i })).toHaveCount(
      0,
    );
  });
  test("approves a withdrawal through the wallet and follows its exact payout automatically", async ({
    page,
  }) => {
    const { state } = await setup(page);
    await withdrawal(page);
    await expect(
      page.getByText("Withdrawal is processing", { exact: true }),
    ).toBeVisible();
    expect(state.withdrawalBodies).toHaveLength(1);
    await expect(page.getByRole("textbox", { name: /signature/i })).toHaveCount(
      0,
    );
    await page.addInitScript(() => {
      window.__PLAYWRIGHT_SOLANA_TEST_WALLET__ = false;
      localStorage.removeItem("walletName");
    });
    await page.reload();
    await expect(
      page.getByText("Withdrawal is processing", { exact: true }),
    ).toBeVisible();
    state.completed = true;
    await page
      .getByRole("button", { name: "Check withdrawal status", exact: true })
      .click();
    await expect(
      page.getByText(
        "Withdrawal completed. SOL has been sent to your linked wallet.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(state.withdrawalBodies).toHaveLength(1);
  });
  test("a withdrawal retry after reload preserves its original idempotency key", async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.loseWithdrawal = true;
    await withdrawal(page);
    await expect(
      page.getByText("Resume your previous withdrawal", { exact: true }),
    ).toBeVisible();
    const original = state.withdrawalBodies[0].idempotency_key;
    await page.reload();
    await expect(page.getByLabel("Withdrawal amount (SOL)")).toHaveValue("0.2");
    state.loseWithdrawal = false;
    await page
      .getByRole("button", { name: "Resume withdrawal", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Confirm withdrawal in wallet",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Withdrawal is processing", { exact: true }),
    ).toBeVisible();
    expect(state.withdrawalBodies).toHaveLength(2);
    expect(state.withdrawalBodies[1].idempotency_key).toBe(original);
    expect(state.withdrawalBodies[1].challenge_nonce).not.toBe(
      state.withdrawalBodies[0].challenge_nonce,
    );
  });
  test("a queued withdrawal that needs review stays saved and shows its real status", async ({
    page,
  }) => {
    const { state } = await setup(page);
    await withdrawal(page);
    await expect(
      page.getByText("Withdrawal is processing", { exact: true }),
    ).toBeVisible();
    state.opsRequired = true;
    await page
      .getByRole("button", { name: "Check withdrawal status", exact: true })
      .click();
    await expect(
      page.getByText("Withdrawal needs review", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Withdrawal needs review", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review withdrawal", exact: true }),
    ).toBeDisabled();
    expect(state.withdrawalBodies).toHaveLength(1);
  });
  test("a failed on-chain deposit does not credit the account or require a pasted reference", async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.chainFailure = true;
    await deposit(page);
    await expect(page.getByText(/The deposit failed on chain/)).toBeVisible();
    expect(state.depositBodies).toHaveLength(0);
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeEnabled();
  });
  test("the wrong network is rejected before a payment is broadcast", async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.wrongNetwork = true;
    await deposit(page);
    await expect(page.getByText(/Wrong Solana network/)).toBeVisible();
    expect(state.broadcasts).toBe(0);
    expect(state.depositBodies).toHaveLength(0);
  });
  test("a changed withdrawal challenge never submits a payout", async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.badChallenge = true;
    await withdrawal(page);
    await expect(page.getByText(/withdrawal details changed/)).toBeVisible();
    expect(state.withdrawalBodies).toHaveLength(0);
  });
  test("withdrawal security holds remain visible and cannot be bypassed by the streamlined form", async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.cooldown = true;
    await page.goto(`${base}/app/wallet?tab=funds&action=withdraw`);
    await page.getByLabel("Withdrawal amount (SOL)").fill("0.2");
    await expect(
      page.getByText(/withdrawal address changed recently/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review withdrawal", exact: true }),
    ).toBeDisabled();
    expect(state.withdrawalBodies).toHaveLength(0);
  });
  test("shows wallet connection in the funding flow and disables transfers until connected", async ({
    page,
  }) => {
    const { state } = await setup(page, false);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${base}/app/wallet?tab=funds`);
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Deposit amount (SOL)").fill("0.1");
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.broadcasts).toBe(0);
  });
  test("funding forms and review dialogs fit both themes and a narrow screen", async ({
    page,
  }, testInfo) => {
    const { state } = await setup(page);
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(`${base}/app/wallet?tab=funds`);
      await page
        .getByRole("combobox", { name: "Color theme", exact: true })
        .selectOption(theme);
      await page.getByLabel("Deposit amount (SOL)").fill("0.1");
      await expect(
        page.getByRole("button", { name: "Review deposit", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`wallet-deposit-${theme}.png`),
        fullPage: true,
      });
      await testInfo.attach(`wallet-deposit-${theme}`, {
        path: testInfo.outputPath(`wallet-deposit-${theme}.png`),
        contentType: "image/png",
      });
      await page
        .getByRole("button", { name: "Review deposit", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Review account deposit" }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`wallet-review-${theme}.png`),
      });
      await testInfo.attach(`wallet-review-${theme}`, {
        path: testInfo.outputPath(`wallet-review-${theme}.png`),
        contentType: "image/png",
      });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(`${base}/app/wallet?tab=funds&action=withdraw`);
      await page.getByLabel("Withdrawal amount (SOL)").fill("0.2");
      await page
        .getByRole("button", { name: "Review withdrawal", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Review account withdrawal",
      });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`wallet-mobile-${theme}.png`),
        fullPage: true,
      });
      await testInfo.attach(`wallet-mobile-${theme}`, {
        path: testInfo.outputPath(`wallet-mobile-${theme}.png`),
        contentType: "image/png",
      });
      await page.keyboard.press("Escape");
    }
    expect(state.broadcasts).toBe(0);
    expect(state.withdrawalBodies).toHaveLength(0);
  });
  test("shows the different connected wallet and keeps deposits disabled until it matches", async ({
    page,
  }) => {
    const other = Keypair.generate().publicKey.toBase58();
    const { address } = await setup(page, true, other);
    await page.goto(`${base}/app/wallet?tab=funds`);
    await expect(page.getByText(/A different wallet is connected/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disconnect & reconnect", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Link this wallet", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Deposit amount (SOL)").fill("0.1");
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Connect your linked wallet above to enable deposit review."),
    ).toBeVisible();
    expect(address).not.toBe(other);
  });
  test("a rejected wallet connection is shown next to the connect control", async ({
    page,
  }) => {
    await setup(page, false);
    // Fake installed Phantom/Solflare extensions whose user declines the
    // connection request, standing in for the real extension boundary.
    await page.addInitScript(() => {
      const rejecting = {
        isConnected: false,
        publicKey: null,
        connect: async () => {
          throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        },
        disconnect: async () => undefined,
        on: () => undefined,
        off: () => undefined,
        signMessage: async () => {
          throw new Error("not connected");
        },
        signTransaction: async (tx: unknown) => tx,
        signAndSendTransaction: async () => {
          throw new Error("not connected");
        },
      };
      (window as unknown as Record<string, unknown>).isPhantomInstalled = true;
      (window as unknown as Record<string, unknown>).phantom = {
        solana: { ...rejecting, isPhantom: true },
      };
      (window as unknown as Record<string, unknown>).solflare = {
        ...rejecting,
        isSolflare: true,
      };
    });
    await page.goto(`${base}/app/wallet?tab=funds`);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    const picker = page.getByRole("dialog", { name: "Choose a wallet" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /Phantom/ }).first().click();
    await expect(
      page.getByText(/You declined the request in your wallet/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }).first(),
    ).toBeVisible();
  });
  test("the installed sign-in wallet reconnects in the workspace without a click", async ({
    page,
  }) => {
    const buyer = Keypair.generate();
    await setup(page, false, undefined, buyer);
    // Fake installed Phantom that approves the connection, standing in for
    // the real extension boundary. It is the only installed wallet, so the
    // workspace must restore it on its own: the sign-in wallet is the
    // transaction wallet without a second manual connection.
    await page.addInitScript((pubkeyBytes: number[]) => {
      const bytes = new Uint8Array(pubkeyBytes);
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const phantom = {
        isPhantom: true,
        isConnected: false,
        publicKey: null as unknown,
        connect: async () => {
          phantom.isConnected = true;
          phantom.publicKey = { toBytes: () => bytes.slice() };
          return { publicKey: phantom.publicKey };
        },
        disconnect: async () => {
          phantom.isConnected = false;
          phantom.publicKey = null;
        },
        on: (event: string, fn: (...args: unknown[]) => void) => {
          (listeners[event] = listeners[event] || []).push(fn);
        },
        off: (event: string, fn: (...args: unknown[]) => void) => {
          listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
        },
        signTransaction: async (tx: unknown) => tx,
        signAllTransactions: async (txs: unknown) => txs,
      };
      (window as unknown as Record<string, unknown>).isPhantomInstalled = true;
      (window as unknown as Record<string, unknown>).phantom = {
        solana: phantom,
      };
    }, Array.from(buyer.publicKey.toBytes()));
    await page.goto(`${base}/app/wallet?tab=funds`);
    // No clicks: the connect prompt must clear by itself once restored.
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeHidden({ timeout: 20_000 });
    await page.getByLabel("Deposit amount (SOL)").fill("0.1");
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("proxyhubb:wallet-name")),
      )
      .toBe("Phantom");
  });
  test("a hung wallet connection times out visibly and recovers on retry", async ({
    page,
  }) => {
    const buyer = Keypair.generate();
    await setup(page, false, undefined, buyer);
    // Fake installed Phantom whose first connection never settles (the
    // real failure: later attempts then resolve silently without ever
    // connecting or erroring). Approving "in the extension" unblocks it.
    await page.addInitScript((pubkeyBytes: number[]) => {
      (window as unknown as Record<string, unknown>).__PROXYHUBB_WALLET_CONNECT_TIMEOUT_MS__ = 2000;
      const bytes = new Uint8Array(pubkeyBytes);
      const phantom = {
        isPhantom: true,
        isConnected: false,
        publicKey: null as unknown,
        connect: async () => {
          const w = window as unknown as Record<string, unknown>;
          for (let i = 0; i < 600 && !w.__PHANTOM_APPROVE__; i++) {
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!w.__PHANTOM_APPROVE__) {
            await new Promise(() => undefined);
          }
          phantom.isConnected = true;
          phantom.publicKey = { toBytes: () => bytes.slice() };
          return { publicKey: phantom.publicKey };
        },
        disconnect: async () => {
          phantom.isConnected = false;
          phantom.publicKey = null;
        },
        on: () => undefined,
        off: () => undefined,
        signTransaction: async (tx: unknown) => tx,
        signAllTransactions: async (txs: unknown) => txs,
      };
      (window as unknown as Record<string, unknown>).isPhantomInstalled = true;
      (window as unknown as Record<string, unknown>).phantom = {
        solana: phantom,
      };
    }, Array.from(buyer.publicKey.toBytes()));
    await page.goto(`${base}/app/wallet?tab=funds`);
    const connectButton = page.getByRole("button", {
      name: "Connect wallet",
      exact: true,
    });
    await expect(connectButton.first()).toBeVisible({ timeout: 15_000 });
    await connectButton.first().click();
    // Automatic restore may already have selected the wallet (direct
    // attempt) or left the choice to the picker; either path must go
    // through the budgeted connect.
    const picker = page.getByRole("dialog", { name: "Choose a wallet" });
    if (await picker.isVisible()) {
      await expect(picker.getByText("Detected").first()).toBeVisible({
        timeout: 15_000,
      });
      await picker.getByRole("button", { name: /Phantom/ }).first().click();
    }
    // The hung attempt must surface a timeout, not stick on Connecting.
    await expect(page.getByText(/did not respond/)).toBeVisible({
      timeout: 20_000,
    });
    // Approve in the "extension": the wallet must connect by itself on the
    // restored session, or at worst after one more click.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__PHANTOM_APPROVE__ = true;
    });
    try {
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeHidden({ timeout: 15_000 });
    } catch {
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .first()
        .click();
      const retry = page.getByRole("dialog", { name: "Choose a wallet" });
      if (await retry.isVisible()) {
        await retry.getByRole("button", { name: /Phantom/ }).first().click();
      }
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeHidden({ timeout: 20_000 });
    }
    await page.getByLabel("Deposit amount (SOL)").fill("0.1");
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeEnabled();
  });
  test("a wallet picked in the dialog connects and enables deposit review", async ({
    page,
  }) => {
    const buyer = Keypair.generate();
    await setup(page, false, undefined, buyer);
    // No wallet at load, so nothing auto-selects and the picker path is
    // genuinely exercised. The extension "arrives" after the picker opens,
    // like a slow browser injection.
    await page.goto(`${base}/app/wallet?tab=funds`);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    const picker = page.getByRole("dialog", { name: "Choose a wallet" });
    await expect(picker).toBeVisible();
    await page.evaluate((pubkeyBytes: number[]) => {
      const bytes = new Uint8Array(pubkeyBytes);
      const phantom = {
        isPhantom: true,
        isConnected: false,
        publicKey: null as unknown,
        connect: async () => {
          phantom.isConnected = true;
          phantom.publicKey = { toBytes: () => bytes.slice() };
          return { publicKey: phantom.publicKey };
        },
        disconnect: async () => {
          phantom.isConnected = false;
          phantom.publicKey = null;
        },
        on: () => undefined,
        off: () => undefined,
        signTransaction: async (tx: unknown) => tx,
        signAllTransactions: async (txs: unknown) => txs,
      };
      (window as unknown as Record<string, unknown>).isPhantomInstalled = true;
      (window as unknown as Record<string, unknown>).phantom = {
        solana: phantom,
      };
    }, Array.from(buyer.publicKey.toBytes()));
    await expect(picker.getByText("Detected").first()).toBeVisible({
      timeout: 15_000,
    });
    await picker.getByRole("button", { name: /Phantom/ }).first().click();
    // Must leave "Connecting" and match the linked wallet, not stick.
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeHidden({ timeout: 20_000 });
    await page.getByLabel("Deposit amount (SOL)").fill("0.1");
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("proxyhubb:wallet-name")),
      )
      .toBe("Phantom");
  });
});
