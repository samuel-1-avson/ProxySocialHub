# ProxyHubb — Comprehensive Implementation Plan

> Generated from [SYSTEM_ANALYSIS_REPORT.md](SYSTEM_ANALYSIS_REPORT.md)
> Items already completed from the prior "Top 5 Critical Fixes" round are marked ✅.
> Items confirmed fixed by other prior work are marked ✅.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Already completed |
| 🔧 FIX | Bug or broken behavior that must be corrected |
| 🚀 IMPROVE | Working feature that needs quality/perf improvement |
| ✨ ENHANCE | Feature extension or new capability |
| 🔄 CHANGE | Refactor, restructure, or migrate |
| 🗑️ REMOVE | Dead code, deprecated items, or security liabilities |
| ➕ ADD | Net-new functionality or infrastructure |

---

## Phase 0 — Already Completed ✅

These items were addressed in the prior session and are listed here for tracking only.

| # | Category | Item | Files Modified |
|---|----------|------|---------------|
| 0.1 | ✅ | Solana program test suites (proxyhub.ts: 11 tests, session.ts: 5 tests) | `services/solana-programs/proxyhub/tests/` |
| 0.2 | ✅ | Edge-gateway real ZK proofs (Groth16 BN254 with UsageCircuit) | `services/edge-gateway/src/billing/zk.rs` |
| 0.3 | ✅ | Edge-gateway real Solana RPC (keypair loading, PDA derivation) | `services/edge-gateway/src/billing/solana.rs` |
| 0.4 | ✅ | Frontend channels.ts wallet adapter integration | `apps/web/src/lib/api/channels.ts` |
| 0.5 | ✅ | Governance `execute_proposal` instruction (24h timelock) | `programs/proxyhub/src/lib.rs` |
| 0.6 | ✅ | `proof_hash` field on `submit_zk_batch` / ZKBatchPDA | `programs/proxyhub/src/lib.rs` |
| 0.7 | ✅ | `is_paused` → `paused` field bug fix | `programs/proxyhub/src/lib.rs` |
| 0.8 | ✅ | Security CI scans now blocking (removed `continue-on-error`) | `.github/workflows/security.yml`, `ci.yml` |
| 0.9 | ✅ | Docker-compose secrets hardened (required env vars) | `docker-compose.yml`, `infra/docker-compose/` |
| 0.10 | ✅ | Dev login route removed | `internal/api/auth.go`, compose files |
| 0.11 | ✅ | Admin panel removed | `apps/admin/`, compose stacks |
| 0.12 | ✅ | API rewrite gap fixed (both `/v1/*` and `/api/v1/*` rewrite) | `apps/web/next.config.ts` |
| 0.13 | ✅ | State channels `close_channel` fully implemented | `programs/proxyhub/src/lib.rs` |

---

## Phase 1 — Critical Fixes (P0) ⏱️ 1-2 weeks

These are production-breaking or security-critical issues.

### 1.1 ✅ ~~FIX: PHB Token Decimal Inconsistency~~

**Priority:** P0 | **Risk:** Financial — users see wrong balances, governance thresholds miscalculated

**Problem:** `explorer.go` treats PHB as 6 decimals (SPL default), while `governance.go` and `staking.go` use 9 decimals.

**Files:**
- `services/control-api/internal/api/explorer.go` (~L771) — `float64(rawBal) / 1e6`
- `services/control-api/internal/api/governance.go` (L119, L748) — `const phbDecimals = 1_000_000_000`

**Action:**
1. Determine the canonical PHB mint decimals from the on-chain mint account
2. Create a single `internal/token/constants.go` with `const PHBDecimals = <correct_value>`
3. Replace all hardcoded `1e6` / `1e9` references with the shared constant
4. Add a startup assertion that queries the mint account and validates the constant

---

### 1.2 ✅ ~~FIX: NotificationCenter WebSocket Broken~~

**Priority:** P0 | **Risk:** Users never receive real-time notifications

