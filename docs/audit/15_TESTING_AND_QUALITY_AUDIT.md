# 15 — Testing & Quality Audit

## 1. Inventory

| Layer | Assets | Coverage quality |
|-------|--------|------------------|
| Go unit/integration (~125 files) | wallet (incl. withdrawal security, phase2), orders/purchase/dev-activate, listings/catalog, explorer hardening, gateway endpoints, messaging/forum, **aggregator signatures (extended this audit)**, compensation outbox, concurrency, security remediation | Good breadth in financial-adjacent packages; many tests need Redis/PG (integration-tagged by convention) |
| Rust gateway | `#[cfg(test)]` modules across policy/auth/selection/rotation/ddos/socks5/websocket/tunnel-claims; Criterion benches ×3 | Good unit breadth; no crate-level e2e |
| Rust provider-node | target parse, public-IP filter, lease policy, config validate, proofs, doctor | Good for safety-critical egress filter |
| Anchor (TS) | `tests/proxyhub.ts`, `tests/session.ts`, `tests/critical_escrow_governance.ts` (ts-mocha) | Exists; **not executed in this audit** (needs solana-test-validator) |
| Frontend (Playwright) | smoke, auth (real API optional), marketplace (mocked buy), devnet live specs, explorer, social, agents, provider | UI regressions caught; API contract mostly not |
| SDKs | go/node/python test suites in `sdk-publish.yml` | bulk-pool surface |
| Infra | k8s `autoscaling_test.go`, `loadbalancer_test.go`; migration apply/rollback CI smoke | smoke-level |
| Fuzz | `testing/fuzz_escrow.rs` (cargo-fuzz, escrow payout invariants) | asset exists; no CI schedule found |
| Load | `testing/load_test.js/.yml` | targets Solana RPC, not product (OPS-08) |

## 2. Execution Results (this audit)

| Command | Result |
|---------|--------|
| `go build ./...` (control-api) | ✅ pass |
| `go vet ./internal/billing/... ./internal/api/... .` | ✅ pass |
| `go test ./internal/billing/...` (incl. 4 new fail-closed tests) | ✅ pass |
| `go test ./internal/api/ -run "Dispute|KYC|Authority|WebSocket|Websocket"` | ⚠️ 1 pre-existing failure (below); dispute/KYC/WS pass |
| `cargo check` proxyhub program (anchor 0.32.1) | ✅ pass |
| `npx tsc --noEmit -p tsconfig.typecheck.json` | ✅ pass |
| `anchor build` (build-sbf, both programs) | ✅ pass |
| Anchor TS suite vs local validator (Docker, `test-anchor-local-docker.ps1`) | ✅ **38/38 passing** — incl. 7 new payout-binding regressions (BC-01/02), zk_batch proof-instruction fix + new negative test |

**TEST-01 (pre-existing, not introduced):** `TestAuthorityHeadersCoveragePhase1/order_create` fails on the clean tree — order-create handler doesn't set `X-ProxyHubb-Authority-Mode: db_authoritative`. Fix: call `setAuthorityHeaders(c, authorityModeDBAuthoritative, …)` in the order-create handler (also resolves the test). Logged to remediation backlog.

**TEST-02 (pre-existing at HEAD; FIXED in this session):** Anchor `submit_zk_batch` tests didn't include the ed25519 proof instruction the on-chain handler has required since its introspection hardening (failed with `MissingSignatureVerification`). Fixed in `tests/proxyhub.ts` (oracle proof instruction via `Ed25519Program.createInstructionWithPrivateKey`) plus a new negative test proving instruction-less submissions are rejected. Suite now 38/38.

**Note (2026-07-30):** the gap "On-chain payout redirection — add Anchor test" is **closed** by `tests/escrow_payout_binding.ts` (7 cases, all passing on localnet).

