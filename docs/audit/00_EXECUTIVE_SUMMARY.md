# ProxyHub Platform Audit — Executive Summary

**Audit date:** 2026-07-30
**Scope:** Full repository — `apps/web` (Next.js), `services/control-api` (Go), `services/edge-gateway` (Rust), `services/provider-node` (Rust), `cli` (Rust), `services/solana-programs` (Anchor), `programs/reputation` (Anchor), `services/relayer`, `services/zk-prover`, `services/admin-cli`, `sdks/*`, `migrations/`, `infra/`, `.github/workflows/`, `testing/`.
**Method:** Static architecture mapping and code tracing by subsystem, plus targeted runtime verification (Go build/test, `cargo check`, `tsc`) of every claim that informed a remediation. Execution evidence is in `22_FINAL_VERIFICATION_REPORT.md`.

---

## 1. Overall Verdict

**System status: PARTIALLY OPERATIONAL — a real, unusually complete MVP with several critical defects. Not production-ready until the Phase 0 items in `19_IMPLEMENTATION_ROADMAP.md` land.**

> **PRODUCTION EXPOSURE (confirmed 2026-07-31):** the platform is **live in production** (`proxyhubb.com` / `api.proxyhubb.com`, QA workflow probes it every 30 min). Live probing of its own public endpoints established: chain integration points at **devnet** (`/v1/solana/health`: `network=devnet`, oracle `8P4uu…Kii2` balance 13.34 SOL); **treasury == oracle hot wallet** (`/v1/system/config/public`: `treasury_solana` = same address) — BC-08 is a live configuration; and the escrow program is **deployed nowhere** (`2yDR…Dd7` absent on both devnet and mainnet; `9MrpH…Faob2` is not a program) — meaning on-chain escrow settlement is effectively absent in production and all billing/settlement currently rides the internal ledger only. Consequences: (a) the BE-01 metering forgery hole and DB-01/03 ledger weaknesses are the *primary* live financial risks until the patched control-api ships; (b) BC-01/02 is not currently exploitable on-chain, but the patched program must be deployed before escrow features can work at all; (c) deploying the patched control-api **must** be coordinated with `GATEWAY_USAGE_PUBLIC_KEY` rollout, or live metering will halt (fail-closed). Production-specific sequence: `17_REMEDIATION_PLAN.md` §G.

ProxyHub is much further than a prototype. The marketplace lifecycle is substantially implemented end to end: wallet-based auth, provider onboarding with reverse-tunnel agents that work behind NAT/CGNAT, marketplace listings with real search, purchase with on-chain Solana escrow, CONNECT proxying through a Rust edge gateway with gateway-measured signed metering, wallet ledger with row locking and idempotency keys, withdrawals with compensating outbox, treasury reconciliation, and a broad social/explorer/governance surface.

However, the audit found **5 Critical and 20+ High findings**, the worst being on-chain escrow payout redirection (any settling authority could steal escrowed funds), a billing signature soft-accept path, and broken deploy automation. **Six of the most severe issues were fixed during this audit** (see §4) and verified by build/test.

## 2. Direct Answers to the Required Questions