**Problem:** `NotificationCenter.tsx` destructures `{ socket, isConnected }` from `useWebSocket()`, but the hook returns `{ isConnected, lastMessage, send, subscribe, connect, disconnect }`. No `socket` property → runtime crash.

**Files:**
- `apps/web/src/components/NotificationCenter.tsx` (~L30)
- `apps/web/src/lib/websocket.tsx` (L134-141)

**Action:**
1. Refactor `NotificationCenter.tsx` to use `subscribe('notification', handler)` from `useWebSocket()`
2. Remove direct `socket.addEventListener` usage
3. Verify notification payload format matches backend `NATS → WebSocket` bridge

---

### 1.3 ✅ ~~FIX: WalletConnect projectId Placeholder~~

**Priority:** P0 | **Risk:** WalletConnect modal will fail in production

**Problem:** `web3-provider.tsx` has `projectId: 'YOUR_PROJECT_ID'` hardcoded.

**Files:**
- `apps/web/src/lib/web3-provider.tsx` (L11)

**Action:**
1. Change to `process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''`
2. Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to `.env.example` / deployment docs
3. Add build-time warning if env var is missing

---

### 1.4 ✅ ~~FIX: Missing referral_rewards / referral_codes Tables~~

**Priority:** P0 | **Risk:** Referral feature causes runtime DB errors (models reference tables that don't exist)

**Problem:** `features.go` defines `ReferralCode` and `ReferralReward` models pointing to these tables, `apps/web/src/lib/api/referral.ts` calls the endpoints, but no migration creates the tables.

**Files:**
- `services/control-api/internal/models/features.go` (L24, L59)
- `apps/web/src/lib/api/referral.ts`

**Action:**
1. Create migration `000091_referral_tables.up.sql` with `referral_codes` and `referral_rewards` schemas (match Go model fields)
2. Create corresponding `.down.sql`
3. Verify referral API endpoints work end-to-end

---

### 1.5 ✅ ~~FIX: ignoreBuildErrors Suppressing TypeScript Errors~~

**Priority:** P0 | **Risk:** Shipping broken frontend code silently

**Problem:** `next.config.ts` has `typescript: { ignoreBuildErrors: true }`, which suppresses all TS compilation errors during build.

**Files:**
- `apps/web/next.config.ts` (L9)

**Action:**
1. Remove `ignoreBuildErrors: true`
2. Fix all resulting TypeScript compilation errors
3. Ensure CI `next build` passes cleanly

---

## Phase 2 — High-Priority Improvements (P1) ⏱️ 2-4 weeks

### 2.1 🚀 IMPROVE: Go Dependency Vulnerabilities

**Priority:** P1 | **Risk:** 7 reachable vulns in control-api, 4 in relayer, 3 in SDK

**Action:**
1. Upgrade Go toolchain to `go1.26.1+`
2. Upgrade `github.com/ethereum/go-ethereum` to `v1.17.0+`
3. Upgrade `go.opentelemetry.io/otel/sdk` to `v1.40.0+`
4. Run `govulncheck ./...` for each service and resolve all reachable findings
5. Add `govulncheck` to CI pipeline as blocking step

**Files:** `services/control-api/go.mod`, `services/relayer/go.mod`, `sdks/go/go.mod`

---

### 2.2 🚀 IMPROVE: Rust Dependency Vulnerabilities

**Priority:** P1 | **Risk:** 9 crate vulns in edge-gateway, 2 in admin-cli

**Action:**
1. Run `cargo audit` in each Rust workspace
2. Upgrade vulnerable crates (or replace deprecated ones)
3. Add `cargo audit` to CI as blocking step

**Files:** `services/edge-gateway/Cargo.toml`, `cli/Cargo.toml`

---

### 2.3 🚀 IMPROVE: Reputation System — Add Decay Mechanism

**Priority:** P1 | **Risk:** Reputation scores only increase, no penalty for degrading quality

**Problem:** `programs/reputation/` has `update_reputation` that only accumulates. No decay, no negative adjustments, no time-weighted scoring.

**Action:**
1. Add `decay_reputation` instruction to reputation program (time-since-last-update × decay_rate)
2. Add crank-based or oracle-triggered decay invocation
3. Integrate decay trigger into control-api background workers
4. Update frontend reputation display to reflect decay

**Files:** `programs/reputation/src/lib.rs`, `services/control-api/internal/workers/`

---

### 2.4 🔧 FIX: Session ID Collision Risk

**Priority:** P1 | **Risk:** At scale, `rand::random::<u64>()` session IDs will collide

**Problem:** Session program uses `rand::random::<u64>()` for session IDs — collision probability grows with `O(n²)`.

**Action:**
1. Switch to PDA-derived session IDs (hash of gateway + provider + timestamp + nonce)
2. Or use a monotonic counter stored in a global state account
3. Update all session ID references in control-api and edge-gateway

**Files:** `services/solana-programs/proxyhub/programs/session/src/lib.rs`

---

### 2.5 ✅ ~~ADD: JWT Token Refresh Mechanism~~

**Priority:** P1 | **Risk:** Users forced to re-authenticate when tokens expire

**Problem:** No refresh token flow. When JWT expires, the session is lost.

**Action:**
1. Add `POST /v1/auth/refresh` endpoint to control-api
2. Issue refresh tokens alongside access tokens in wallet auth flow
3. Store refresh token hashes in DB (revocable)
4. Update frontend `auth.tsx` to auto-refresh before expiry

**Files:** `services/control-api/internal/api/auth.go`, `apps/web/src/lib/auth.tsx`

---

### 2.6 ✅ ~~ADD: Server-Side Auth Middleware~~

**Priority:** P1 | **Risk:** Frontend auth is client-side only — easy to bypass

**Problem:** No Next.js middleware validates JWT on server-rendered routes.

**Action:**
1. Create `apps/web/src/middleware.ts` with JWT validation
2. Protect authenticated routes (dashboard, wallet, governance, settings)
3. Redirect unauthenticated requests to login
4. Validate against the same JWT secret as control-api

**Files:** `apps/web/src/middleware.ts` (new)

---

### 2.7 ➕ ADD: Disaster Recovery Documentation

**Priority:** P1 | **Risk:** No runbook for database failure, key loss, or service outage

**Action:**
1. Create `docs/runbooks/disaster-recovery.md`
2. Document: PostgreSQL backup/restore, Redis failover, Solana keypair recovery, NATS cluster recovery
3. Add RPO/RTO targets
4. Document secret rotation procedures

**Files:** `docs/runbooks/disaster-recovery.md` (new)

---

## Phase 3 — Structural Changes & Refactoring ⏱️ 3-6 weeks

### 3.1 🔄 CHANGE: Consolidate Dual Frontend API Layers

**Priority:** P2 | **Impact:** Developer confusion, stale code, inconsistent error handling

**Problem:** Both `apps/web/src/lib/api/` (24 modules) and `apps/web/src/lib/services/` (18 modules) exist with 10+ overlapping modules (governance, wallet, social, referral, matching, etc.).

**Action:**
1. Audit which layer each component actually imports
2. Choose one canonical layer (recommend `lib/api/` since it maps 1:1 to backend routes)
3. Migrate all component imports to the canonical layer
4. Delete the deprecated layer
5. Add lint rule preventing imports from the deprecated path

---

### 3.2 🗑️ REMOVE: Decommissioned Ethereum Contracts

**Priority:** P2 | **Impact:** Confusing for contributors, dead code maintenance burden

**Problem:** `packages/contracts/` still contains `ProviderRegistry.sol`, `ProxyMarketplace.sol`, Hardhat config, typechain outputs — all for an EVM chain the project no longer uses.

**Action:**
1. Verify no runtime code imports from `packages/contracts/`
2. Archive the directory (git tag `ethereum-archive-v1` before deletion)
3. Remove `packages/contracts/` from the repo
4. Remove Hardhat test step from CI if still present
5. Update any docs referencing Ethereum contracts

---

### 3.3 🗑️ REMOVE: Dead tls_skip_verify Config

**Priority:** P2 | **Impact:** Misleading operators

**Problem:** `provider-node/src/config.rs` has `tls_skip_verify: bool` but `client.rs` never reads it — always uses strict TLS verification. The field is dead code.

**Action:**
1. Remove `tls_skip_verify` from `Config` struct
2. Remove from `provider.toml` defaults
3. Document that TLS verification is always enforced

**Files:** `services/provider-node/src/config.rs` (L38, L90), `cli/provider.toml`

---

### 3.4 🔄 CHANGE: gRPC Protobuf Generation for Edge-Gateway

**Priority:** P2 | **Impact:** `grpc_stream.rs` still uses placeholder types instead of generated protobuf

**Action:**
1. Finalize `.proto` definitions in `proto/`
2. Add `tonic-build` to edge-gateway `build.rs`
3. Replace manual struct definitions in `grpc_stream.rs` with generated types
4. Add protobuf compilation to CI

**Files:** `proto/`, `services/edge-gateway/build.rs`, `services/edge-gateway/src/grpc_stream.rs`

---

### 3.5 ✅ ~~IMPROVE: Worker Goroutine Panic Recovery~~

**Priority:** P2 | **Impact:** One panicking background worker crashes the entire control-api

**Action:**
1. Add `defer recover()` wrappers to all 15+ background workers in control-api
2. Log panic stack traces and increment `proxyhubb_worker_panics_total` metric
3. Implement automatic worker restart with backoff

**Files:** `services/control-api/internal/workers/`

---

### 3.6 🔄 CHANGE: Global Singleton → Dependency Injection

**Priority:** P2 | **Impact:** Untestable code, hidden dependencies

**Problem:** control-api uses global singletons for DB, Redis, NATS, Solana client. Makes unit testing impossible without real infrastructure.

**Action:**
1. Define interfaces for each service dependency
2. Create a `ServiceContainer` struct passed to handlers
3. Migrate route handlers to accept container instead of reaching for globals
4. Enable mock injection for unit tests

**Files:** `services/control-api/internal/api/`, `services/control-api/cmd/`

---

## Phase 4 — Feature Enhancements ⏱️ 4-8 weeks

### 4.1 ✨ ENHANCE: Emissions System Implementation

**Priority:** P2 | **Impact:** Token economics currently non-functional

**Problem:** Emissions endpoints return 404. No backend implementation exists.

**Action:**
1. Design emissions schedule (block/epoch-based PHB distribution)
2. Create Solana `emissions` instruction in proxyhub program (or separate program)
3. Add `POST /v1/emissions/claim`, `GET /v1/emissions/schedule`, `GET /v1/emissions/stats` endpoints
4. Create migration for emissions tracking tables
5. Implement emissions background worker
6. Add frontend emissions dashboard

---

### 4.2 ✨ ENHANCE: Bandwidth Enforcement in Provider-Node

**Priority:** P2 | **Impact:** Providers can oversell without consequence

**Problem:** provider-node config has bandwidth limits but `tunnel/server.rs` doesn't enforce them.

**Action:**
1. Add bandwidth metering to tunnel streams (bytes transferred per session)
2. Enforce `max_bandwidth_mbps` from config
3. Add rate-limiting at the stream level
4. Report bandwidth usage via metrics

**Files:** `services/provider-node/src/tunnel/server.rs`, `services/provider-node/src/config.rs`

---

### 4.3 ✨ ENHANCE: Provider Capabilities Dynamic Registration

**Priority:** P2 | **Impact:** All providers report same hardcoded capabilities

**Problem:** `provider-node/src/main.rs` registers hardcoded capabilities like `["http","socks5","wireguard"]`.

**Action:**
1. Auto-detect available protocols from config/binary features
2. Dynamic bandwidth/latency probing at startup
3. Report actual GeoIP location (use `geoip/GeoLite2-Country.mmdb`)
4. Periodic re-probing and capability updates

---

### 4.4 ✨ ENHANCE: ML Routing Model (ONNX)

**Priority:** P3 | **Impact:** Intelligent provider selection

**Problem:** `edge-gateway/src/routing/` has ONNX references but no model file or inference logic.

**Action:**
1. Design routing feature vector (latency, uptime, reputation, load, geo-distance)
2. Train model offline and export as `.onnx`
3. Load model in edge-gateway with `ort` crate
4. Fallback to weighted scoring when model unavailable

---

### 4.5 ➕ ADD: Frontend Unit Test Suite

**Priority:** P2 | **Impact:** Zero frontend test coverage

**Action:**
1. Add Vitest + React Testing Library to `apps/web`
2. Create test utilities (mock providers, test wrappers)
3. Write tests for critical components: WalletAuth, GovernanceVote, NotificationCenter, ChannelManager
4. Add to CI pipeline with coverage threshold (60%+)

---

### 4.6 ➕ ADD: SDK Documentation

**Priority:** P2 | **Impact:** No developer documentation for the Go/Rust/JS SDKs

**Action:**
1. Add README.md to each SDK directory (`sdks/go/`, `sdks/js/`, `sdks/rust/`)
2. Document authentication flow, session management, provider selection
3. Add code examples for common operations
4. Generate API reference from code comments

**Files:** `sdks/*/README.md` (new)

---

## Phase 5 — Infrastructure Hardening ⏱️ 2-4 weeks

### 5.1 🚀 IMPROVE: PostgreSQL High Availability

**Priority:** P2 | **Risk:** Single PostgreSQL instance is a SPOF

**Action:**
1. Add PostgreSQL streaming replication config (primary + read replica)
2. Configure connection pooling with PgBouncer
3. Add automated failover (Patroni or managed service)
4. Update docker-compose with replica service
5. Document failover procedures in DR runbook

---

### 5.2 🚀 IMPROVE: Kubernetes HPA Testing & Validation

**Priority:** P2 | **Impact:** K8s manifests exist but HPA is untested

**Action:**
1. Set up load testing with k6 or similar tool
2. Validate HPA scaling triggers for control-api, edge-gateway
3. Tune resource requests/limits based on load test results
4. Add HPA status to monitoring dashboard

**Files:** `infra/k8s/`

---

### 5.3 ✨ ENHANCE: ZK Prover Performance

**Priority:** P2 | **Impact:** Keys regenerated per request, single-threaded, CPU-only

**Action:**
1. Add proving key caching (load once at startup, reuse)
2. Add request parallelism with work queue
3. Investigate GPU acceleration with `bellman` CUDA backend
4. Add proof generation latency metrics

**Files:** `services/zk-prover/src/main.rs`, `services/edge-gateway/src/billing/zk.rs`

---

## Phase 6 — Long-Term Roadmap ⏱️ 2-6 months

### 6.1 ✨ ENHANCE: Multi-Region Deployment

- Geographic provider pools
- Regional edge-gateway instances
- Cross-region replication for PostgreSQL and Redis
- CDN for frontend

### 6.2 ✨ ENHANCE: Mobile Application

- React Native or Flutter wrapper
- Mobile-optimized wallet integration
- Push notifications for session events

### 6.3 ✨ ENHANCE: Enterprise Features

- SAML/SSO authentication
- Team management and RBAC
- Usage quotas and billing integration
- SLA monitoring and enforcement

### 6.4 ✨ ENHANCE: Advanced Bot Detection

- JA3/TLS fingerprinting in edge-gateway
- Browser challenge integration
- Device attestation
- Behavioral analysis

---

## Implementation Priority Matrix

```
                    HIGH IMPACT
                        │
    Phase 1 (P0 Fixes)  │  Phase 2 (P1 Improvements)
    ─ PHB decimals       │  ─ Dep vulnerabilities
    ─ NotificationCenter │  ─ Reputation decay
    ─ WalletConnect      │  ─ JWT refresh
    ─ Referral tables    │  ─ Auth middleware
    ─ ignoreBuildErrors  │  ─ DR documentation
                         │
   ──────────────────────┼──────────────────────────
                         │
    Phase 3 (Refactors)  │  Phase 4 (Enhancements)
    ─ Dual API layers    │  ─ Emissions system
    ─ Remove Ethereum    │  ─ Bandwidth enforcement
    ─ Remove dead config │  ─ ML routing
    ─ gRPC protobuf      │  ─ Frontend tests
    ─ Panic recovery     │  ─ SDK docs
                         │
                    LOW IMPACT
```

---

## Sprint Breakdown (Suggested)

### Sprint 1 (Week 1-2): Critical Fixes
- [x] 1.1 PHB decimal unification
- [x] 1.2 NotificationCenter WebSocket fix
- [x] 1.3 WalletConnect projectId from env
- [x] 1.4 Referral tables migration
- [x] 1.5 Remove ignoreBuildErrors + fix TS errors

### Sprint 2 (Week 3-4): Security & Stability
- [ ] 2.1 Go dependency upgrades + govulncheck in CI
- [ ] 2.2 Rust dependency upgrades + cargo-audit in CI
- [x] 2.5 JWT token refresh flow
- [x] 2.6 Server-side auth middleware
- [x] 3.5 Worker panic recovery

### Sprint 3 (Week 5-6): Code Quality
- [ ] 3.1 Consolidate dual API layers
- [ ] 3.2 Remove Ethereum contracts
- [ ] 3.3 Remove dead tls_skip_verify config
- [ ] 3.4 gRPC protobuf generation
- [ ] 4.5 Frontend unit test setup

### Sprint 4 (Week 7-8): Feature Work
- [ ] 2.3 Reputation decay mechanism
- [ ] 2.4 Session ID collision fix
- [ ] 4.1 Emissions system (design + backend)
- [ ] 4.2 Bandwidth enforcement
- [ ] 4.6 SDK documentation

### Sprint 5 (Week 9-10): Infrastructure
- [ ] 2.7 Disaster recovery documentation
- [ ] 5.1 PostgreSQL HA setup
- [ ] 5.2 K8s HPA validation
- [ ] 5.3 ZK prover performance optimization
- [ ] 3.6 DI pattern introduction

### Sprint 6+ (Week 11+): Enhancements
- [ ] 4.1 Emissions system (frontend + worker)
- [ ] 4.3 Provider capabilities dynamic registration
- [ ] 4.4 ML routing model
- [ ] Phase 6 long-term items

---

## Dependency Graph

```
1.1 PHB Decimals ──────────────────────────────┐
1.5 Remove ignoreBuildErrors ──┐               │
                               ├─→ 3.1 Consolidate API Layers ─→ 4.5 Frontend Tests
3.2 Remove Ethereum ───────────┘               │
                                               │
1.4 Referral Tables ───────────────────────────→ 4.1 Emissions System
                                               │
2.1 Go Vulns ──┐                               │
2.2 Rust Vulns ┴─→ CI Security Gates           │
                                               │
2.5 JWT Refresh ──→ 2.6 Auth Middleware        │
                                               │
2.3 Reputation Decay ─────────────────────────→ 4.3 Provider Capabilities
2.4 Session ID Fix ────────────────────────────→ 5.2 K8s HPA Testing
```

---

## Metrics for Completion

| Phase | Items | Estimated Effort | Completion Criteria |
|-------|-------|-----------------|---------------------|
| Phase 1 | 5 items | 1-2 weeks | Zero P0 bugs, clean TS build, all tables exist |
| Phase 2 | 7 items | 2-4 weeks | 0 reachable vulns, JWT refresh works, DR doc reviewed |
| Phase 3 | 6 items | 3-6 weeks | Single API layer, no dead code, gRPC compiles |
| Phase 4 | 6 items | 4-8 weeks | Emissions functional, 60% frontend coverage |
| Phase 5 | 3 items | 2-4 weeks | PG HA tested, HPA validated under load |
| Phase 6 | 4 items | 2-6 months | Multi-region, mobile app, enterprise features |

**Total remaining items: 31 actionable tasks across 6 phases**

---

*Last updated: Based on SYSTEM_ANALYSIS_REPORT.md findings with verification pass on current codebase state.*
