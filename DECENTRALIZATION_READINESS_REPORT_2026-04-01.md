# ProxyHubb Decentralization Readiness Report

Date: 2026-04-01
Scope: Full codebase review with emphasis on blockchain authority, trust boundaries, and execution maturity

## Executive Summary

ProxyHubb is architecturally ambitious and already contains substantial blockchain-oriented components (Solana program suite, oracle client, usage proof models, staking and governance primitives). However, the current running system is still predominantly centralized at runtime.

Current decentralization readiness: 4/10

Why this score:
- Critical user and provider flows still depend on centralized control-plane services (Control API, PostgreSQL, Redis).
- Multiple blockchain pathways are optional, mocked, or partially integrated.
- Governance, staking, and dispute logic are hybrid and often finalized in off-chain databases.
- Cross-chain direction is fragmented (Solana + Ethereum relayer/contracts), increasing risk and slowing production hardening.

## Method and Coverage

This review used direct code inspection across core runtime directories and key deployment/config artifacts:
- apps, services, packages/contracts, programs, sdks, proto, migrations, docker-compose

Quantitative snapshot (core engineering scope):
- Core files reviewed scope: 947
- Core code files: 833
- Core test files detected: 34
- Placeholder/maturity markers in core code (TODO, stub, mock, placeholder, unimplemented): 254

These counts indicate meaningful implementation depth, but also a significant amount of transitional and prototype logic still present in production paths.

## Current System Reality

### What is decentralized already

- Solana smart-contract workspace exists with advanced escrow, multisig, governance, usage proof, and dispute contexts.
- Control API has a Solana oracle client with transaction building, RPC failover, usage proof submission, and settlement telemetry.
- Web client includes direct wallet-enabled Solana interactions for some paths.
- Dispute and governance flows include on-chain anchoring hooks.

### What remains centralized in practice

- Session authorization and traffic gating depend on Redis session records and Control API-issued data.
- Provider node registration, heartbeat, health, and quality tiers are managed centrally.
- Social, forum, messaging, circles, notifications, and many governance/dispute records are database-first.
- Settlement and payout orchestration still run through centralized workers and services.

## Priority Findings

### Critical

1. Blockchain execution paths contain mock and placeholder behavior in live gateway code.
- Evidence: services/edge-gateway/src/billing/zk.rs, services/edge-gateway/src/billing/solana.rs, services/edge-gateway/src/blockchain/grpc_stream.rs, services/edge-gateway/src/main.rs
- Impact: The system can appear decentralized while not enforcing trustless settlement end-to-end.

2. Core control plane is still a centralized trust root.
- Evidence: services/edge-gateway/src/auth.rs, services/edge-gateway/src/control_api.rs, services/provider-node/src/ip.rs, services/control-api/main.go, docker-compose.yml
- Impact: If Control API/Redis is unavailable or compromised, session validity, provider state, and routing authority are affected.

3. Governance and dispute outcomes are still primarily DB-driven with partial on-chain anchoring.
- Evidence: services/control-api/internal/api/governance.go, services/control-api/internal/api/dispute_jury.go, services/control-api/internal/api/escrow.go
- Impact: Voting/dispute legitimacy can still depend on backend logic and DB writes rather than purely on-chain finality.

4. Staking pathway in public API is off-chain and mints synthetic tx hashes.
- Evidence: services/control-api/internal/api/staking.go
- Impact: Economic security assumptions (stake-backed behavior/slashing) are weaker than implied.

5. Secret and key custody posture is unsafe for decentralized trust claims.
- Evidence: .env contains populated secrets; workspace includes treasury/oracle keypair files and token artifacts.
- Impact: Single-operator key compromise can undermine treasury and oracle integrity.

### High

6. Chain strategy is fragmented between Solana and Ethereum.
- Evidence: services/relayer, packages/contracts, services/solana-programs
- Impact: Duplicated effort, inconsistent settlement semantics, and delayed hardening.

7. Ethereum contracts/tests show API drift.
- Evidence: packages/contracts/contracts/ProxyMarketplace.sol vs packages/contracts/test/ProxyHub.test.ts
- Impact: Contract package is not currently a reliable production path.

8. Session Solana program is not production-addressed.
- Evidence: services/solana-programs/proxyhub/programs/session/src/lib.rs and Anchor.toml use placeholder session program id.
- Impact: Session-chain features cannot be treated as deployed or authoritative.

9. Frontend/backend API drift exists in wallet routes.
- Evidence: apps/web/src/lib/api/wallet.ts calls legacy endpoints; services/control-api/internal/api/wallet.go removed/changed several fiat-era routes.
- Impact: UX inconsistencies and broken user flows reduce operational trust.

## Strengths Worth Preserving

- Solana client design includes endpoint failover and robust transaction helpers.
- Settlement telemetry and monitoring hooks are already present.
- Batch payout processor includes idempotency and retry/reconciliation safeguards.
- Anchor program design in proxyhub includes serious primitives (multisig, pause controls, usage proof anchoring, governance records).

