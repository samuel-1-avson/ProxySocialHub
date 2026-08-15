# 17 — Remediation Plan

Every finding from the audit, its status, and (for open items) file-level fix guidance with acceptance criteria and tests. Complexity: S/M/L/XL.

## G. Production Hotfix Sequence (platform is live — added 2026-07-31; devnet confirmed for now)

Live state: `api.proxyhubb.com` on devnet; treasury == oracle hot wallet (`8P4uu…Kii2`, ~13.34 SOL devnet); escrow program deployed nowhere; billing/settlement currently rides the internal ledger with the pre-fix (soft-accept) metering code. Sequence matters — wrong order = metering outage. **Decision recorded:** production stays on **devnet** for now; vault/KMS/cold-treasury (item 4) is gated on the future mainnet move, not on this hotfix.

1. **Gateway key rollout FIRST** (concrete wiring, verified against `config.rs:324` / `metering.rs:34` / `aggregator.go:49`):
   - Generate: `node scripts/gateway-usage-keygen.cjs` (validated; prints both values; refuses zero seed).
   - Set `PROVIDER_PRIVATE_KEY=<seed hex>` in the edge-gateway env, `GATEWAY_USAGE_PUBLIC_KEY=<pubkey hex>` in the control-api env on the GCP VM.
   - The current (pre-fix) control-api already verifies when the pubkey is set and soft-accepts otherwise, so this step is safe to apply before the control-api upgrade.
   - **Never use the all-zeros seed** previously shown in `.env.docker.example` (now replaced with a generate instruction) — its pubkey is publicly known; anyone could forge "validly signed" usage reports.
2. **Ship patched control-api** (fail-closed BE-01, role keys, graceful shutdown, new program-ID default) via the GCP compose path (`scripts/gcp-compose-pull-deploy.sh` or financial-p0 remote pattern). Confirm prod env: `PROXYHUB_ALLOW_DEV_*` unset/false, `ALLOW_UNSIGNED_USAGE` unset. Post-deploy: watch usage-report 4xx rates — a spike means gateway keys misconfigured (rollback decision).
3. **Deploy patched program to devnet** (`deploy-proxyhub-devnet.ps1`), set `SOLANA_PROGRAM_ID=AZGhGfv…Lfvu` in prod env, restart; verify escrow init→settle via the Go oracle against the live cluster. This **restores** on-chain escrow (currently absent).
4. **Treasury hygiene:** plan vault-PDA + KMS + cold treasury (BC-08) before any mainnet move; keep `ORACLE_TRANSFER_FREEZE` documented as the emergency brake (velocity limits already 50/500 SOL).
5. Then continue with §C Phase 1 items in order (GW-08 metering nonce/WAL first).

## A. Completed in this audit (verified)

| ID | Problem | Change | Files | Verification |
|----|---------|--------|-------|--------------|
| BE-01 | Usage-report signatures soft-accepted when no key material | Fail-closed verification; dev-only escape via `ALLOW_UNSIGNED_USAGE`+non-prod; nil-Redis guard | `services/control-api/internal/billing/aggregator.go` | `go test ./internal/billing/...` ✅ (4 new tests) |
| BE-02 | `role` vs `userRole` context mismatch broke KYC-admin, dispute-admin, WS role | Standardized on `userRole` | `internal/api/kyc.go`, `disputes.go`, `websocket.go` | `go build`, `go vet` ✅ |
| BC-01 | `SettleEscrow`/`SettleEscrowMultiSig` payout accounts unconstrained → theft | `address = escrow.buyer/seller` constraints | `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` | `cargo check` ✅ |
| BC-02 | `ExecuteJuryVerdict` escrow/jury/recipients unconstrained | jury↔escrow constraint + payout binding | same | `cargo check` ✅ |
| SEC-01/07 | DB/Redis/NATS host ports on all interfaces | loopback bind | `docker-compose.yml` | config review |
| SEC-02 | Dev bypasses defaulted true | default false | `docker-compose.yml` | config review |
| OPS-04 | Prod Prometheus lacked alert rules | mount `infra/prometheus/alerts` | `docker-compose.prod.yml` | config review (matches `rule_files`) |
| FE-03 | E2E wallet secret via NEXT_PUBLIC | disabled in production builds | `apps/web/src/providers/SolanaWalletProvider.tsx` | `tsc` ✅ |
| BE-07 | No graceful shutdown | SIGINT/SIGTERM drain (30s) | `services/control-api/main.go` | `go build` ✅ |
| GW-08 | Metering WAL/nonce double/under-charge windows | exactly-once: INCR seq nonces + pre-send pending snapshots + ack-before-WAL-decrement + pending/WAL sweep per cycle | `services/edge-gateway/src/metering.rs` | `cargo check` ✅ |
| BE-03 | Dispute admin routes on user-JWT group | `RegisterAdminDisputeRoutes` mounted on `adminProtected` (URLs unchanged) | `disputes.go`, `main.go`, `disputes_admin_test.go` | `go test` ✅ |
| API-01/FE-05 | `/v1/network/status` missing | aggregate handler matching dashboard contract (nodes table) | `internal/api/network.go`, `main.go`, `network_test.go` | `go test` ✅ |

