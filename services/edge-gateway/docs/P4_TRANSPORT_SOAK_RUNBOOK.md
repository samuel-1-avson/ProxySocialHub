# P4 — Provider transport soak

Sustained **buyer CONNECT** load through the provider tunnel (yamux or QUIC) to validate mux stability, registry health, and metrics under concurrency.

Related: [`P4_PROVIDER_TRANSPORT.md`](P4_PROVIDER_TRANSPORT.md), [`P0_BASELINE_RUNBOOK.md`](P0_BASELINE_RUNBOOK.md), snapshots in [`P4_TRANSPORT_SOAK.md`](P4_TRANSPORT_SOAK.md).

## Prerequisites

1. Main stack + provider with **both** compose files (QUIC overlay):
   ```powershell
   .\scripts\compose-up-dev.ps1
   ```
2. Provider credentials: `config/docker/provider.compose.env` (from `bootstrap-provider-docker.ps1`).
3. `.env` with `REDIS_PASSWORD`, `POSTGRES_PASSWORD`, secrets aligned with compose.
4. Buyer port reachable (`EDGE_GATEWAY_PORT`, default `8090`), metrics on `9092` (`EDGE_GATEWAY_METRICS_PORT` maps host → container `9090`).

## What it does

1. Validates `edge_gateway_healthy_providers >= 1`.
2. Seeds a sticky Redis session targeting the connected provider node.
3. Ramps **authenticated HTTP CONNECT** tunnels to `example.com:443` (response `200`, `502`, or `504` = tunnel established through provider transport).
4. Holds tunnels for the soak duration, sampling Prometheus gauges every 30s.
5. Releases tunnels and checks `/health` recovery.
6. Appends results to `docs/P4_TRANSPORT_SOAK.md`.

## Run (dev default: 200 tunnels × 5 min)

```powershell
cd services/edge-gateway
.\scripts\p4-transport-soak.ps1
```

Custom scale:

```powershell
$env:SOAK_CONCURRENT = 500
$env:SOAK_DURATION_SEC = 600
.\scripts\p4-transport-soak.ps1
```

Load-lab target (10k+ streams): run on dedicated hardware with tuned `MAX_CONCURRENT_CONNECTIONS`, multiple providers, and host NIC monitoring. Record machine SKU, `YAMUX_CONNS_PER_NODE`, and `PROVIDER_TRANSPORT` in the soak snapshot note.

## Ops scale schedule (10k / 24h)

**Do not run on the dev laptop** — a 50-tunnel dev soak can saturate `/health` and metrics scrapes.

| Phase | Suggested settings | Pass bar |
|-------|-------------------|----------|
| 10k ramp | `SOAK_CONCURRENT=10000`, `SOAK_DURATION_SEC=600`, ≥3 providers | ≥95% tunnels held; no restarts |
| 24h hold | `SOAK_CONCURRENT=2000–5000`, `SOAK_DURATION_SEC=86400` | ≥95% held; `/health` 200 after release |

**Host:** 8+ vCPU, 16+ GiB RAM, Linux; monitor host NIC + `process_resident_memory_bytes`.

**Before run:** `docker compose up -d prometheus` (alerts volume at `infra/prometheus/alerts`).

**After run:** Append to [`P4_TRANSPORT_SOAK.md`](P4_TRANSPORT_SOAK.md); update [`REMAINING_PHASES.md`](REMAINING_PHASES.md) and [`V2_SIGNOFF.md`](V2_SIGNOFF.md).

```powershell
$env:SOAK_CONCURRENT = 10000
$env:SOAK_DURATION_SEC = 600
cd services/edge-gateway
.\scripts\p4-transport-soak.ps1
```

## Pass criteria

| Check | Dev soak | Load lab |
|-------|----------|----------|
| CONNECT tunnels held | ≥ 50% of target (warn below) | ≥ 95% of target |
| `edge_gateway_healthy_providers` | ≥ 1 all samples | ≥ expected provider count |
| Gateway `/health` after release | 200 | 200 |
| Provider/gateway restarts | none | none |
| `edge_gateway_connection_errors` | no sustained spike | SLO-bound |

## Metrics to watch

| Gauge | Meaning |
|-------|---------|
| `edge_gateway_active_sessions` | In-flight buyer tunnels |
| `edge_gateway_active_connections` | Buyer TCP accepts |
| `edge_gateway_healthy_providers` | Local provider control handles |
| `process_resident_memory_bytes` | Gateway RSS |

Prometheus (if running): compare `rate(edge_gateway_connection_errors[5m])` before/during/after soak.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `healthy_providers=0` | `compose-up-dev.ps1`; check `docker logs proxyhubb-provider-node` |
| All CONNECT fail (407) | Session seed failed; script uses `p3_seed_redis` against `127.0.0.1:6379` — verify `REDIS_PASSWORD` and Redis port |
| `/health` timeout after soak | Dev box saturated; `docker compose restart edge-gateway` and re-run with lower `SOAK_CONCURRENT` |
| CONNECT 429 during ramp | Admission/rate limit; reduce batch size or raise limits for load lab only |
| CONNECT 502/504 only | Provider egress; counts as tunnel established — check provider outbound |
| Metrics missing | Rebuild gateway with `METRICS_PORT=9090`; host scrape `:9092` |
| Yamux/QUIC mismatch | Never start gateway without `docker-compose.provider.yml` when using provider |

## Verification chain

```powershell
.\scripts\p4-transport-exit-verify.ps1   # unit + microbench
.\scripts\quic-provider-e2e-docker.ps1   # live QUIC handshake
.\scripts\p4-transport-soak.ps1          # sustained CONNECT hold
```
