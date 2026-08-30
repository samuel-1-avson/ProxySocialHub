# Phase C — money loop — 20260820

| Field | Value |
|-------|-------|
| Host | proxyhubb-testnet / api.proxyhubb.com |
| Listing | `168d8720-610c-437a-b9ca-a718c781da1f` (aaaass) |
| Seller user | `109db666-730d-4e59-970b-9fafd518389c` |
| Buyer user | `b77e84c9-0e85-4f23-afc0-581cd561c216` |
| Buyer wallet | `62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE` (Phantom, devnet) |
| Seller wallet | `BHWyKN5Qixu1BXprTHpBGs1b5t7BxxPAC1GSQ3hPypBq` |
| Verdict | **C.1 CLOSED** (real Phantom buy, escrow funded on-chain, order active). C.2 observed via extension. C.3 code live. |

## C.1 Real Phantom / Devnet buy — CLOSED

Two attempts, same buyer/seller pair (legacy PDA is per buyer+seller, so both derive the same escrow PDA):

| When (UTC) | Order | What happened |
|------------|-------|---------------|
| 2026-08-19 22:08:05 | `edd30b39-dd82-47cd-a4bb-b0b4fa3530b0` | Order created → `pending_payment`. Buyer signed `initializeEscrow` (tx below) — escrow funded. `confirm-escrow` never ran → order stuck `pending_payment`. |
| 2026-08-20 21:27:39 | `277dfff5-40eb-4771-9b2c-4d1197bdde3d` | Order created → `pay/solana` derived same PDA → `escrow_already_funded=true` → `confirm-escrow` → **order `active`** → credentials issued. |

On-chain escrow `9CnRSRVpABngqgh1BqxJrF7MouupyexW6Rf4osGUvw96` (decoded from devnet, owner = program `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`):

| Field | Value |
|-------|-------|
| amount | 10,352,449 lamports = **0.010352449 SOL** ≈ $0.89 at ~$86/SOL — matches listing price (1 GB × $0.89) |
| status | Pending (funded, unsettled) |
| bandwidth | 1 GB limit / 0 used |
| createdAt | 2026-08-19T22:08:27Z |
| expiresAt | 2026-08-20T22:08:07Z |

**SOL price feed verified healthy**: live `/v1/system/config/public` → `sol_price_usd: 87.52`; CoinGecko direct → 87.53. The escrow amount above is economically correct. (An earlier read of the buy-modal screenshot as "$89,000/SOL, 0.000010 SOL" was a misread — disproven by the on-chain amount.)

## C.2 CONNECT — observed

- Extension paired against `api.proxyhubb.com` and connected to the active order (user screenshots: card "Extension installed and paired" → "Connected. HTTP CONNECT is on for this order"; popup signed-in with order selected).
- `connectOrder` throws unless the egress probe IP differs from the home IP, so the "Connected" state implies live proxied traffic.
- Listing `is_online` was `false` in the public payload earlier; the successful connect probe is the stronger signal.

## C.3 Failure paths

| Path | Status |
|------|--------|
| Self-purchase | Live: VM `orders.go` returns 400 `self_purchase_forbidden` (verified line 286). Test `TestCreateOrder_RejectsSelfPurchase` synced. |
| Wrong cluster | Live after web deploy this run (see below): shop RPC genesis check + zero-SOL precheck before `createOrder`; Devnet-specific wallet errors; modal states shop cluster. |
| Unfunded `pending_payment` timeout | **Deployed 2026-08-20 22:28 UTC** (`C3_CLEANER_DEPLOY_OK`, rollback tag `proxyhubb-control-api:pre-c3-cleaner-20260820-2224`). Cleaner logs `[EscrowCleaner] Started (Interval: 30m0s)`. Cancels only on account-not-found / empty / invalid PDA past `PROXYHUB_UNFUNDED_ESCROW_TIMEOUT` (unset → 2h default); RPC 429 does not cancel. Env invariants held (capability=enforce, no slash gates, edge-a untouched, public /metrics still 404). |
| Web (cluster checks + extension unpacked-ID UI) | **Deployed 2026-08-20 22:40 UTC** (rollback tag `proxyhubb-web:pre-c3-web-20260820-2234`, source backup `apps/web.bak-c3-20260820-2234`). Verified 22:42: bundle contains the cluster hint + unpacked-ID UI (standalone path `/app/app/.next`), container healthy, `/` 200, `/marketplace` 200, `/api/health` ok. Note: the deploy script's first verify pass used the wrong in-container path (`/app/.next`); fixed in `scripts/gcp-deploy-c3-web.sh`. |

## C.4 Signatures