## B. Open — Phase 0 (emergency security/financial)

### R-01 Redeploy proxyhub program with payout binding (BC-01/02) — M — **DONE on devnet (2026-07-31)**
- **Deployed:** `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` on Solana **devnet** (sig `3knYTEDr…6xUc`). On-chain dump SHA256 matches build `232B8E32…8A69`. Upgrade authority = oracle/treasury `8P4uu…Kii2`.
- **Live settle e2e:** `tests/live_escrow_settle_smoke.ts` (fund buyer from oracle → init → wrong-seller reject → settle 4/10 → seller +0.04 SOL) → **PASS**. Program state initialized on-chain.
- **Remaining:** consider moving upgrade authority off the hot wallet before mainnet.

### R-02 Do not deploy session program; add Config PDA (BC-03/04) — L
- **Steps:** new `Config` account (`seeds=[b"config"]`; `admin`, `treasury`); `initialize_config`; constrain `CompleteSession.oracle` and `SlashGateway.admin`/`treasury`; replace f64 payout math with u64 lamports.
- **Acceptance:** unauthorized complete/slash fails; authorized succeeds; integer math exact.
- **Tests:** session.ts adversarial cases.

### R-03 Rotate & vault key material (SEC-03/BC-08/BC-09) — S(ops)
- **Steps:** generate new oracle/treasury keys; fund via KMS (`USE_AWS_KMS=true` path exists); delete local keypairs; separate cold treasury from hot wallet; deposits to program vault PDA (design in `18`).
- **Acceptance:** no real keys on workstations/compose mounts; withdrawals work via KMS signer.

### R-04 Fix k8s data-store credentials (SEC-04/05/06) — S
- **Steps:** pgbouncer userlist from Secret (real password); Redis `requirepass`+protected-mode yes (or ACL); HAProxy stats behind auth + no external publish.
- **Acceptance:** unauthenticated connections to pooler/Redis fail; stats UI requires auth.

### R-05 Repair deploy automation (OPS-01/02) — M
- **Steps:** either add `infra/k8s/overlays/{staging,production}` kustomize trees or make the GCP compose path canonical in `deploy.yml`; unify GHCR owner; pin tags (OPS-03).
- **Acceptance:** tag push deploys successfully to staging.

### R-06 Add TREASURY JetStream stream (EV-01) — S — **DONE (2026-08-09 Testnet close)**
- **Done:** `TREASURY` stream (`proxy.treasury.v1.>`, 30d, 500MB) + durable `treasury-event-consumer` (ack + audit log) + supervised iterator recreate.
- **Evidence:** `docs/ops/evidence/EV01_treasury_jetstream_20260809T123137Z.md` (`EV01_TREASURY_JETSTREAM_PASS`).

### R-07 `GATEWAY_USAGE_PUBLIC_KEY` everywhere (BE-01 follow-up) — S(ops)
- Set the env in all deploys; alert on startup if missing in prod (`config.LoadSecure`-style hard fail).

## C. Open — Phase 1 (core marketplace correctness)

