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
- Escrow program source lives at `services/solana-programs/proxyhub/`
  (~4,900-line `lib.rs`, 60+ instructions: escrow, multisig oracle, jury
  disputes, staking, provider/gateway registry, listing commitments, session
  escrow, governance, KYC attestations, ZK batches, channels).
  `declare_id!` matches the devnet program `AZGh...QLfvu`, with security-fix
  history (replay paths, payout math, signer binding). The web
  `proxyhub.json` IDL is a 4-instruction client subset, not the full surface.
- Hot payouts already sign via GCP KMS (`USE_GCP_KMS_HOT=true`, no file
  keypair). Oracle/hot/cold split and vault PDA model exist in config.
- `APP_ENV=testnet` is hardcoded by the testnet compose overlays (a `.env`
  value is ignored for control-api), so BC-08 custody checks enforce and
  fail closed — verified live (`BC-08 custody split active`, and a scratch
  boot with merged hot/legacy addresses refuses to start) — and the
  staging-only unauthenticated geoip/map-backfill POSTs are no longer
  registered on the deployed stack. At mainnet cutover, flip the overlays
  to `production`: proofs, custody, billing, and session gates stay as-is.
  The code gate still registers those two POSTs for `""`/`development`/
  `staging`; remove `staging` from it or add auth regardless.
- SOL/USD comes from CoinGecko free tier only, with no API keys configured
  (deploy logs warn). A circuit breaker exists but has never seen mainnet
  volatility. One price source = one failure/manipulation point.
- Deposit verification already hit public-RPC rate limits once (PR #87).
  RPC failover lists and WS derivation exist but point at public endpoints.
- Deposit watcher polls (10s) with durable watermarks; withdrawal holds and
  pending-payment recovery exist and must be preserved through cutover.
- The old `scripts/ops-mainnet-preflight.ts` was self-asserting (compared
  constants to themselves, always passed) and has been replaced by
  `services/control-api/cmd/preflight`: a live, fail-closed Go gate (real
  RPC slots, WS notification, program executable + upgrade authority, vault
  PDA, KMS sign round-trip, custody distinctness, hot float, vault floor,
  fresh + cross-checked SOL price, dev-keys off, banner consistency).
- Multisig settlement client code exists; no mainnet multisig set is defined.

## Workstreams

### 1. Escrow program: verifiable build, audit, mainnet deploy
- Confirm the devnet binary matches source: `anchor build --verifiable` at
  the deployed commit and compare against the on-chain program hash.
  Any drift must be explained before mainnet.
- External audit of the full program surface (60+ instructions, not just the
  4-instruction web IDL subset) + settlement-adjacent Go (`internal/solana`:
  escrow_init, settlement, watcher, velocity, multisig).
- Verifiable build pinned to the audited commit.
- Fresh mainnet keypair; upgrade authority to a multisig from day one (never
  a single hot key). Initialize `program_state`, `deposit_vault` PDAs;
  verify executable + owner on-chain. Publish full IDL + checksums.

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

1. Program audit: firm, budget, timeline (audits take weeks and have
   queues)? Scope is the full 60+ instruction surface, not the 4-instruction
   web IDL subset.
2. Treasury: opening floats, multisig members/threshold, cold-storage medium?
3. RPC provider + budget; oracle sources + paid keys?
4. Balances: confirm zero-reset (and order/dispute history: archive or fresh)?
5. Launch shape: invite-only mainnet beta vs open? Target date?
6. Fees, KYC/tax thresholds, refund policy?

## Cost drivers (rough, confirm with vendors)

- External Solana program + settlement audit (typically tens of thousands USD
  and multi-week queues — the schedule driver).
- Paid RPC (scales with watcher polling + verification volume).
- Paid price feeds (CoinGecko/CMC plans; Pyth is on-chain but needs
  integration work).
- GCP KMS HSM keys (per key version + signing ops).
- Opening SOL floats (hot float 100+ per current guidance, vault seed, rent).

## Risks

- Devnet binary vs source drift is unverified: confirm via verifiable
  build against the on-chain program hash before trusting either.
- Audit surface is 60+ instructions (not the 4-instruction web IDL): larger
  audit scope, cost, and schedule than the escrow-only picture.
- Single free-tier price source and public RPC today: both already showed
  limits on devnet. Live 2026-11-01: control-api's own BlockchainIndexer
  emits ~90 `getBlock` 429s/min, exhausting the Helius key quota ("max usage
  reached") and throttling the public fallbacks. Deposit verification and
  any preflight share the same starved quota until the indexer is fixed or
  moved to a dedicated endpoint/key.
- Two unauthenticated admin POSTs (geoip backfill, map-links aggregate)
  stay registered under `staging`; remove or auth-gate them before mainnet.
- No CI (billing): every cutover change still goes through the manual gate
  (`docs/MANUAL_CI_GATE.md`) until billing is restored.
- Key ceremony + upgrade-authority custody are procedural: they need
  witnesses and written records, not just code.
