# ProxyHubb System Workflow Analysis

Date: April 13, 2026

## Purpose

This document explains how the current ProxyHubb system is intended to work end to end, with emphasis on the runtime workflow between the web app, control-api, edge-gateway, provider-node, Solana, and the supporting data stores.

It is narrower than the comprehensive deep dive report. The goal here is workflow clarity: what starts a flow, which service owns each step, what data is persisted, and where the main operational control points sit.

## System In One View

ProxyHubb is a Solana-backed proxy marketplace with five primary runtime domains:

1. User-facing application flow.
2. Provider onboarding and registry flow.
3. Proxy session creation and traffic flow.
4. Metering, proof, and settlement flow.
5. Monitoring, failure handling, and control-plane security.

At a high level:

- The web app is the presentation and wallet UX layer.
- The control-api is the orchestration and persistence layer.
- The edge-gateway is the live traffic and routing layer.
- Provider nodes are the execution edge that actually serve proxy traffic.
- Solana is the trust and settlement layer.

## Core Components

### Web App

- Primary responsibility: wallet auth, marketplace UX, session UX, monitoring views.
- Talks to control-api over HTTP and websocket-backed flows.

### Control API

- Primary responsibility: authentication, listings, orders, sessions, provider state, governance, explorer, persistence, and chain orchestration.
- Owns most business rules.
- Persists application state in PostgreSQL and caches or coordinates through Redis and NATS.

### Edge Gateway

- Primary responsibility: accept client traffic, select providers, maintain live provider registry, enforce routing and proxy controls, collect usage telemetry, and trigger billing or settlement operations.
- Maintains a live in-memory registry of healthy providers and refreshes routing scores from heartbeat telemetry.

### Provider Node

- Primary responsibility: reverse-tunnel to the gateway, advertise capabilities, send heartbeats, and proxy actual traffic to destinations on behalf of buyer sessions.
- Supplies live node telemetry such as active connections, bandwidth rate, CPU count, memory, and connection type.

### Solana Layer

- Primary responsibility: escrow, proposal and governance state, staking, attestation, and settlement verification or submission paths.
- Oracle and relayer paths bridge off-chain observations into on-chain commitments.

### Data Stores

- PostgreSQL: source of truth for most off-chain business state.
- Redis: caching, registry persistence support, heartbeat coordination, and other distributed runtime coordination.
- NATS: event fan-out and asynchronous workflow support.

## Workflow 1: User Authentication And Application Entry

### Authentication Objective

Allow a buyer or provider to enter the system using a Solana wallet rather than a password login flow.

### Authentication Flow

1. The user opens the web app.
2. The web app requests a wallet challenge from control-api.
3. The user signs the challenge with a Solana wallet.
4. The signed payload is returned to control-api.
5. Control-api validates the signature and issues the application auth session.
6. The frontend stores the access token and continues through protected workflows.

### Authentication Ownership

- Web app: signature UX.
- Control-api: challenge generation, signature verification, token issuance, refresh-token rotation.

### Authentication Runtime Notes

- The dev-login backdoor is no longer part of the active auth path.
- Refresh-token issuance is now fail-closed if `JWT_SECRET` is not configured.
- Control-api no longer silently falls back to a built-in JWT secret in the normal config path.

## Workflow 2: Provider Onboarding And Registry Enrollment

### Provider Onboarding Objective

Allow a provider machine to register, connect to the gateway, declare real capabilities, and become routable.

### Provider Onboarding Flow

1. A provider runs the provider-node CLI.
2. The provider authenticates against control-api and receives a provider JWT or token.
3. The provider-node connects to the edge-gateway over a Yamux tunnel.
4. The provider performs an AUTH handshake.
5. The provider performs a CAPABILITY handshake.
6. The edge-gateway constructs or refreshes NodeInfo for that provider.
7. The gateway persists the node snapshot into the registry store and registers the provider in the live registry.
8. The gateway also registers or updates the node in control-api over the gateway control-plane route.

### What The Provider Now Sends

The provider capability handshake now includes real runtime data instead of fixed placeholder values:

- max connections
- bandwidth limit
- allowed ports
- connection type
- CPU core count
- memory capacity
- OS
- client version
- feature flags

### Provider Onboarding Ownership

- Provider-node: real host capability declaration.
- Edge-gateway: registry admission, capability ingestion, and routing-state updates.
- Control-api: durable provider metadata and business-facing node model.

### Provider Onboarding Runtime Notes

- The gateway now persists node information after registration and after subsequent updates.
- The gateway control-plane auth path now requires the dedicated `GATEWAY_SHARED_SECRET` rather than accepting the general JWT secret as a fallback.
- The stray provider-node mock server artifact has been removed from the active workspace.

## Workflow 3: Live Provider Health And Routing

### Provider Health Objective

Keep routing decisions tied to real provider health rather than stale snapshots.

### Provider Health Flow

1. After connecting, the provider-node starts a heartbeat loop.
2. Each heartbeat carries:
   - node id
   - active connections
   - cumulative bytes up and down
   - bandwidth rate
   - system stats
3. The edge-gateway heartbeat monitor records the heartbeat.
4. The lock-free registry updates the provider's live metrics.
5. The registry score snapshot refresh process re-ranks providers.
6. Unhealthy or stale nodes are marked unhealthy and eventually evicted.

### Current Improvement Already Applied

The gateway registry now consumes heartbeat data directly for:

- active connection count
- latency
- bandwidth rate
- total bytes served
- healthy status restoration

That closes a previous gap where health telemetry existed but routing state could remain stale.

## Workflow 4: Marketplace Order To Proxy Session Activation

### Session Activation Objective

Turn a buyer purchase into an active proxy session backed by escrow.

### Session Activation Flow

1. The buyer selects a listing in the web app.
2. Control-api validates the listing and prepares the purchase flow.
3. A Solana escrow is initialized for the transaction.
4. Control-api mirrors the order and escrow metadata off-chain.
5. When escrow events arrive, control-api processes them through the session activator.
6. On escrow initialization or confirmation, control-api creates or activates the related session.
7. The session becomes eligible for runtime routing through the edge-gateway.

### Session Activation Ownership

- Control-api: order model, session model, escrow event processing.
- Solana: escrow truth.
- Edge-gateway: runtime traffic execution once the session is active.

### Session Activation Runtime Notes

- Premium NFT session treatment is now env-driven instead of using a hardcoded placeholder mint.
- If no valid premium mint is configured, the premium branch fails closed and no bonus is applied.

## Workflow 5: Proxy Traffic Execution

### Proxy Execution Objective

Serve real proxy traffic through the gateway to an eligible provider node.

### Proxy Execution Flow

1. A client request hits the edge-gateway.
2. The gateway resolves the session and routing context.
3. The registry selects a suitable healthy provider.
4. The gateway opens or reuses the tunnel stream to that provider.
5. The provider-node performs outbound proxy work and returns traffic.
6. The provider's local metrics collector tracks connections and byte counts.
7. The gateway observes traffic for metering and settlement preparation.

### Proxy Execution Ownership

- Edge-gateway: request admission, provider selection, stream lifecycle, resilience.
- Provider-node: actual proxy execution.

### Operational Controls

- circuit breakers
- connect and idle timeouts
- multi-gateway reconnect behavior on provider side
- heartbeat-driven health and stale-node eviction

## Workflow 6: Usage Metering, Proof Generation, And Settlement

### Settlement Objective

Move from observed traffic to auditable usage proof and on-chain submission.

### Current Flow Shape

1. Usage accumulates during live proxy handling.
2. Gateway-side billing components prepare usage summaries.
3. The ZK prover derives a digest-based proof for session usage.
4. The Solana relayer submits a single proof or batch commitment on-chain.
5. Control-api and related settlement logic reconcile business state and payouts.

### Current State Assessment

This path is partially real and partially still under active maturation.

What is already real:

- edge-gateway contains an actual Groth16-based ZK proving path
- the relayer contains real Solana transaction submission code
- the gateway invokes proof generation and relayer submission in runtime paths

What still needs scrutiny or continued work:

- end-to-end verification that gateway-produced proofs match the on-chain verifier contract shape
- batching semantics and operational reliability under sustained load
- full production validation of the direct blockchain stream path
- dependency and environment hardening for repeatable builds on all target hosts

## Workflow 7: Explorer And Monitoring Flow

### Monitoring Objective

Expose live and historical system information for operators and end users.

### Monitoring Flow

1. Control-api indexes or mirrors relevant blockchain and business events.
2. Explorer endpoints read from the database and selective chain lookups.
3. Monitoring endpoints expose treasury, settlement, and provider health information.
4. Prometheus scrapes service metrics.
5. Grafana visualizes operational health.
6. Alerts are emitted when settlement telemetry or other monitored thresholds regress.

### Observability Signals

- provider heartbeat health
- treasury balance
- settlement attempts, successes, and failures
- gateway connection errors
- zk prover requests and timing

## Workflow 8: Secret And Config Loading

### Secret Loading Objective

Keep runtime configuration flexible while reducing the chance of live secrets remaining in tracked files.

### Current Control-API Behavior

The control-api now follows this loading order:

1. existing process environment
2. `.env.local`
3. `.env`

Because dotenv loading does not override values that already exist, `.env.local` is the effective local override file and `.env` acts as a sanitized tracked template.

### Why This Matters

- local development can continue without breaking startup
- tracked service-level secrets are no longer required to live in the committed `.env`
- the service now fails closed when required auth secrets are missing

### Remaining Gap

Root workspace secret handling is still a larger follow-up item. The same cleanup pattern has not yet been applied across every root-level flow that depends on the workspace `.env` file.

## Authority Boundaries

The system uses mixed authority domains depending on the workflow:

- Wallet ownership is proved by the user wallet signature.
- Session and business orchestration is owned by control-api.
- Live provider reachability and suitability is owned by edge-gateway.
- Escrow and governance truth is owned by Solana program state.
- Long-term analytics and explorer views are served from the control-api data model.

That means many workflows are hybrid:

- control-api is authoritative for orchestration and caching
- Solana is authoritative for value-locking and certain governance state
- edge-gateway is authoritative for live provider health and request routing

## Failure Modes To Watch

### User Flow Failures

- wallet signature rejected
- stale frontend path hitting a non-existent backend route
- insufficient on-chain balance for escrow or staking actions

### Provider Flow Failures

- provider cannot authenticate to gateway
- capability mismatch or tunnel connection loss
- stale heartbeat causing unhealthy or evicted routing state

### Settlement Flow Failures

- proof generation failure
- relayer transaction failure
- on-chain contract mismatch
- partial off-chain and on-chain state divergence

### Config And Security Failures

- missing `JWT_SECRET`
- missing `GATEWAY_SHARED_SECRET`
- stale tracked secrets remaining elsewhere in the repo
- environment-specific build blockers such as missing OpenSSL toolchain support on certain hosts

## Current Practical Reading Of System Maturity

From a workflow standpoint, the strongest currently implemented paths are:

- wallet-based entry
- provider registration and live registry management
- session activation through escrow events
- live proxy routing and provider heartbeat flow
- core control-api orchestration

The paths that still deserve the most attention are:

- root-level secret cleanup and rotation
- full end-to-end settlement verification confidence
- dependency vulnerability burn-down
- frontend and backend API contract alignment
- governance execution completeness

## Recommended Review Order

If you want to study the platform workflow efficiently, use this order:

1. Read the auth and provider onboarding sections first.
2. Then read session activation and proxy traffic execution.
3. Then read metering, proof, and settlement.
4. End with authority boundaries, failure modes, and maturity assessment.

## Bottom Line

ProxyHubb currently behaves like a hybrid decentralized marketplace where:

- control-api runs the business and orchestration layer
- edge-gateway runs the real-time routing and provider execution layer
- provider nodes provide actual proxy capacity
- Solana provides escrow and protocol trust anchors

The architecture is coherent, and the provider or registry path is now materially stronger than before because live capability, heartbeat, and control-plane security handling are better aligned with real runtime data.

The next major system-wide improvements should focus on the remaining secret cleanup, settlement confidence, and contract consistency between frontend, backend, and chain workflows.