| ID | Item | Files | Complexity | Acceptance |
|----|------|-------|-----------|------------|
| GW-08 | ~~Metering nonce/WAL~~ DONE (2026-07-31): per-session INCR seq nonces + pre-send pending snapshots + ack-before-WAL-decrement + per-cycle pending/WAL sweep; dedup-acks treated as success; Redis integration tests (seq/pending/WAL/flush preserve+ack) | `services/edge-gateway/src/metering.rs` | M | cargo test metering exactly_once ✅ (skips if Redis down) |
| GW-03 | ~~Enforce session-intent `max_concurrency` + RPM~~ DONE (2026-07-31): claims now wired into SessionData (were dropped); per-session RPM via Redis 60s window; per-session live-conn RAII guard w/ CAS (no overshoot); 3 tracker tests | `edge-gateway/src/main.rs`, `auth.rs`, `state.rs` | M | 168/168 gateway tests ✅; over-limit → 429 |
| GW-05 | ~~Live bandwidth shaping from session limits~~ DONE: cap now derived from session trust tier via existing `bandwidth_cap_for_tier` (was hardcoded 0) | `main.rs`, `qos.rs` | M | 168/168 ✅ |
| GW-06 | ~~Bounded failover to N alternate providers~~ DONE (2026-07-31): split bridge into `try_open_provider_stream` + `bridge_established`; `bridge_to_provider_with_failover` tries primary + 2 alternates (geo/ISP honored, client socket untouched until stream established, per-attempt circuit-breaker side effects preserved) | `main.rs`, `provider_selection.rs` | M | 172/172 tests ✅ |
| GW-04 | ~~Route (or reject) `target_isp`~~ DONE end-to-end: control-api resolves ISP via GeoIP at register (was raw IP), returns it in register + heartbeat responses; gateway stores in NodeInfo; selection post-filters with ISP-filtered fallback, honest reject on no match / pin mismatch; 4 filter tests | `gateway.go`, `control_api.rs`, `tunnel.rs`, `state.rs`, `provider_selection.rs`, `main.rs`, `socks5.rs` | M | 172/172 ✅, go build ✅ |
| FE-01/02 | ~~WS auth token pass + WS termination at proxy; fix Docker WS URL~~ DONE (2026-07-31): client passes `?token=` (fresh per reconnect); backend accepts query token only on genuine upgrade requests (header/cookie preferred); presence subscribe authenticates; Dockerfile default emptied. Deploy note: reverse proxy must route `/v1/ws` with upgrade support (Caddy handles automatically) | `apps/web/src/lib/websocket.tsx`, `ws-url.ts`, `presence.ts`, `middleware/supabase.go`, Dockerfile | S-M | middleware tests 6/6 ✅, tsc ✅ |
| 1.2 | ~~Entitlement at CONNECT~~ DONE (2026-07-31): live Redis usage merged at admit (legacy + intent); cancel deletes Redis session/usage; intent issuance rejects exhausted plan; SOCKS5 RPM+concurrency parity | `auth.rs`, `socks5.rs`, `orders.go`, `session.go` | L | merge unit + Redis over-quota validate_session test; cancel/intent code review |
| FE-05/API-01 | ~~Implement `/v1/network/status`~~ DONE: aggregates nodes table (total/healthy/avg_latency/top_countries/node_scores) matching the dashboard contract | `internal/api/network.go`, `main.go` | S | tests ✅ (DB-backed case skips w/o TEST_DATABASE_URL) |
| BE-03 | ~~Mount dispute-admin under admin JWT group~~ DONE: `RegisterAdminDisputeRoutes` on `adminProtected` (URLs unchanged); regression tests cover 404-on-user-group + 403-non-admin + role sources | `main.go`, `disputes.go` | S | tests ✅ |
| DB-05 | ~~Marketplace indexes~~ DONE (2026-07-31): `(status,country)`, `LOWER(country)`, active ISP trigram, latency/uptime/price partial indexes | `migrations/000110_marketplace_browse_indexes.{up,down}.sql` | S | migration applied; EXPLAIN on browse filters uses indexes |
| TEST-01 | ~~order-create authority header~~ DONE: test wired wrong registrar (`RegisterOrderRoutes` = GET /sales only); now mounts `RegisterPartnerPurchaseRoutes` which serves POST /orders | `authority_headers_test.go` | S | 3/3 ✅ |
| PN-04 | ~~lease enforcement~~ DONE: explicit `REQUIRE_PROVIDER_LEASE=true` in prod compose, `false` in dev base compose (code already enforced by default in release; now explicit + documented) | `docker-compose.prod.yml`, `docker-compose.yml` | S | compose config ✅ |