## Decentralization Gap Matrix

| Domain | Current State | Risk | Target State |
|---|---|---|---|
| Session auth and routing | Redis + API authority | High | On-chain or cryptographically delegated capability tokens, independently verifiable at gateway |
| Escrow settlement | Mixed (on-chain hooks + off-chain workers/mocks) | High | Mandatory on-chain settlement for value transfer, no off-chain finality override |
| Provider registry | API/DB with heartbeat | High | On-chain provider registry + slashing events + off-chain index mirror |
| Governance | DB-first with optional on-chain anchoring | High | Wallet-signed on-chain votes and on-chain finalization as source of truth |
| Disputes and jury | DB jury + asynchronous chain calls | High | On-chain jury vote records and deterministic settlement execution |
| Staking | API-level ledger updates | High | Canonical on-chain staking and unstaking state |
| Reputation/quality | Mixed DB metrics and experimental proofs | Medium | Signed attestations with periodic on-chain commitments |
| Social and messaging | Fully centralized DB | Medium | Keep off-chain, but anchor integrity checkpoints and moderation proofs as needed |

## Recommended Direction: Canonical Chain and Progressive Decentralization

Recommendation: choose Solana as the single canonical settlement and governance chain for v1 decentralization.

Rationale:
- Existing code depth and integration are much stronger on Solana than Ethereum in this repository.
- Running both chain stacks now increases attack surface and delivery risk.
- You can preserve optional multichain later via bridges or modular adapters after single-chain hardening.

## Phased Execution Plan

### Phase 0 (1-2 weeks): Decision and Safety Baseline

Deliverables:
- Publish ADR: Solana is canonical for escrow, staking, governance, disputes.
- Mark Ethereum relayer/contracts as legacy or experimental and remove from production runtime path.
- Rotate all exposed secrets and keypairs; move oracle and treasury signing into HSM/KMS-backed flow.
- Enforce fail-closed behavior when oracle is unavailable for settlement-critical routes.

Exit criteria:
- No plaintext signing keys in repo/workspace for production.
- Production services do not proceed with value-changing operations if chain authority is unavailable.

### Phase 1 (3-6 weeks): Make Value Flow Trustless by Default

Deliverables:
- Remove mock settlement/proof submission paths from gateway billing modules.
- Wire real generated gRPC/proto types or disable unfinished blockchain streaming module until production-ready.
- Enforce on-chain escrow settlement finality before DB completion for all paid sessions.
- Replace off-chain staking API behavior with on-chain staking transactions and indexed balances.

Exit criteria:
- Every provider payout has an on-chain tx hash confirmed before ledger finalization.
- No fake tx hashes returned by public APIs.

### Phase 2 (6-10 weeks): Decentralize Control Plane Authority

Deliverables:
- Replace Redis-only session trust with signed capability tokens bound to chain-anchored commitments.
- Put provider registration and slashable liveness commitments on-chain; keep fast off-chain mirror for query performance.
- Add reproducible verification paths so gateway can validate session and provider claims independently.

Exit criteria:
- Gateway can continue secure verification during partial control-api outages.
- Session validity can be verified cryptographically without exclusive DB trust.

### Phase 3 (8-14 weeks): Governance and Dispute as On-Chain Source of Truth

Deliverables:
- Move vote counting and proposal finalization authority on-chain.
- Persist jury votes and dispute outcomes on-chain with deterministic payout/refund instructions.
- Restrict admin override to emergency pause/guardrails with auditable on-chain events.

Exit criteria:
- Proposal outcomes and dispute resolutions are derivable from chain state alone.
- Backend cannot silently rewrite governance or dispute outcomes.

## Immediate Next Actions (next 14 days)

1. Create a Decentralization Readiness epic with 3 workstreams:
- Settlement hardening
- Control-plane cryptographic authority
- Governance/dispute chain authority

2. Ship a safety patch release:
- Disable mock settlement/proof paths in edge-gateway or gate them behind explicit non-production flags.
- Enforce fail-closed on settlement endpoints when oracle is not configured.

3. Ship a consistency patch release:
- Align wallet frontend endpoints with current backend routes.
- Add integration tests for wallet, escrow release, and dispute flow.

4. Create chain-source-of-truth dashboards:
- Percent of completed payouts backed by confirmed on-chain tx
- Percent of disputes resolved on-chain
- Percent of governance votes recorded on-chain

## Final Assessment

ProxyHubb is not far from a strong decentralized architecture, but it is currently a hybrid platform where centralized services still hold decisive authority in critical flows.

The fastest path to a working blockchain-native system is not to force every feature fully on-chain immediately. Instead:
- Make all value transfer and final authority decisions on-chain first.
- Keep high-frequency/social features off-chain but cryptographically anchored.
- Remove mocks and optional trust bypasses from production code paths.

If executed in phases above, ProxyHubb can transition from a centralized-orchestrated blockchain product to a genuinely trust-minimized network with auditable on-chain finality.
