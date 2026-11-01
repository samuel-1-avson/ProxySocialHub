# Mainnet cutover scope (separate project)

Status: DRAFT for user decisions. Nothing here executes a cutover; it scopes
the work, cost drivers, risks, and decisions required before real SOL moves.

## Where settlement stands today (verified Nov 2026)

- Cluster: devnet everywhere (`SOLANA_NETWORK=devnet`,
  `NEXT_PUBLIC_SOLANA_NETWORK=devnet`, public RPC endpoints). Test SOL only;
  the web banner says so and auto-hides on mainnet.
- Escrow program `AZGh...QLfvu` (devnet) with 4 instructions
  (`initializeEscrow`, `initializeEscrowMultisig`, `settleEscrow`,
  `refundEscrow`). Clients + IDL (`apps/web/src/lib/idl/proxyhub.json`) are in
  the repo.
- **`programs/proxyhub` source is not in this repo and never was** (no git
  history). Only `gateway-bond` and `reputation` have Anchor source. The
  devnet escrow binary cannot be rebuilt, diffed, or independently audited
  from this repo.
- Hot payouts already sign via GCP KMS (`USE_GCP_KMS_HOT=true`, no file
  keypair). Oracle/hot/cold split and vault PDA model exist in config.
- `APP_ENV` is unset in production, so BC-08 custody checks log warnings
  instead of enforcing. Nothing fails closed on custody misconfig today.
- SOL/USD comes from CoinGecko free tier only, with no API keys configured
  (deploy logs warn). A circuit breaker exists but has never seen mainnet
  volatility. One price source = one failure/manipulation point.
