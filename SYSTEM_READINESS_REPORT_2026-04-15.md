# ProxyHubb System Readiness Report

Date: April 15, 2026

## Executive Summary

ProxyHubb has moved beyond a prototype. The core platform now has a working web application, a healthy local runtime stack, a substantial Go backend, a functioning edge gateway, a provider-node CLI, a ZK prover service, and a documented V2 roadmap with several waves already partially or fully landed.

The system is ready for controlled user testing in a devnet or non-production environment. It is not yet ready for unrestricted production launch with real economic risk.

Recommended readiness levels:

- Internal engineering testing: Ready
- Closed alpha with invited testers on devnet: Ready with guardrails
- Public beta with limited real users: Partially ready after one focused stabilization pass
- Production with real funds and broad user traffic: Not ready yet

Current overall assessment:

- Product progress: about 75 percent
- Internal testing readiness: 85 percent
- External beta readiness: 60 percent
- Production readiness: 40 percent

These scores are based on the code currently present, the active local stack health, the implemented roadmap items, the automated validation currently available, and the remaining integration and operational gaps.

## What Is Clearly Working Now

### 1. Core runtime stack is operational

The local compose stack is up and healthy for the primary user-facing services:

- [docker-compose.yml](docker-compose.yml)
- `control-api`, `web`, `edge-gateway`, `postgres`, `redis`, `nats`, and `zk-prover` are all currently running and healthy in local Docker validation.

This is a meaningful milestone because it shows the repo is not just compiling in isolation; the main distributed runtime can actually boot as a system.

### 2. Backend maturity is relatively high

The backend remains the strongest part of the system:

- Session intent issuance and lifecycle APIs are active in [services/control-api/internal/api/session.go](services/control-api/internal/api/session.go)
- Governance hardening and fail-closed tests are present in [services/control-api/internal/api/authority_headers_test.go](services/control-api/internal/api/authority_headers_test.go)
- Provider onboarding, wallet/network metadata, and current devnet-aligned balance checks have recently been corrected across the control-api and web flows

There is meaningful backend test presence. The repository currently contains 34 Go test files under [services/control-api](services/control-api), including API, intent, governance, provider lease, Redis, circuit breaker, billing, and Solana feature-guard coverage.

### 3. The V2 architecture is no longer theoretical

The roadmap is partially implemented, not just planned:

- [SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md](SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md)

Confirmed landed areas include:

- Signed buyer session intents
- Persisted session intent ledger paths
- Provider capability leases
- First shard-aware gateway registry cutover
- Usage and billing snapshot persistence
- Governance hardening toward chain-authoritative behavior

This means the system has a real architectural backbone, not just feature pages over ad hoc service calls.

### 4. Frontend is usable and recently stabilized

The web app now passes its current TypeScript validation path and recent onboarding defects were fixed:

- [apps/web/package.json](apps/web/package.json)
- [apps/web/src/lib/auth.tsx](apps/web/src/lib/auth.tsx)
- [apps/web/src/lib/api/provider.ts](apps/web/src/lib/api/provider.ts)

Recent fixes materially improved product readiness:

- Provider onboarding now reflects pending, approved, and rejected states correctly
- Wallet auth uses rewrite-safe relative API calls in the main auth path
- Solana local/dev flows are aligned to devnet
- CSS preload noise on explorer and provider flows was reduced

### 5. Edge gateway and provider model are real, not conceptual

The edge gateway and provider-node flows are implemented enough to support real system testing:

- [services/edge-gateway/src/auth/session_intent.rs](services/edge-gateway/src/auth/session_intent.rs)
- [services/provider-node/src/main.rs](services/provider-node/src/main.rs)

That matters because the platform's hard problem is not CRUD. It is admission, routing, metering, and settlement across multiple services.

## Where The System Is Still Incomplete

### 1. Production validation depth is still thin

Testing breadth is not where it needs to be for a production-grade platform.

Current direct signals:

- 34 Go test files under [services/control-api](services/control-api)
- 8 Playwright E2E specs under [apps/web/e2e](apps/web/e2e)
- no authored program test files were confirmed under [services/solana-programs](services/solana-programs); the only raw `test` matches came from generated build artifacts under `target/`

Note on count methodology:

- a raw recursive scan under `apps/web` reports many more `*.test` and `*.spec` files if dependency and build-output directories are included
- for product-readiness purposes, the relevant first-party frontend suite currently resolves to the 8 authored Playwright specs in [apps/web/e2e](apps/web/e2e)