| # | Question | Answer (evidence in linked report) |
|---|----------|------------------------------------|
| 1 | Is the frontend properly connected to the backend? | **Mostly yes.** Same-origin `/v1` rewrites to control-api; ~200 distinct endpoint call sites; React Query/Zustand state. Realtime `/v1/ws` is broken (never sends credentials). See `02`. |
| 2 | Do all important pages work? | **Core pages yes** (marketplace, orders, wallet, provider, explorer, forum). Degraded: sessions/notifications realtime, analytics "network status" card (calls unimplemented `/v1/network/status`), hardcoded landing/provider stats. See `02`, `09`. |
| 3 | Are APIs complete, secure, documented, correctly routed? | **Mostly consistent `/v1` surface** with layered auth. Gaps: role-context-key mismatches (fixed), admin-dispute routes on the wrong auth group, ~11 unwired `Register*` packages (dead code), OpenAPI exists (~155KB) but drift not verified. See `03`, `05`. |
| 4 | Is the database architecture correct and scalable? | **Correct for MVP scale; not for target scale.** NUMERIC money columns and idempotency indexes are good; but no double-entry ledger, no ledger immutability, float64 in Go money paths, usage/explorer telemetry in OLTP with no analytical store, Redis is a session/metering SPOF. See `06`. |
| 5 | Can providers genuinely sell proxies? | **Yes.** The provider agent dials out (reverse yamux tunnel), so home routers/CGNAT/mobile/dynamic IP all work. Egress blocks private ranges post-DNS. Missing: consent/scheduling in the agent, lease enforcement optional in compat mode. See `08`. |
| 6 | Can buyers genuinely purchase and use provider proxies? | **Yes for CONNECT (HTTPS) buyers.** Purchase → credentials → CONNECT through gateway works. Caveats: no HTTP forward proxy (501), SOCKS5 optional, ISP targeting advertised but not routed, per-session concurrency/RPM not enforced. See `07`, `09`. |
| 7 | Does the Edge Gateway route, meter, and secure traffic correctly? | **Routes and meters correctly** (yamux reverse tunnels, gateway-side byte counting, Ed25519-signed batched reports). Security is defense-in-depth but depends on the provider agent for DNS-rebinding protection; no alternate-provider retry; metering WAL/nonce edge cases can under/over-charge. See `07`. |
| 8 | Are buyer charges and provider earnings accurate? | **Architecturally sound, with integrity gaps (one fixed).** Billing uses gateway-measured bytes, not provider claims — good. Until this audit, unverifiable signatures were soft-accepted (fixed, BE-01). WAL flush/nonce issues remain (GW-08). See `10`. |
| 9 | Is the wallet/transaction system financially consistent? | **Partially.** Row-locked debit/credit helpers, unique idempotency indexes, compensation outbox, hourly treasury reconciliation. But it is **not double-entry**, balances are float64 in app code, and the ledger is mutable at the DB layer. See `10`. |
| 10 | Is blockchain settlement correctly integrated? | **Integrated and load-bearing (Solana-only; EVM relayer decommissioned), but had critical on-chain auth holes.** Escrow/jury payout accounts were unconstrained → fixed this audit. Session program remains unsafe to deploy. Custodial oracle hot wallet is the treasury spender. See `11`. |
| 11 | Serious security/privacy risks? | **Yes, being reduced.** Committed-secret hygiene is clean (keypairs are gitignored), but real keypairs/JWT live on disk; pgbouncer ships an empty-password MD5; k8s Redis has no auth; HAProxy stats admin is open; dev bypasses defaulted on in base compose (fixed); NEXT_PUBLIC e2e wallet secret (fixed). See `13`. |
| 12 | Top ten production blockers? | See §3 below. |
| 13 | What must be fixed before public launch? | All Phase 0 + Phase 1 items in `19_IMPLEMENTATION_ROADMAP.md`. |
| 14 | What architecture for production? | Five planes: control / data / financial / settlement / analytics — `18_TARGET_ARCHITECTURE.md`. |
| 15 | Current maturity? | **Partially operational.** After Phase 0/1: "MVP-ready with restrictions". Production-ready only after Phase 2 hardening. |

## 3. Top Ten Production Blockers

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | BC-01/BC-02: Escrow & jury settle payout accounts unconstrained on-chain — fund redirection possible | Critical | **Fixed (this audit), needs program redeploy** |
| 2 | BC-03/BC-04: Session program `complete_session`/`slash_gateway` unconstrained — do not deploy as-is | Critical | Open — remediation plan in `11`/`17` |
| 3 | BE-01: Usage-report signature soft-accept — forged usage could inflate billing | High→Critical impact | **Fixed (this audit)** |
| 4 | GW-08: Metering WAL flush + millisecond-nonce dedup gaps — under/over-charge windows | High | Open |
| 5 | DB-01/DB-03: No double-entry ledger; ledger mutable at DB layer | High | Open |
| 6 | EV-01: Treasury NATS subjects have no JetStream stream — treasury events silently dropped | High | Open |
| 7 | EV-05: Redis is SPOF for live sessions + metering WAL | High | Open |
| 8 | BC-08: Custodial oracle hot wallet doubles as deposit treasury — key compromise drains user funds | High | **Resolved** 2026-08-08 (vault≠hot≠oracle on gcp-testnet) |
| 9 | OPS-01/02: Deploy automation broken (missing kustomize overlays; registry owner mismatch) | Critical/High | Open |
| 10 | SEC-04/05: pgbouncer empty-password MD5; k8s Redis without auth | High | Open |

## 4. Fixes Implemented During This Audit