- Deposit verification already hit public-RPC rate limits once (PR #87).
  RPC failover lists and WS derivation exist but point at public endpoints.
- Deposit watcher polls (10s) with durable watermarks; withdrawal holds and
  pending-payment recovery exist and must be preserved through cutover.
- `scripts/ops-mainnet-preflight.ts` is self-asserting (compares constants to
  themselves, always passes). It verifies nothing live and must be rebuilt.
- Multisig settlement client code exists; no mainnet multisig set is defined.

## Workstreams

### 1. Escrow program: source, audit, verifiable build, deploy
- Recover the `proxyhub` program source (other team?) or rewrite from the IDL
  as a clean-room implementation. No mainnet without source in-repo.
- External audit of the program + settlement-adjacent Go
  (`internal/solana`: escrow_init, settlement, watcher, velocity, multisig).
- Verifiable build (`anchor build --verifiable`) pinned to the audited commit.
- Fresh mainnet keypair; upgrade authority to a multisig from day one (never
  a single hot key). Initialize `program_state`, `deposit_vault` PDAs;
  verify executable + owner on-chain. Publish IDL Hiero + checksums.

### 2. Treasury and custody ceremony
- Generate oracle / hot / cold keys (KMS HSM for oracle + hot; cold offline).
  Record pubkeys; set `SOLANA_TREASURY_HOT_ADDRESS`,
  `SOLANA_TREASURY_COLD_ADDRESS`, `SOLANA_DEPOSIT_VAULT_ADDRESS` (vault PDA).
- Tune mainnet floats (`HOT_MIN_BALANCE` 100+ per current guidance,
  `HOT_MAX_BALANCE`, vault top-up caps, reserve floor) and the hot→cold
  sweep proposal flow.
- Set `APP_ENV=production` so BC-08 custody separation enforces (fail
  closed). Verify the API refuses to boot on misconfig (distinctness,
  vault-vs-hot).
- Retire every devnet key from all systems; rotate anything that ever touched
  a shared/CI environment.

### 3. Price oracle hardening
- Paid CoinGecko + CoinMarketCap keys (both, for failover), plus a second
  independent source (Pyth or Jupiter) with cross-source deviation checks.
- Mainnet circuit-breaker thresholds (deviation %, stale-after, OPEN
  behavior: halt quotes, never settle on stale prices).
- Load/latency test the quote path at expected order volume.

### 4. Paid RPC + websocket
- Primary + secondary paid endpoints (Helius/QuickNode class) in
  `SOLANA_RPC_ENDPOINTS`, mainnet WS endpoint, no public fallback on mainnet.
- Re-run deposit verification, escrow init/settle/refund, and the watcher
  against mainnet RPC latency/rate limits (devnet timing assumptions differ).

### 5. Client cutover (web, extension, SDKs, desktop/CLI copy)
- Flip `NEXT_PUBLIC_SOLANA_NETWORK` (+ program id) and rebuild the web image;
  banner auto-hides. Wallet adapters must target mainnet-beta.
- Extension: no settlement code paths (HMAC proxy only), but re-verify the
  buyer flow end to end on mainnet config.
- SDKs (python/node/go) take program id + cluster from config: release notes
  must call out the new mainnet ids.

### 6. Data: balances reset, not migration
- Devnet balances are test SOL and must NOT carry over. Plan: announce the
  reset window, snapshot for records, zero on-chain-linked balances at
  cutover, keep identity/KYC/listings. Decide dispute/order history handling
  (archive read-only vs fresh start).

### 7. Live preflight (rebuild, not the current script)
The new preflight must check live state and fail closed:
- paid RPC health + latency on all endpoints; WS subscribe round-trip;
- program id executable on mainnet-beta, upgrade authority = expected multisig;
- PDA derivations (`program_state`, `deposit_vault`) match on-chain;
- KMS sign round-trip for oracle + hot; custody distinctness (oracle ≠ hot ≠
  cold) from live pubkeys;
- hot float within [min, max]; vault above reserve floor; caps sane;
- oracle price fresh (< N seconds) and cross-source deviation < threshold;
- `APP_ENV=production`, dev keys absent, testnet banner off in the built web
  bundle.

### 8. Cutover runbook + rollback
- Freeze window (deposits/withdrawals paused, in-flight intents drained or
  refunded on devnet), cutover checklist, go/no-go criteria, rollback point
  (RPC/program-id flip back + balance snapshot restore procedure).
- Monitoring: hot-float alerts, price-staleness alerts, RPC error-rate
  alerts, settlement backlog alerts; on-call rotation; incident playbooks
  (key compromise, oracle outage, RPC outage, program bug → upgrade freeze).

### 9. Compliance and policy (product decisions, not code)
- KYC thresholds, tax-form thresholds, refund/dispute SLAs, fee schedule,
  prohibited-use policy for proxy supply, Terms + Privacy updates for
  mainnet. None of these can ship as code defaults.

## Decisions needed from the user

1. Escrow source: recover from the other team, or authorize a clean-room
   rewrite from the IDL (+ who reviews it)?
2. Treasury: opening floats, multisig members/threshold, cold-storage medium?
3. Audit: firm, budget, timeline (audits typically take weeks and have queues)?
4. RPC provider + budget; oracle sources + paid keys?
5. Balances: confirm zero-reset (and order/dispute history: archive or fresh)?
6. Launch shape: invite-only mainnet beta vs open? Target date?
7. Fees, KYC/tax thresholds, refund policy?

## Cost drivers (rough, confirm with vendors)

- External Solana program + settlement audit (typically tens of thousands USD
  and multi-week queues — the schedule driver).
- Paid RPC (scales with watcher polling + verification volume).
- Paid price feeds (CoinGecko/CMC plans; Pyth is on-chain but needs
  integration work).
- GCP KMS HSM keys (per key version + signing ops).
- Opening SOL floats (hot float 100+ per current guidance, vault seed, rent).

## Risks

- Missing program source: the devnet binary's behavior is trusted, not
  verified. Highest risk; workstream 1 retires it.
- Single free-tier price source and public RPC today: both already showed
  limits on devnet.
- Custody checks currently warn-only (`APP_ENV` unset).
- No CI (billing): every cutover change still goes through the manual gate
  (`docs/MANUAL_CI_GATE.md`) until billing is restored.
- Key ceremony + upgrade-authority custody are procedural: they need
  witnesses and written records, not just code.
