# 19 — Implementation Roadmap

Complexity: S / M / L / XL (no calendar estimates). Dependencies reference roadmap item IDs. Items already done this audit are marked **[DONE]**.

## Phase 0 — Emergency Security & Financial Fixes

| # | Item | Component | Complexity | Depends | Risk | Acceptance | Tests |
|---|------|-----------|-----------|---------|------|-----------|-------|
| 0.1 | Fail-closed usage signatures | control-api | S | — | low | forged/unsigned reports rejected | 4 unit tests **[DONE]** |
| 0.2 | Role-key standardization | control-api | S | — | low | admin paths authorize | build/vet **[DONE]** |
| 0.3 | On-chain payout binding (escrow+jury) | proxyhub program | S | — | low | wrong-recipient settle fails | cargo check **[DONE]** |
| 0.4 | **Redeploy program** (0.3) + unify program IDs | chain/ops | M | 0.3 | med | devnet settle e2e passes; IDs consistent everywhere | Anchor regression + devnet e2e |
| 0.5 | Session program Config PDA or keep undeployed | session program | L | — | med | unauthorized slash/complete fail | session.ts adversarial |
| 0.6 | Rotate/vault keys; KMS mandatory; split cold treasury | ops/chain | M | — | med | no keys on disk; withdrawals via KMS | ops runbook + smoke |
| 0.7 | k8s pgbouncer/Redis/HAProxy credentials | infra | S | — | low | unauth connections fail | cluster smoke |
| 0.8 | Compose loopback + dev flags off | infra | S | — | low | ports not externally reachable | config review **[DONE]** |
| 0.9 | FE e2e wallet prod guard | web | S | — | low | prod build has no test wallet | tsc **[DONE]** |
| 0.10 | TREASURY JetStream stream | control-api | S | — | low | publish→consume works | round-trip test |
| 0.11 | `GATEWAY_USAGE_PUBLIC_KEY` required in prod | ops/control-api | S | 0.1 | low | startup hard-fails when unset | config test |
| 0.12 | Graceful shutdown | control-api | S | — | low | SIGTERM drains | build **[DONE]** |

## Phase 1 — Restore Core Marketplace Functionality (end-to-end)

| # | Item | Component | Complexity | Depends | Acceptance |
|---|------|-----------|-----------|---------|------------|
| 1.1 | Metering idempotency (content-hash id, WAL requeue, ACK-delete) | edge-gateway | M | 0.1 | no double/under-charge under crash/replay tests |
| 1.2 | Entitlement check at CONNECT + per-session concurrency/RPM/shaping | edge-gateway + control-api | L | — | over-limit buyer rejected; shaped throughput == cap |
| 1.3 | Provider failover (≤2 alternates) | edge-gateway | M | — | killed primary → session survives |
| 1.4 | ISP-targeted routing or honest removal of the claim | gateway + web | M | — | ISP filter honored or UI claim removed |
| 1.5 | Fix authenticated realtime (`/v1/ws` auth + WS termination) | web + infra | M | Sprint A | FE-01 credentials DONE; FE-02 apex→`wss://api.proxyhubb.com` derivation + Caddy note; staging verify on deploy |
| 1.6 | Implement `/v1/network/status` | control-api | S | — | dashboard card live |
| 1.7 | Dispute-admin on admin group + regression tests | control-api | S | 0.2 | admin resolves; user 403 |
| 1.8 | Marketplace indexes + pagination pass | DB | S | — | EXPLAIN uses new indexes |
| 1.9 | TEST-01 order-create authority header | control-api | S | — | CI green |
| 1.10 | Enforce provider leases in prod | gateway/provider | S | — | unleased tunnels rejected |
| 1.11 | HTTP forward-proxy support or explicit CONNECT-only docs | gateway + docs | M | — | classic HTTP proxy works or docs updated |

## Phase 2 — Reliability & Data Integrity

| # | Item | Complexity | Depends |
|---|------|-----------|---------|
| 2.1 | Double-entry ledger migration (+ immutability: REVOKE/trigger; partition-detach archival) | XL | 1.1 |
| 2.2 | Integer lamports end-to-end | L | 2.1 |
| 2.3 | Redis HA + WAL PG fallback | M | — |
| 2.4 | DLQs + retry policies + consumer-lag metrics | M | 0.10 |
| 2.5 | Outbox for P2P chain settle; settle retry queue | M | — |
| 2.6 | finalized-commitment deposits + reorg test | S | — |
| 2.7 | Wire/delete 11 unwired packages (decision records) | S | — |
| 2.8 | Reconciliation → preventive (invariant checks in tx) | L | 2.1 |
| 2.9 | Backup verification automation + DR runbook | S | — |

## Phase 3 — Performance & Scalability

| # | Item | Complexity |
|---|------|-----------|
| 3.1 | k6 product suite (CONNECT path + hot APIs) with SLOs | M |
| 3.2 | ClickHouse pipeline for usage/explorer; OLTP retention window | L |
| 3.3 | Metrics-label audit; tracing backend | S |
| 3.4 | Regional gateway fleets + multipod hardening; autoscale validation | L |
| 3.5 | Rotation lock contention + pool tuning | M |

## Phase 4 — Blockchain Settlement Hardening

> **Production note (2026-07-31):** platform is live on **devnet**; items 4.1 and the KMS/cold-treasury parts of 0.6 are **hard gates for the mainnet move** — the current treasury==hot-wallet setup must not carry real user funds on mainnet.

| # | Item | Complexity | Depends |
|---|------|-----------|---------|
| 4.1 | Program vault PDA for deposits | L | 0.6 |
| 4.2 | Admin binding on proofs/KYC attestations (BC-05) | S | — |
| 4.3 | Multisig nonce bump on settle (BC-06) | S | 0.4 |
| 4.4 | Periodic batched settlement + indexer reconciliation | M | 2.5 |
| 4.5 | Real ZK/reputation or remove claims (BC-11, FE-04) | XL | — |

## Phase 5 — Product & Operational Improvements

| # | Item | Complexity |
|---|------|-----------|
| 5.1 | Probing service → honest uptime/latency/geo/ISP stats | L |
| 5.2 | Agent scheduling/consent (PN-03) + hot config (PN-05) + auto-update (PN-06) | M |
| 5.3 | Remove hardcoded stats (FE-06/07); unify API URL usage (FE-08) | S |
| 5.4 | Typed API error envelope; OpenAPI lint in CI | M |
| 5.5 | Fraud/collusion analytics on warehouse | L |
| 5.6 | Admin tooling completion (wire admin_extended), audit-log UX | M |
| 5.7 | Docs: GCP Phase A runbook, CONNECT-only client guide, provider safety guide | S |

## Exit Criteria

- **MVP-ready with restrictions:** Phases 0 + 1 complete, all tests green, devnet e2e (buy→connect→meter→settle→withdraw) passing.
- **Production-ready:** Phases 2–4 complete; load test at target concurrency with SLOs met; DR drill passed; security re-review of ledger + chain.