### 1.11 HTTP forward proxy or CONNECT-only docs — **DONE (docs + honest 501)**
- Documented CONNECT/SOCKS5-only contract in `docs/buyer-proxy.md`; README + buyer UI notes.
- Non-CONNECT absolute-URI requests now return real **`501 Not Implemented`** (was metrics-labeled 501 with HTTP 200 body).
- Full absolute-URI forward proxy deferred as optional product work.

## D. Open — Phase 2 (reliability/data integrity)

| ID | Item | Complexity | Notes |
|----|------|-----------|-------|
| DB-01 | Double-entry ledger (journal lines + accounts) or enforced invariant `Σamount=balance` + immutable ledger | XL | **Partial↑ (2026-08-09):** dual-write 2100 catch-up + skip allowlist + drift alerts re-enabled (`DB01_dual_write_harden_20260809T141313Z.md`); wallet still SoT; M4 journal-as-SoT open |
| DB-03 | Ledger immutability: `REVOKE UPDATE/DELETE` + trigger; archive via partition detach instead of DELETE | M | **Done (000116):** append-only triggers; archive/GDPR GUC exceptions |
| DB-02 | Integer lamports end-to-end (Go int64 + BIGINT) | L | **Partial (Sprint I):** dual-write + `Credit/DebitWalletLockedLamports` + billing `CostFromBytesUSD`; float API retained |
| EV-05 | Redis HA + metering WAL PG fallback | M | sentinel/cluster; fallback queue drained by worker |
| EV-06/EV-02 | DLQ policy + consume manifests.coordinated (or stop publishing) | M | JetStream DLQ subjects |
| BE-04 | Wire or delete 11 `Register*` packages | S | decision record per package |
| BE-10 | Outbox pattern for P2P chain settle | M | reuse compensation outbox (000108) |
| BC-07 | finalized commitment for deposit credit | S | plus reorg regression test |
| BC-05 | admin binding on submit_usage_proof/write_kyc_attestation | S | align Go signer first |
| FIN-10 | Formal hold/reservation states in PG | L | part of ledger redesign |

## E. Open — Phase 3+ (scale/product/ops)

- EV-06/AN-01: ClickHouse (or Timescale) for usage/explorer rollups; retention jobs.
- SCALE-01: k6 product load suite with SLOs (OPS-08); metrics label audit.
- SCALE-02: regional gateways + multipod hardening; autoscaling validation (`infra/k8s/autoscaling_test.go` extend).
- FE-04/BC-11: real ZK/reputation path or remove claims; reputation program rebuild.
- FE-06/07/T4: independent probing service (latency/uptime/location verification) feeding marketplace stats.
- PN-03: agent availability scheduling + consent flags.
- OPS-05: delete `infra/docker-compose/`; OPS-06: durable trace backend; OPS-07: write missing GCP doc.
- SEC-08: rotate gateway auth → mTLS or short-lived signed JWTs; SEC-10: admin lockout policy; SEC-11: CONNECT-target log minimization.
- API-05/06/07: typed error envelope; paginate secondary lists; OpenAPI lint in CI.

## F. Fix→Test linkage

| Fix | Tests |
|-----|-------|
| BE-01 | `aggregator_signature_test.go` (4 new) ✅ |
| BC-01/02 | Anchor wrong-recipient tests (to add, R-01) |
| GW-08 | `metering::exactly_once_tests` (Redis seq/pending/WAL/flush) ✅ |
| BE-02 | KYC/dispute admin-authz regression (to add) |
| DB-05 | migration `000110` ✅; optional EXPLAIN smoke on staging |
| FE-01/02 | Playwright realtime spec against staging |
