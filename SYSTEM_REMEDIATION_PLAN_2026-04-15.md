# ProxyHubb Remediation Plan

Date: April 15, 2026

## Purpose

This document turns the readiness assessment into an execution plan.

It answers five practical questions:

1. What is actually blocking a safe public launch.
2. What can be deferred until after closed alpha.
3. Which weak areas create the most risk across blockchain, API, database, frontend, workflow, and infrastructure.
4. What should be fixed first.
5. What should be improved for long-term stability and product quality.

Related documents:

- `SYSTEM_READINESS_REPORT_2026-04-15.md`
- `SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md`

## Bottom Line

ProxyHubb should not be treated as publicly launch-ready yet.

The system is strong enough for controlled devnet alpha testing, but it still has concentrated weakness in the exact places that matter most for production:

- on-chain confidence
- end-to-end economic correctness
- cross-service workflow durability
- regression coverage
- stale integration assumptions

The right near-term goal is not "improve everything". The right goal is:

1. close the production blockers,
2. stabilize the user-critical paths,
3. expand coverage around the economic workflow,
4. remove stale or misleading surfaces,
5. then widen the test audience.

## Priority Summary

### P0: Must fix before public beta or production

1. Missing authored Solana-program test coverage.
2. Incomplete end-to-end settlement and finality workflow.
3. Partial workflow/state-machine implementation across session lifecycle.
4. Frontend and tooling drift from the real backend topology.
5. Limited automated coverage for buyer, provider, gateway, and payout flows.
6. Stale or misleading UI surfaces that no longer match backend authority boundaries.

### P1: Strongly recommended before widening external testing

1. Gateway statelessness and routing-state hardening.
2. Database feature parity cleanup and dead/degraded feature handling.
3. Security and dependency remediation.
4. Operational runbooks and incident handling.
5. Provider-node onboarding cleanup.

### P2: Improvement and scaling work after core stabilization

1. Prover pool and throughput scaling.
2. Buyer credit / reusable budget model.
3. Performance optimization and UX polish.
4. Read-model separation and deeper observability.

## Detailed Areas That Need Work

## 1. Blockchain System

### Current weakness

The blockchain layer is still the largest confidence gap in the project.

Why this matters:

- This is where funds, authority, and settlement correctness live.
- If this layer is weak, no amount of frontend polish makes the system safe.

Evidence:

- `SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md` still marks chain-authoritative governance as only partial.
- The roadmap also shows the settlement/finality boundary, prover-pool scaling, and buyer credit model as not started or only groundwork.
- The repo currently does not show authored Solana-program tests under `services/solana-programs`; raw test-like matches came from generated build artifacts under `target/`.

### What needs to be fixed

1. Add real Solana program tests for all critical instructions.
2. Validate escrow, settlement, governance vote, governance execution, staking, and dispute flows against devnet/test validator.
3. Prove that DB mirror updates cannot get ahead of chain truth.
4. Add deterministic failure-path tests for chain unavailable, RPC lag, relay failure, and replay attempts.

### What needs to be improved

1. Tighten the chain-authoritative model until every high-risk mutation uses on-chain proof or fail-closed behavior.
2. Standardize token-decimal handling and on-chain balance interpretation across all surfaces.
3. Add replay-hardening and finality reconciliation for session and governance flows.

### Recommended owner focus

- Solana programs
- control-api Solana integration
- governance and settlement flows

## 2. API and Backend System

### Current weakness

The control-api is the most mature subsystem, but it is still carrying complexity from older workflow shapes and partial roadmap transitions.

Why this matters:

- It is the control plane for auth, listings, sessions, wallet, provider onboarding, governance, explorer, and settlement orchestration.
- Backend maturity is high, but some of its downstream guarantees are still weaker than the API surface suggests.

Evidence:

- Strong API coverage exists in `services/control-api/internal/api`.
- The V2 roadmap shows session intent flow implemented, but lifecycle expansion, settlement coordinator boundary, and finality separation are still open.

### What needs to be fixed

1. Expand the session state machine beyond `authorized`, `active`, and `expired` into the full roadmap lifecycle.
2. Separate request-path orchestration from durable settlement processing.
3. Remove or explicitly deprecate API wrappers and routes that no longer represent active backend behavior.
4. Add end-to-end smoke coverage for provider apply, session create, route activation, usage sync, close, and settlement.

### What needs to be improved

1. Move more async workflow steps behind deterministic event boundaries.
2. Make failure semantics explicit in every economic or chain-touching endpoint.
3. Normalize response contracts so frontend does not need defensive compatibility logic everywhere.

### Recommended owner focus

- control-api session and billing domains
- gateway-control API integration
- OpenAPI contract enforcement

## 3. Database System

### Current weakness

The database is functional, but there are still signs of feature drift, degraded slices, and schema assumptions that need to be tightened.

Why this matters:

- The database is the durable backbone for sessions, users, provider state, usage ledgers, read models, and mirrored chain state.
- If the schema and feature set drift, the product can appear complete while hidden subsystems fail.

Evidence:

- The broader system analysis and repo notes already flagged degraded referral/rewards and unimplemented emissions surfaces.
- The roadmap still expects cleaner read-model separation and dedicated settlement-ledger boundaries.

### What needs to be fixed

1. Decide feature by feature whether degraded areas are to be finished now or hidden from users.
2. Audit all migrations against current runtime code paths.
3. Validate that every user-facing dashboard metric is backed by an actual stable table/view path.
4. Add integration tests for session intents, billing snapshots, provider state, and explorer read paths.

### What needs to be improved

1. Introduce clearer separation between source-of-truth tables and read-model projections.
2. Add schema-level documentation for the intent ledger, billing snapshot, and governance mirror model.
3. Improve recovery and replay strategy for partial workflow failures.

### Recommended owner focus

- database migrations and schema hygiene
- billing and read-model design
- degraded feature cleanup

## 4. Frontend and User Interaction

### Current weakness

The web app is usable, but there is still integration drift and some stale UX surfaces that can mislead testers or break non-primary flows.

Why this matters:

- External testers experience the frontend as the product.
- Even when the backend is correct, stale UI assumptions create support burden and false bug reports.

Evidence:

- `apps/web/src/lib/auth.tsx` now uses same-origin rewrite-safe calls, which is correct.
- `apps/web/src/lib/api/provider.ts` still has a localhost fallback in CLI download URL generation.
- `apps/web/src/app/api/sessions/stream/route.ts` still falls back to `http://localhost:8081`.
- `apps/web/src/app/dashboard/admin/page.tsx` still exists even though admin backend routes were intentionally disabled.

### What needs to be fixed

1. Remove stale `localhost:8081` assumptions from remaining browser and server-side web paths.
2. Remove, hide, or hard-disable UI areas that no longer have active backend support.
3. Align every frontend API wrapper with the active OpenAPI contract.
4. Add E2E tests for provider onboarding, wallet linking, session creation, and explorer-core flows.

### What needs to be improved

1. Make status-driven UX more explicit everywhere, similar to the recent provider onboarding fix.
2. Reduce compatibility branches and fallback behavior that hide real backend drift.
3. Add stronger product telemetry around failed user actions.

### Recommended owner focus

- web API clients and route handlers
- dashboard UX correctness
- hidden/legacy surface cleanup

## 5. System Workflow and Cross-Service State

### Current weakness

The system workflow is the single most important architecture topic after blockchain safety.

Why this matters:

- ProxyHubb is not a single-service CRUD application.
- It is a cross-service workflow product where state must move correctly between web, control-api, edge-gateway, provider-node, database, prover, and chain.

Evidence:

- The roadmap shows session intents are implemented.
- The roadmap also shows append-only signed usage receipts, settlement coordinator boundary, relay/finality separation, and full lifecycle progression are not yet complete.

### What needs to be fixed

1. Implement the complete session lifecycle state machine.
2. Replace usage-delta style coupling with append-only signed usage receipts.
3. Introduce the settlement coordinator boundary so billing, proving, relaying, and finality are deterministic and replayable.
4. Make all workflow transitions idempotent and auditable.

### What needs to be improved

1. Add correlation IDs and event envelopes across service boundaries.
2. Add per-transition observability and stuck-state detection.
3. Design recovery rules for every stage transition and partial failure.

### Recommended owner focus

- session intent lifecycle
- edge metering and receipt production
- settlement orchestration

## 6. Architecture and Infrastructure

### Current weakness

The architecture is good enough for engineering operation, but not yet hardened enough for scale or multi-replica confidence.

Why this matters:

- Production systems fail at boundaries: failover, restart recovery, stateless replication, and secret/config hygiene.

Evidence:

- The runtime stack is healthy locally.
- The roadmap still marks gateway statelessness and shared metadata reconstruction as not started.
- Secret normalization is only partial in the roadmap.

### What needs to be fixed

1. Externalize replica-critical gateway state.
2. Make routing/shard reconstruction safe after gateway restart or horizontal scaling.
3. Normalize environment configuration and secret handling across services and local/dev/prod modes.
4. Add explicit deployment validation for multi-service startup order and degraded-mode behavior.

### What needs to be improved

1. Strengthen infra documentation and env conventions.
2. Add architecture decision records for gateway state, settlement boundaries, and chain truth.
3. Improve operational visibility for compose and future clustered deployments.

### Recommended owner focus

- edge-gateway runtime state
- compose/env consistency
- architecture documentation

## 7. Security and Dependency Posture

### Current weakness

Security is materially better than before, but not yet at a production sign-off level.

Why this matters:

- This project handles auth, session routing, provider identity, wallet-linked actions, and potentially funds.