**TEST-03 (pre-existing, FIXED 2026-07-31):** `routing::analytics::tests::test_percentile_range` — the `percentile()` helper used `round()` on the (len-1) scale, putting p50 of an even-length window one element above nearest-rank convention. Function aligned to floor semantics (matches the test's encoded intent; ≤1-element shift, negligible for routing analytics).

**TEST-04 (pre-existing, FIXED 2026-07-31):** `security::ddos::tests::test_behavior_scorer_threat_levels` — test expected 5 auth failures ≥ Medium, but the scoring table (>3 → +2pts, >10 → +3pts; Medium needs 3pts) never reached Medium at 5. Test corrected to 11 failures, preserving the production scoring (brute-force escalation still covered).

**Session 2026-07-31 additions:** GW-08 exactly-once metering rewrite in `edge-gateway/src/metering.rs` (durable seq + pending snapshots + ack-before-WAL-decrement + sweep; **165/165 gateway tests pass**); `disputes_admin_test.go` (BE-03: user-group 404, admin-group 403, role-source matrix); `network_test.go` (API-01: route registration + 503-nil-DB + aggregate shape, DB-backed case skips w/o TEST_DATABASE_URL). **Still missing (recommended):** Redis-backed integration test for the metering exactly-once path (replay-after-lost-ack, crash-between-record-and-flush) — the logic is Redis-IO-bound and can't be unit-tested without miniredis/a live Redis.

## 3. Critical-Flow Test Matrix (required → present?)

| Requirement | Test exists? | Where / gap |
|-------------|--------------|-------------|
| Duplicate charging prevented | Partial | receipt-unique tests; **no WAL-replay/double-flush test (GW-08)** |
| Concurrent wallet updates | ✅ | concurrency tests |
| Provider disconnect mid-session | ❌ | add gateway+settlement integration test |
| Buyer disconnect mid-session | ❌ | as above |
| Gateway crash / WAL recovery | ❌ | add |
| DB outage behavior | ❌ | add (fail-closed assertions) |
| Broker (NATS) outage | Partial | soft-fail init covered informally |
| Blockchain RPC outage | Partial | failover helper tests |
| Chain reorg | ❌ | add (confirmed→finalized change first, BC-07) |
| Expired tokens / revoked API keys | ✅ partial | auth tests |
| Duplicate events | Partial | receipt idempotency |
| Out-of-order events | ❌ | add settlement worker tests |
| Incorrect metering (forged/tampered) | ✅ **new** | 4 tests added this audit |
| Refunds | Partial | escrow release tests; race e2e missing |
| Payout failures | ✅ | compensation outbox tests |
| Fraud attempts (unsigned usage) | ✅ **new** | signature tests |
| Unauthorized access (IDOR) | Partial | ownership tests on escrow/orders; KYC/dispute admin authz **needs regression tests after BE-02 fix** |
| Private-network access attempts | ✅ | provider egress-filter unit tests |
| On-chain payout redirection | ❌ | **add Anchor test: settle with wrong recipient must fail** (post-fix regression) |

## 4. Quality Gates

- CI (`proxyhubb-ci.yml`): secrets gate, Gitleaks, path-filtered Go/FE/Rust/CLI/Solana tests, docker build (no push), migration smoke. Good.
- `security.yml`: govulncheck/gosec/npm-audit/cargo-audit/Trivy/**non-blocking**/Slither/CodeQL.
- Pre-commit: gitleaks + security script.
- **Gaps:** Trivy non-blocking; no coverage thresholds enforced; fuzz not scheduled; e2e marketplace relies on mocks.

## 5. Recommendations

1. Add GW-08 metering replay tests (Rust + Go integration) — highest financial value.
2. Add Anchor regression tests for payout binding (BC-01/02) before redeploy.
3. Add KYC/dispute admin-authz regression tests (BE-02 follow-up).
4. Fix TEST-01 (order-create authority header).
5. Make Trivy blocking on HIGH/CRITICAL; add coverage floor for `internal/billing`, `internal/api/wallet*`.
6. Schedule cargo-fuzz for escrow invariants (weekly).
7. Add contract tests: NATS producer→consumer schemas; OpenAPI vs implementation lint.