The frontend tests are present but still narrow. The current E2E coverage is concentrated in auth, landing-page, basic app navigation, and social features rather than the highest-risk economic flows.

Example:

- [apps/web/e2e/app.spec.ts](apps/web/e2e/app.spec.ts)

This leaves several critical surfaces under-validated:

- buyer session purchase and settlement flows
- provider lease renewal and node lifecycle flows
- dispute, payout, and failure handling flows
- true end-to-end blockchain finality flows
- on-chain program behavior under upgrade or regression conditions

### 2. On-chain and economic risk remains the biggest production blocker

The roadmap itself and earlier audits point to the same conclusion: chain integration is improving but not mature enough for broad production exposure.

- [SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md](SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md)
- [COMPREHENSIVE_DEEP_DIVE_ANALYSIS.md](COMPREHENSIVE_DEEP_DIVE_ANALYSIS.md)

The current state is best described as partial chain-authoritative hardening plus incomplete settlement/finality architecture.

Key missing or incomplete areas:

- the full session state machine is not yet implemented end to end
- append-only signed usage receipts are not yet in place
- settlement coordinator boundary is not yet implemented
- prover pool and queue-backed proof execution are not yet implemented
- buyer credit or funded reusable session budgets are not yet implemented
- governance is much safer, but the roadmap still marks the full chain-authoritative sweep as partial

This is enough for devnet and controlled alpha learning, but not enough for mainnet-grade confidence.

### 3. Frontend integration drift still exists

The frontend is materially better than before, but it still has mixed API base assumptions and stale/deprecated surfaces.

Examples:

- [apps/web/src/lib/auth.tsx](apps/web/src/lib/auth.tsx) uses same-origin relative calls, which is the correct direction
- [apps/web/src/lib/api/provider.ts](apps/web/src/lib/api/provider.ts) still falls back to `http://localhost:8081` in CLI download URL generation
- [apps/web/src/app/api/sessions/stream/route.ts](apps/web/src/app/api/sessions/stream/route.ts) still falls back to `http://localhost:8081`
- [apps/web/src/app/dashboard/admin/page.tsx](apps/web/src/app/dashboard/admin/page.tsx) still exists despite admin backend routes being intentionally disabled

Those are not cosmetic issues. They are evidence that parts of the web application still reflect older topology and authority assumptions.

### 4. Provider-node defaults still need environment cleanup

The provider-node CLI still contains stale local defaults:

- [services/provider-node/src/main.rs](services/provider-node/src/main.rs)

Current examples in that file include:

- default control-api URL of `http://localhost:4000`
- startup/help text that still points users to `http://localhost:3000/explorer/map`

That is not a hard blocker for engineering use, but it does block clean onboarding for external testers unless documentation and defaults are aligned.

### 5. Cross-service operational hardening is incomplete

The compose baseline is solid, but some important production concerns still look mid-flight rather than finished:

- secret normalization is still only partial in the roadmap
- multi-replica stateless gateway reconstruction is not done yet
- receipt durability and event envelope standardization are not done yet
- production-grade relaying and finality separation are still open
- Windows-local validation for some Rust services is still environment-constrained

This means the platform can be operated by the engineering team now, but would still be fragile under broad external traffic or incident response pressure.

## Readiness By Layer

### Web application

Status: Ready for internal and closed-alpha testing, not yet fully production-ready

Strengths:

- builds and typechecks in the current validated path
- large feature surface is implemented
- recent onboarding and auth correctness fixes reduce user confusion

Weaknesses:

- stale API host fallbacks still exist in several paths
- some legacy or disabled product surfaces still appear present in the UI codebase
- limited E2E coverage for economic and provider-critical flows

Readiness score: 7 out of 10

### Control API

Status: The most production-capable subsystem, but still dependent on broader system hardening

Strengths:

- broad route coverage
- meaningful test presence
- healthy runtime in Docker
- better authority boundaries than earlier iterations

Weaknesses:

- still coupled to incomplete downstream architecture in settlement and chain finality
- some features remain degraded, disabled, or roadmap-partial by design

Readiness score: 8 out of 10

### Edge gateway

Status: Good for controlled system testing, not yet sufficient as a production-critical trust boundary

Strengths:

- healthy runtime
- lease-aware and intent-aware admission exists
- shard-aware registry groundwork is in place

Weaknesses:

- roadmap still marks statelessness, receipt substrate, and coordinator boundary as open
- production-scale routing, receipt durability, and finality-linked accounting are not fully closed out

Readiness score: 6.5 out of 10

### Provider node

Status: Functionally usable for engineering and pilot testing

Strengths:

- actual CLI and tunnel workflow exists
- lease/heartbeat model is implemented

Weaknesses:

- stale defaults and UX copy
- less obvious validation depth than the control-api

Readiness score: 6.5 out of 10

### Solana programs and on-chain path

Status: The main production blocker

Strengths:

- substantial chain-authoritative direction is visible in the architecture and API hardening
- devnet-aligned product flows are improving

Weaknesses:

- no discovered program test files under [services/solana-programs](services/solana-programs)
- several roadmap-critical economic/finality items remain partial or not started
- earlier audits already identified this layer as a major confidence gap

Readiness score: 4 out of 10

### ZK proving and settlement pipeline

Status: Real groundwork exists, but this is still not a finished production subsystem

Strengths:

- `zk-prover` service exists and is healthy in Docker
- proof generation groundwork is implemented

Weaknesses:

- roadmap still treats worker-pool scaling and finality separation as open
- production resilience, throughput management, and queue-backed proof execution are not yet complete

Readiness score: 5 out of 10

## Testing Readiness Assessment

If the goal is to let users try the system and generate feedback, the answer is yes, but only under controlled conditions.

### Safe testing scope today

ProxyHubb is ready for:

- internal team testing across the core web flows
- invited external alpha users on devnet
- provider onboarding and dashboard validation
- buyer session-intent and session-dashboard testing
- explorer validation and monitoring/ops exercises
- gateway and provider-node engineering pilots

### Unsafe testing scope today

ProxyHubb is not yet ready for:

- public mainnet launch
- real-money settlement confidence at scale
- unbounded provider self-onboarding without operational supervision
- governance or treasury workflows that assume battle-tested chain execution paths

### What must be true before you onboard external testers

At minimum:

1. Testing must stay on devnet or a clearly non-production economic environment.
2. You should define a narrow test charter: which user journeys are in scope and which are explicitly excluded.
3. You should align stale environment defaults in provider tooling and remaining frontend fallbacks.
4. You should run one focused smoke suite over auth, wallet, provider onboarding, session creation, gateway routing, and session closure before inviting users.
5. You should have an operator playbook for failed onboarding, stuck sessions, wallet-linking issues, and stale role/state issues.

## Production Readiness Assessment

The current answer for production is no.

That is not because the system lacks features. It is because the remaining gaps are concentrated in the exact places where production systems fail expensively:

- economic correctness
- cross-service state transitions
- chain finality handling
- durable settlement evidence
- automated regression coverage
- elimination of stale integration assumptions

In other words, feature completeness is ahead of production confidence.

## Recommended Launch Sequence

### Phase 1: Immediate

Proceed now with internal and invited alpha testing on devnet.

Focus the test group on:

- wallet login and identity flows
- provider application and wallet linking
- session intent creation and dashboard visibility
- explorer and observability paths
- gateway connectivity and provider-node onboarding

### Phase 2: Stabilization pass before public beta

Before a wider beta, complete a short hardening sprint around:

1. Remove stale frontend and provider-node host defaults.
2. Remove or hide admin/disabled product surfaces from the web UX.
3. Add high-value E2E coverage for provider, buyer, and session lifecycle flows.
4. Add explicit smoke tests for gateway, lease renewal, and session closure.
5. Finish the highest-priority roadmap items around lifecycle progression and usage receipt durability.

### Phase 3: Production gate

Do not call the system production-ready until all of the following are true:

1. Solana program tests exist and cover critical instructions.
2. Session lifecycle, usage receipts, settlement coordinator, and finality boundaries are implemented and exercised.
3. Main economic flows have deterministic end-to-end smoke coverage.
4. Remaining stale API host and topology assumptions are removed.
5. Operational runbooks, rollback paths, and incident visibility are proven in rehearsal.

## Bottom Line

ProxyHubb is no longer in the idea stage. It is a real, testable system with strong backend progress, a usable frontend, a healthy local stack, and meaningful V2 architectural progress.

The correct next move is not a public production launch. The correct next move is a controlled devnet alpha with a short stabilization sprint in parallel.

If you want a blunt answer:

- Ready for real user testing in a controlled alpha: yes
- Ready for open public beta without additional hardening: not yet
- Ready for production with real financial and governance risk: no