Evidence:

- The earlier repo findings already flagged dependency vulnerabilities and older hardening gaps.
- The system has removed dev login and disabled legacy admin routes, which is good, but that is not the same as being security-complete.

### What needs to be fixed

1. Re-run dependency and vulnerability scans and close the reachable items.
2. Audit secrets, keys, and env sourcing across all active compose files and runtime services.
3. Validate auth/session refresh, provider tokens, wallet linking, and edge shared-secret flows under abuse scenarios.
4. Confirm rate limiting, replay protection, and brute-force resistance on exposed auth and control-plane routes.

### What needs to be improved

1. Add regular security review cadence.
2. Expand threat modeling for provider leases, gateway routes, and wallet-bound identity actions.
3. Add clearer security runbooks for secret rotation and incident response.

### Recommended owner focus

- dependency upgrades
- auth and provider-token security
- secret lifecycle

## 8. Testing and Quality Assurance

### Current weakness

Testing is the clearest gap between "it works in development" and "we can trust this in production".

Why this matters:

- Without strong coverage, architecture changes and chain integrations will regress silently.

Evidence:

- 34 Go test files exist under `services/control-api`.
- 8 authored Playwright specs exist under `apps/web/e2e`.
- No authored Solana program tests were confirmed.
- The highest-risk end-to-end economic flows are still not well represented in first-party automated coverage.

### What needs to be fixed

1. Add authored on-chain program tests.
2. Add E2E tests for buyer-provider-critical flows rather than mostly page-level smoke tests.
3. Add integration tests spanning control-api, gateway, database, prover, and chain-facing paths.
4. Add failure-path tests, not just success-path tests.

### What needs to be improved

1. Define a testing pyramid by subsystem.
2. Add contract tests between web wrappers and backend OpenAPI.
3. Add deterministic smoke suites for release gating.

### Recommended owner focus

- on-chain tests
- cross-service integration tests
- release-gate smoke tests

## Immediate Fixes To Prioritize In The Next Sprint

This is the fastest high-value stabilization sequence.

### Track A: Launch-critical correctness

1. Add authored Solana-program test coverage for critical instructions.
2. Implement the next lifecycle states in the session workflow.
3. Define append-only usage receipt schema and first durable path.
4. Add deterministic smoke coverage for the buyer-provider-session-close path.

### Track B: User-facing stability

1. Remove remaining stale localhost fallbacks from the web app.
2. Remove or hide admin and other unsupported UI surfaces.
3. Align provider-node defaults and help text with actual ports and URLs.
4. Expand Playwright coverage to provider onboarding and session creation.

### Track C: Architecture hardening

1. Externalize gateway replica-critical state.
2. Add event correlation IDs across control-api and gateway.
3. Define the settlement coordinator boundary.
4. Document read-model vs source-of-truth ownership.

## Weak Spots You Should Treat As Alerts

These are the areas most likely to create serious problems if ignored.

1. On-chain test gap.
2. Partial settlement and finality design.
3. Workflow durability across service boundaries.
4. Stale frontend/tooling assumptions that hide or distort backend truth.
5. Incomplete release-gate test coverage.
6. Legacy or disabled product surfaces still visible in the codebase.

## What To Fix First If The Goal Is "Ready For Real Testers"

If the goal is to start onboarding real testers soon, fix in this order:

1. Frontend and provider-tooling drift.
2. Critical buyer/provider/session smoke coverage.
3. Session lifecycle/state-machine expansion.
4. Durable usage receipt design and implementation.
5. On-chain authored test coverage.

This sequence gives the best near-term payoff because it improves tester experience, reduces support noise, and closes the highest-risk workflow gaps without trying to finish every long-range roadmap item first.

## What To Fix First If The Goal Is "Ready For Production"

If the goal is true production readiness, fix in this order:

1. On-chain test coverage and chain-truth guarantees.
2. Settlement coordinator, relay/finality separation, and durable receipts.
3. Gateway statelessness and restart-safe state reconstruction.
4. End-to-end regression coverage for economic flows.
5. Security and dependency remediation.
6. Remove stale surfaces and finalize product-contract alignment.

## Recommendation

Do not spread effort across every issue at once.

Use a staged remediation approach:

### Phase 1: Closed-alpha stabilization

Focus on:

- stale frontend and tooling defaults
- provider and buyer critical path tests
- workflow visibility and stuck-state reduction

### Phase 2: Workflow and chain hardening

Focus on:

- lifecycle completion
- receipts
- settlement coordinator
- on-chain tests

### Phase 3: Production hardening

Focus on:

- gateway statelessness
- security closure
- operational runbooks
- final release gating

The practical rule is simple:

- do not optimize scale before correctness,
- do not polish UX before removing stale and misleading paths,
- do not call the system production-ready before chain, workflow, and test confidence are all materially stronger.