- `initializeEscrow` tx: `4VCmTq6PjLs5SGfzRdASK9XLQdAQ22MVB3bfQbzyqJvrY3PmxiJqzRrMR7W6N9znA5fqTrZzM5vMM2CKk8iiRnj3` (2026-08-19 22:08:27 UTC, err=null)
- Escrow PDA: `9CnRSRVpABngqgh1BqxJrF7MouupyexW6Rf4osGUvw96`
- Order after confirm-escrow: `277dfff5-40eb-4771-9b2c-4d1197bdde3d` → `active`
- Note: today's buy did not produce a *new* `initializeEscrow` signature — the PDA was already funded from the 22:08 attempt, and `pay/solana` correctly short-circuited via `escrow_already_funded`.

## Watch items

1. **Escrow expired 2026-08-20 22:08:07 UTC.** The deployed cleaner scans every 30 min; on its next cycle it will `SettleEscrow(0 GB)` the expired Pending escrow — program accepts settle on Pending (`lib.rs:2432`) — refunding the full 0.010352449 SOL to buyer `62vwX11…` and transitioning both `edd30b39` and `277dfff5` toward `refunded`. Expected, not an incident; the buyer's test session may end.
2. `edd30b39` is **not** eligible for the unfunded-cancel path (its escrow exists and is funded) — it is cleared by the expiry refund instead, as designed.
3. Provider laptop: keep lid open for future C.2 reruns.

## Refund cycle — VERIFIED 2026-08-20 22:59 UTC

Cleaner cycle at 22:58 settled the expired escrow (verified on-chain):

- Escrow `9CnRSRVp…` status: Pending → **Settled**; account lamports 12,315,169 → 1,962,720 (exactly the 10,352,449-lamport escrow amount paid out; remainder is the rent reserve). `bandwidthUsedGb=0` → seller payout 0 → **buyer `62vwX11…` refunded in full**.
- Settle tx (success): `2uLQmRNjYsDGdhokNfe73qQMwpPN4bMHXLkbPDevNVBiqxQ8c7BFkZMHzahLQPoRvb6D76uRJweQi4LbEV6m1vhc` (22:58:31, err=null)
- Second tx (err=true): `fvMGDToDfp9TdrizXWNor389Dq22vkU9UFLBGTYsKABdbPU83J6XBv8oXxm8oC1fekAVtEeChk9boaDv2PLnYuq` (22:58:32) — expected: both orders share one legacy PDA; the second settle hits the already-Settled account and is rejected on-chain. One order lands `refunded`, the other records a `refund_failed` reconciliation row. Known edge of PDA reuse across orders.

## Follow-ups

1. ~~User: Phantom Devnet buy~~ — done (order `277dfff5` active).
2. ~~Deploy control-api unfunded cleaner~~ — done 22:28 UTC.
3. ~~Deploy web cluster checks~~ — done 22:40 UTC.
4. ~~Confirm cleaner cycle refunds escrow~~ — done 22:58 UTC (tx above).

## C.5 Escrow PDA reuse bug — found 2026-08-21, fix CLOSE01 in progress

**Found during a repeat-buy test (05:09 UTC).** Buyer `62vwX11…` attempted a new purchase from the same seller (`BHWyKN5…`) after the 22:58 refund. Order `ca57dcf4-9906-4e49-90f9-192bc97eae22` was created (1 GB, `0.009956371` SOL) and `pay/solana` returned 200, but `initializeEscrow` could never land: the legacy escrow PDA (`9CnRSRVp…`, seeds `[buyer, seller]`) still existed on-chain in `Settled` status holding its rent reserve (1,962,720 lamports), and the program's `init` constraint rejects re-initialization. Phantom showed "Simulation failed"; the user cancelled; no funds moved (buyer wallet still holds 5.885 SOL devnet). Order `ca57dcf4` was cancelled manually (the unfunded-cleaner correctly refused to touch it — the PDA *exists*).

**Root cause:** `settle_escrow` / `settle_escrow_multisig` never closed the escrow account, so every completed/refunded buyer+seller pair was permanently bricked for future purchases. (The session-escrow path already closed on settle via `close = buyer`; the legacy/multisig paths predated that pattern.)

**Red herring noted:** the buy modal briefly showed Phantom's own "Insufficient devnet SOL … 0.000000 SOL" error — that string is not in the web app, backend, or extension (verified by grepping source + deployed bundle); Phantom misread the balance while its devnet RPC was flaky ("Network connection lost" in the same popup; backend indexer was hitting RPC `-32429 max usage reached` around the same window).

**Fix (CLOSE01):**
- `SettleEscrow` + `SettleEscrowMultiSig`: added `close = buyer` — settle now sweeps buyer refund **and** the rent reserve to the buyer and closes the account, freeing the PDA (mirrors the existing `SettleSessionEscrow` pattern).
- New `close_escrow` instruction: closes terminal (`Settled`/`Refunded`) legacy escrows, callable by buyer/seller/admin — reclaims pre-fix stragglers like `9CnRSRVp…`.
- Backend Go instruction builders unchanged (buyer already writable in both settle account lists). Indexer unaffected (log-based). Only post-settle account read (`admin_payouts.IsEscrowSettled`) already degrades gracefully on not-found.
- Frontend: no change needed (minimal 0.26-format IDL; `Escrow` layout unchanged; buy flow only reads escrows pre-settle).
- Tests: new `tests/escrow_close_reinit.ts` (re-init after settle — the exact bug; close_escrow rejects pending escrows and strangers); updated post-settle assertions in `escrow_payout_binding.ts`, `critical_escrow_governance.ts`, `proxyhub.ts`, `live_escrow_settle_smoke.ts` to expect closed accounts.

