# ProxyHubb System Connectivity Deep Dive

Date: April 14, 2026

## Executive Summary

This audit checks whether the current system is actually connected across the main runtime layers:

- backend and API orchestration
- frontend and API consumption
- blockchain and control-plane integration
- database and migrations
- event and metering pipelines
- service-to-service runtime wiring

Bottom line:

- The system is materially more connected than the earlier roadmap state and is suitable for focused local integration testing.
- The core web, control-api, provider-node, zk-prover, PostgreSQL, Redis, NATS, and Docker wiring are present and coherent.
- The system is not yet fully ready for production-like running because a few key areas are still partial: edge-gateway host validation on Windows, receipt-driven settlement, finality/read-model separation, and some environment-dependent backend test infrastructure.

Recommended readiness call:

- Local feature testing: yes, with environment setup caveats.
- Full end-to-end staging validation: partial.
- Production readiness: not yet.

## Current Readiness Score

| Area | Status | Confidence | Notes |
| --- | --- | --- | --- |
| Frontend build path | Healthy | High | Typecheck passed and production build completed on this host via webpack/WASM fallback |
| Control API compile path | Healthy | High | Targeted lifecycle tests passed; key internal packages compile |
| Control API broad test path | Environment-blocked | High | Many tests require local Postgres test DB on localhost:5432 |
| Provider node | Healthy | High | Cargo check passed with only warnings |
| ZK prover | Healthy | High | Cargo check passed |
| Edge gateway | Environment-blocked | High | Existing OpenSSL/vcpkg host issue still blocks local cargo check |
| Compose wiring | Healthy | High | Core services and health checks are wired in docker-compose |
| Blockchain control-plane integration | Partial | Medium | Solana init, watcher, relayer/oracle hooks exist; settlement boundary still incomplete |
| Data pipelines | Partial | Medium | Redis, NATS JetStream, indexer, billing/ZK paths exist; append-only receipts and settlement coordinator do not |
| Overall system | Partial but testable | Medium | Strong local stack foundation, incomplete production settlement/finality architecture |

## What Is Confirmed Working

### 1. Frontend to backend API connectivity

Confirmed in code:

- apps/web/next.config.ts rewrites both `/v1/*` and legacy `/api/v1/*` to the backend.
- apps/web/src/lib/api/client.ts centralizes authenticated API requests.
- apps/web/package.json has working typecheck and build scripts.

Validated on this host:

- npm run typecheck passed in apps/web.
- npm run build -- --webpack completed successfully.

Implication:

- The frontend is currently connected to the backend through the intended proxy path.
- The previous rewrite-gap class of issue is no longer a primary blocker.

### 2. Backend to database connectivity model

Confirmed in code:

- services/control-api/main.go initializes GORM, Redis-backed config sync, workers, Solana clients, indexers, and route groups.
- services/control-api/internal/db/db.go provides the main DB path.
- migrations now run up to 000076, which includes the recent session intent state-machine slice.
- docker-compose.yml wires postgres as the primary DB with health checks and persistent storage.

Implication:

- The database schema and backend model layer are actively connected and evolving together.
- The recent V2 intent ledger and lifecycle work is persisted, not only in-memory.

### 3. Backend API surface is broad and actively wired

Confirmed in code:

- services/control-api/main.go registers the major protected route groups for sessions, wallet, orders, escrow, usage, staking, governance, analytics, security, provider services, session streaming, trustless flows, disputes, and Solana routes.
- docs/openapi.yaml documents the major public API surface, including the current V2 session-intent endpoints.

Implication:

- The backend is not a stubbed shell; the route graph is real and extensive.
- The API layer and the web session-intent surfaces are aligned on the recent V2 changes.

### 4. Frontend to current V2 session workflow

Confirmed in code:

- apps/web/src/app/dashboard/proxy/page.tsx uses session intent issuance and intent status polling.
- apps/web/src/app/dashboard/sessions/page.tsx renders the intent ledger, lifecycle filters, drill-down, and billing/usage views.
- apps/web/src/lib/api/sessions.ts exposes the V2 session-intent contract.

Implication:

- The web app is now materially connected to the new V2 session-intent workflow instead of relying only on legacy session creation.

### 5. Provider node and gateway-facing control-plane integration

Confirmed in code:

- services/edge-gateway/src/control_api.rs contains node registration, heartbeat, state, and usage update clients.
- services/control-api/internal/api/gateway.go exposes the trusted gateway control-plane endpoints.
- services/provider-node builds successfully and is part of the runtime topology.

Validated on this host:

- cargo check passed in services/provider-node.

Implication:

- The provider-side runtime path is connected to the central control plane.
- Provider-node is currently healthier to validate locally than edge-gateway because it is not blocked by the host OpenSSL issue.

### 6. ZK prover service is connected to backend billing flow

Confirmed in code:

- services/control-api/internal/billing/zk_aggregator.go calls the external Halo2 client and submits ZK batches on-chain through the oracle client.
- services/control-api/internal/billing/zk_aggregator_integration_test.go exists for external prover integration.
- docker-compose.yml wires zk-prover into the local stack.

Validated on this host:

- cargo check passed in services/zk-prover.

Implication:

- The proving service is not just scaffolded; it is connected into the billing path.
- The remaining gap is architectural maturity and operational scaling, not total absence.

### 7. Data and observability infrastructure are wired

Confirmed in code/config:

- docker-compose.yml wires Redis, NATS with JetStream, Prometheus, and Grafana.
- services/control-api/internal/nats/connector.go initializes persistent JetStream streams for sessions, telemetry, and messaging.
- services/control-api/main.go starts the blockchain indexer and node sync services.

Implication:

- The system has real backbone infrastructure for caching, streaming, metrics, and visibility.
- The platform is beyond a single-service prototype.

## What Is Improved Since The Earlier State

### 1. The V2 admission flow is now real

Improved areas:

- signed buyer session intents
- persisted intent ledger
- gateway lifecycle syncing
- web intent ledger and drill-down
- billing-facing usage snapshots

Why it matters:

- This reduces the gap between what the roadmap claims and what the runtime actually does.

### 2. Frontend and API contract alignment is better

Improved areas:

- rewrites now support both `/v1/*` and `/api/v1/*`
- wallet paths are aligned to the current backend SOL-only endpoints
- web type surface for session intents is aligned with the richer lifecycle model

Why it matters:

- The web app is less likely to fail due to obvious path drift or stale session types.

### 3. Local infrastructure wiring is stronger

Improved areas:

- control-api, web, postgres, redis, nats, zk-prover, and edge-gateway all have explicit compose health checks
- db-migrate is separated as a one-shot init path
- frontend builds successfully on this host with the known webpack/WASM workaround

Why it matters:

- Local bring-up and targeted validation are more realistic now.

## Confirmed Weaknesses And Gaps

### 1. Edge gateway local validation is still blocked on this Windows host

Confirmed issue:

- cargo check in services/edge-gateway is still blocked by the existing OpenSSL/vcpkg environment problem.

Impact:

- The source changes look clean in editor diagnostics, but the gateway does not currently have a full host-local compile confirmation on this machine.

Risk:

- Medium for this host, low as a code-quality signal by itself.

### 2. Backend test infrastructure is not self-contained

Confirmed issue:

- A broader go test sweep across control-api packages fails because tests assume a Postgres test database at localhost:5432.

Impact:

- This is not evidence that the code is broken.
- It is evidence that backend validation depends on local infra that is not automatically provisioned by the test command.

Risk:

- Medium. It slows reliable regression testing and makes green CI/local validation harder.

### 3. Data pipelines are present but not at the target V2 settlement architecture

Confirmed issue:

- NATS JetStream exists.
- Indexer exists.
- Usage metering and ZK aggregation exist.
- But append-only signed usage receipts, the settlement coordinator boundary, deterministic epoch manifests, and finality/read-model separation are still not implemented as the primary path.

Impact:

- Buyer accounting and provider settlement are more connected than before, but the system is still not on the intended durable event-driven substrate.

Risk:

- High for production settlement correctness and auditability.

### 4. Blockchain runtime is connected, but full chain-authoritative completion is incomplete

Confirmed issue:

- Solana initialization, oracle loading, watcher/indexer startup, and governance chain-guard work are present.
- But the roadmap still shows partial governance closeout, no full finality/read-model separation, and no buyer credit vault/channel model.

Impact:

- The chain layer is active and meaningful, not theoretical.
- It is still not the final intended authority model for all V2 economics and settlement flows.

Risk:

- Medium to high depending on whether the target is internal testing or public launch.

### 5. API governance and client-generation discipline are still partial

Confirmed issue:

- OpenAPI exists and was updated for the recent V2 session work.
- But generated SDK enforcement and full build-time contract discipline are not yet the enforced norm.
- The frontend still carries both lib/api and lib/services layers, which increases the chance of drift over time.

Impact:

- Current alignment is acceptable, but long-term contract drift risk remains.

Risk:

- Medium.

### 6. Web build has environment warnings that should be cleaned up

Confirmed warnings during build:

- invalid Win32 SWC binary fallback on this host
- deprecated Next middleware naming convention
- multiple lockfile root warning

Impact:

- The build still succeeds, but these warnings are real maintenance debt.

Risk:

- Low for immediate function, medium for developer experience and reproducibility.

## Pros

- The system is clearly multi-service and actually integrated, not just documented.
- The frontend currently compiles and production-builds.
- Provider-node and zk-prover both compile successfully.
- Control-api key internal packages compile, and targeted V2 lifecycle tests pass.
- Compose wiring across web, backend, database, cache, NATS, observability, and proving is coherent.
- The V2 session-intent workflow now spans backend, gateway control-plane, persistence, and UI.
- Solana integration is real and present in the runtime bootstrap.
- Recent improvements materially reduced the gap between the roadmap and the shipped code.

## Cons

- Edge-gateway host-local cargo validation is still blocked on this Windows machine.
- Broad backend tests are not environment-self-contained and fail without a local test Postgres instance.
- The settlement/data-pipeline architecture is still transitional rather than final V2.
- Blockchain finality and settlement separation are incomplete.
- Client/API contract enforcement is still more convention-based than generated-and-enforced.
- The web build path still has avoidable environment and config warnings.

## Testing And Running Readiness

### Ready now

- frontend typecheck and production build
- targeted control-api validation
- provider-node build validation
- zk-prover build validation
- local compose architecture review and service dependency review
- focused feature testing around V2 session intents, dashboards, wallet/API flows, and backend route behavior

### Ready with caveats

- full local stack bring-up, provided secrets and infra env vars are present
- backend API testing, provided a local Postgres test DB is actually running where tests expect it
- explorer/indexer validation, provided Solana devnet RPC and oracle configuration are valid

### Not yet ready as fully proven

- full production-like settlement validation
- durable append-only receipt pipeline testing
- finality-separated chain/read-model validation
- strong cross-platform edge-gateway build confirmation from this host

## Recommended Next Actions

1. Fix host-local edge-gateway Rust validation by resolving the OpenSSL/vcpkg setup so gateway compile health is no longer inferred indirectly.
2. Standardize backend test DB configuration so broad go test runs provision or target a known local Postgres test instance instead of assuming localhost:5432.
3. Implement append-only signed usage receipts and the settlement coordinator boundary before calling the economic pipeline production-ready.
4. Complete the remaining lifecycle progression beyond ledger_committed into batched, chain_committed, and archived through the actual settlement path.
5. Reduce API drift risk by choosing a single primary frontend client layer or moving more of the surface behind generated contract clients.

## Final Assessment

ProxyHubb is no longer in the category of loosely connected subsystems. The backend, frontend, database, cache, NATS, ZK prover, and major control-plane flows are meaningfully wired together, and the recent V2 work improved that materially.

The system is ready for serious local testing and structured integration testing.

It is not yet ready to be described as fully production-ready, because the hardest parts of the platform are still partial:

- edge-gateway host validation on this machine
- durable receipt-driven settlement
- finality/read-model separation
- reusable buyer credit model
- stronger self-contained backend test infrastructure

Practical conclusion:

- Ready for testing: yes
- Ready for running locally with caveats: yes
- Ready for production-style launch confidence: not yet