| Fix | Files | Verification |
|-----|-------|--------------|
| **BE-01** Fail-closed usage signature verification (removed soft-accept; nil-safe Redis guard) + 4 new tests | `services/control-api/internal/billing/aggregator.go`, `aggregator_signature_test.go` | `go test ./internal/billing/...` **pass** |
| **BE-02** Role context key standardized (`userRole`) — KYC admin check, dispute `isAdmin`, WS role | `internal/api/kyc.go`, `disputes.go`, `websocket.go` | `go build ./...`, `go vet` **pass** |
| **BC-01/02** Anchor address constraints bind escrow payouts to recorded buyer/seller in `SettleEscrow`, `SettleEscrowMultiSig`, `ExecuteJuryVerdict` (+ jury↔escrow binding) | `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` | `cargo check` (see `22`) |
| **SEC-01/07** Postgres, Redis, NATS ports bound to loopback in base compose | `docker-compose.yml` | Compose config review |
| **SEC-02** Dev escrow/listing-sign bypasses default to `false` | `docker-compose.yml` | Compose config review |
| **OPS-04** Prod Prometheus mounts alert rules | `docker-compose.prod.yml` | Compose config review |
| **FE-03** Playwright e2e wallet disabled in production builds | `apps/web/src/providers/SolanaWalletProvider.tsx` | `tsc` typecheck (see `22`) |
| **BE-07** Graceful HTTP shutdown (SIGINT/SIGTERM drain, 30s) in production `main.go` | `services/control-api/main.go` | `go build ./...` **pass** |

Pre-existing issue discovered, not introduced: `TestAuthorityHeadersCoveragePhase1/order_create` fails on a clean tree (order-create does not set the `X-ProxyHubb-Authority-Mode` header). Logged as TEST-01 in `15`.

## 5. What Works vs What Doesn't (condensed)

**Works (verified by code trace, mostly also by tests):** wallet auth + refresh; marketplace browse/filter/map; listing CRUD; orders + on-chain escrow init/settle via oracle; credentials issuance; provider onboarding/nodes/tokens/earnings; reverse-tunnel provider agents behind NAT; CONNECT proxying with auth + destination policy; gateway-measured signed metering; deposits with unique tx-hash dedup; withdrawals with velocity guard + compensation outbox; treasury reconciliation worker; explorer + forum + messaging + governance; CI security gates; GCP backup/restore tooling.

**Partially works:** realtime notifications (WS auth broken); analytics (one missing route); ISP-targeted routing (claimed, not routed); spending-limit enforcement at the gateway (process-wide only); dispute admin endpoints (auth fixed; route placement still wrong); circle revenue aliases (stubbed); ZK reputation (client mock; on-chain verifies oracle sig, not Halo2).

**Broken/disconnected/mocked:** HTTP forward proxy (501); SOCKS4; `/v1/network/status`; ~11 unwired `Register*` backend packages; treasury NATS subjects (no stream); `manifests.coordinated` (no consumer); reputation program (fake ID, no token CPI); zk-prover (scaffold); relayer (exits 1); `usage_records` (writer never called on hot path); control-api local `migrations/` dir (divergent, not applied); kustomize deploy overlays (missing).

## 6. Financial Integrity Assessment

The design intent (row locks, ledger append, idempotency uniques, compensation outbox, reconciliation) is correct, but the implementation is **one hardening phase short of financial-production grade**:

1. Not double-entry — balances can diverge from the journal without detection between hourly reconciliations.
2. `float64` money in Go with NUMERIC in Postgres and DOUBLE PRECISION in some money columns (session intents, receipts, reconciliation).
3. No DB-level immutability on `wallet_ledger_entries`.
4. On-chain: payout binding now fixed in source; **must be redeployed before mainnet use**; deposit confirmation depth is `confirmed` not `finalized`.
5. Metering: gateway-measured (good) but report dedup uses millisecond nonces (replay window) and WAL requeue is restart-dependent.

## 7. Recommended Immediate Actions (Phase 0, detail in `19`)

1. **Redeploy the proxyhub program** with the payout-binding constraints (and audit the deployed bytecode vs source before any mainnet funds).
2. Do not deploy/enable the session program until a config PDA binds oracle/admin/treasury.
3. Rotate and vault all local key material (`oracle-keypair.json`, `treasury-keypair.json`, `infra/oracle-keypair.json`, `jwt.txt`); make KMS mandatory in prod.
4. Set `GATEWAY_USAGE_PUBLIC_KEY` everywhere; keep fail-closed verification (now in code).
5. Fix deploy automation (overlays or switch to the GCP compose path as canonical).
6. Fix pgbouncer/Redis k8s credentials before any `kubectl apply`.
7. Add TREASURY JetStream stream; make Redis HA before paid traffic.