**Deployment — DONE 2026-08-21 ~11:25 UTC:**
- Program `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` upgraded on devnet. Upgrade tx: `4RACYZEHZwodprefiRoSNukYS2m1MBcML96ps7dyr9w9aTKTAvvkvaAu99fNMcETLAYytdGjtWAoY7nFEccF63cF`, slot 486170450. Upgrade authority unchanged (`6thzwmrfi…`).
- On-chain programdata sha256 `54aa17ac60718cb63507d0e78ad1714f284d6e2f80bc28e5a3444f88a291bb58` == local Docker build; `CLOSE01` marker present on-chain.
- Deploy notes: public devnet RPC 429'd mid-write on the first attempt; recovered by closing the stale buffer (7.91 SOL rent reclaimed to oracle), then `write-buffer` to a persistent buffer keypair (`infra/secrets/buffer-close01.json`, buffer `F9gaUi6i…`) + final `program deploy --buffer`. An unrelated stale buffer (`5tCBq…`, pre-CLOSE01 bytes, writes stalled 10:29 UTC) was also closed and its rent reclaimed.
- Anchor suite (Docker): `escrow_close_reinit.ts` + updated settle tests green pre-deploy.

**Legacy cleanup — DONE 2026-08-21 ~11:45 UTC:** `scripts/ops/close-terminal-escrows/` closed **17/17** terminal legacy escrows (2 transient blockhash failures succeeded on retry). Bricked PDA `9CnRSRVp…` closed in tx `4sXuXVNNNdneyb3Jro5YKsDKDhkCBNVRgKFrYVxR5fCwSYZ7RCAzpXKHqCTKmru4vbKq3TJKvVCTvUYJzmNtSZbc`; account now `AccountNotFound` — buyer `62vwX11…` + seller `BHWyKN5…` pair is unbricked. 2 settled accounts skipped as multisig PDAs (seeds include `expires_at`; never collided). 4 pending escrows untouched. Script fix during run: status offset corrected to 96 (bw_limit/bw_used sit between amount and status).

**Remaining verification:** live re-init proof = user repeat-buy with the same Phantom wallet pair (next money-loop test).

## C.6 Shop settle close + integer-GiB money bug — 2026-08-22

Listing `168d8720-…` (aaaass). Buyer `62vwX11…` / seller `BHWyKN5…`. Session `ab5d020b-4bd2-483f-bbcc-64c7806b16fd` terminated 2026-08-21 22:40:29 UTC with **115,073,280 bytes (~0.107 GiB)**.

| Field | Value |
|-------|-------|
| Order | `bfb26245-c92e-4b8a-b63e-3aedd38a0c20` (status completed) |
| Escrow PDA | `9CnRSRVpABngqgh1BqxJrF7MouupyexW6Rf4osGUvw96` (legacy, closed on settle) |
| `initializeEscrow` | `5oktyaMJWYUZ5uM4VWkoZoPEtxVZxcZiEKzpVKsGnZcq5GogJY6GYRVmAv8dr1kXrYo3ZgiQAH6LEqeivCWvrNts` |
| `SettleEscrow` | `3Cq68xHfcikMUEipTpxijdKeqy1hPAMJPyXtcSBoWCuTrfanpns85VzUm9mxzcExfEgnd5ZUbuo18KSuxyd3oZ1v` (2026-08-22 07:16:20 UTC) |
| Lock | `0.009690767` SOL (`bandwidth_used_gb=1` on-chain → **full lock to seller**) |
| DB earning | `0.00126407` SOL paid on node `7baf6143-…` (actual bytes × listing price) |

Outbox `escrow_settle:bfb26245-…` succeeded after the money-loop API roll. Phantom was charged at **buy**, not at Stop Stream. Seller dashboards show the paid earning.

**Integer-GiB bug (this settle):** program pays `amount * used / limit` with `u64` GiB. API ceiled any `usedBytes < 1 GiB` to `used=1`, so a 0.107 GiB session took 100% of a 1 GiB lock. Buyer unused refund was **0**.

**Fix (no program upgrade):** `initializeEscrow` / settle now use **micro-GiB** (`1_000_000` units per GiB). Same session would settle `107170 / 1_000_000` ≈ 10.7% to seller and refund the rest. Legacy accounts with `limit < 1e6` still floor sub-GiB to 0 (cannot split a `limit=1` account). Already-settled order `bfb26245` is not retroactively adjusted.

