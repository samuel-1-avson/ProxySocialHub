# Edge Gateway v2 — sign-off

Blueprint: [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md). Tracker: [REMAINING_PHASES.md](REMAINING_PHASES.md). Deferred scope: [ADR 0004](../../../docs/adr/0004-edge-gateway-v2-deferred-decisions.md).

**Status:** **Signed off (dev + code path)** — 2026-06-03  
**Ops scale proof (10k / 24h):** scheduled on dedicated hardware (see below).

## Phases delivered

| Phase | Sign-off |
|-------|----------|
| P0 — Operational truth | Ports, `/ready`, ADR 0001 |
| P1 — Hot path | [`P1_SIGNOFF.md`](P1_SIGNOFF.md) |
| P2 — Admission & resilience | [`P2_SIGNOFF.md`](P2_SIGNOFF.md) |
| P3 — Multi-pod | [`P3_SIGNOFF.md`](P3_SIGNOFF.md) |
| P3b — Tunnel tier split | [`P3b_SIGNOFF.md`](P3b_SIGNOFF.md) |
| P4 — Provider transport | [`P4_SIGNOFF.md`](P4_SIGNOFF.md) |
| P5 — Security & observability | [`P5_SIGNOFF.md`](P5_SIGNOFF.md) |
| P6 — Ingress (HTTP/3, SOCKS5) | Code landed `c9a948e`; conformance soak optional |

## v2 closure buckets

### (a) Land P5/P6 in git — complete

Pushed to `origin/main` (`c9a948e`).

### (b) Ops proof — dev complete; scale scheduled

| Item | Status | Evidence |
|------|--------|----------|
| P0 SLO baseline | Done (dev) | [`P0_BASELINE.md`](P0_BASELINE.md) — post-restart idle + after 20×45s soak |
| Prometheus alerts | Done (dev) | 4 rules in `edge_gateway_red` group; scrape `edge-gateway:9090` up |
| 10k+ stream soak | **Scheduled** | [`P4_TRANSPORT_SOAK_RUNBOOK.md`](P4_TRANSPORT_SOAK_RUNBOOK.md) § Ops scale |
| 24h soak | **Scheduled** | Same runbook |

**Dev SLO snapshot (2026-06-03, compose `:18090` / metrics `:9092`):**

| Check | Target (§8.2) | Observed (dev) |
|-------|---------------|----------------|
| Idle `active_connections` after restart | — | 0 |
| `healthy_providers` (steady) | ≥ 1 | 1 after provider reconnect |
| CONNECT control p99 | < 10 ms | Not measured on idle; soak 407/200 mix dominated by prior traffic — use Grafana after clean 5m window for production gate |
| Auth p99 (cache hit) | < 2 ms | Use RED dashboard / PromQL on authenticated CONNECT path |

Baseline recording does not fail the build if SLOs are missed; values are for delta tracking.

### (c) Deferred items — complete (ADR 0004)

Elephant, pricing, blockchain, ML, NATS metering, prod mTLS default — decisions recorded; no v2 code path changes required.

## Ops scale schedule (10k / 24h)

Run on a host **other than the dev laptop** (prior 50-tunnel soak saturated gateway health checks).

| Step | Command / action |
|------|------------------|
| 1. Provision | 8+ vCPU, 16+ GiB RAM, Linux preferred; 1+ provider nodes; NIC monitoring |
| 2. Stack | `compose-up-dev.ps1` + provider overlay; `METRICS_PORT=9090`, Prometheus alerts volume mounted |
| 3. 10k soak | `$env:SOAK_CONCURRENT=10000; $env:SOAK_DURATION_SEC=600; .\scripts\p4-transport-soak.ps1` |
| 4. 24h soak | `$env:SOAK_CONCURRENT=2000; $env:SOAK_DURATION_SEC=86400; …` (tune concurrency to hold ≥95% tunnels) |
| 5. Record | Append to [`P4_TRANSPORT_SOAK.md`](P4_TRANSPORT_SOAK.md); tick boxes in `REMAINING_PHASES.md` |
| 6. Gate | No gateway/provider restarts; `/health` 200 after release; connection_errors within SLO |

**Suggested ops window:** book dedicated hardware when provider fleet ≥3 nodes for meaningful mux load.

## Verification (repeat anytime)

```powershell
.\scripts\compose-up-dev.ps1 -SkipHeal
.\scripts\quic-provider-e2e-docker.ps1 -SkipHeal
cd services\edge-gateway
.\scripts\p0-record-baseline.ps1 -MetricsUrl http://127.0.0.1:9092/metrics
docker compose up -d prometheus   # ensures alerts volume
# http://127.0.0.1:9091/alerts — edge_gateway_red group
```
