# P0 — Edge gateway operational baseline

Capture **real numbers** before scaling or transport changes so P1–P6 work can report deltas. This runbook defines what to measure, how to scrape it, and where results are stored.

Related: [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §8.2 (SLO targets), Grafana [`edge-gateway-red.json`](../../../infra/grafana/dashboards/edge-gateway-red.json).

## Prerequisites

1. **Stack running** — at minimum `redis`, `control-api`, `edge-gateway`, and **one** `provider-node` connected on `TUNNEL_PORT`.
2. **Buyer path** — gateway buyer port reachable (compose default `8090`; resilience stacks may use `18090`).
3. **Metrics** — scrape `http://<host>:<metrics-port>/metrics` (`METRICS_PORT=9090` when split from buyer port; else same as `PORT`).
4. **Optional load** — `hey` or `bombardier` for `/health`; for CONNECT throughput use your provider + authenticated client harness (not covered by `p1-load-smoke.sh`).

## What to record

| Metric | Prometheus series | Notes |
|--------|-------------------|--------|
| Active tunnels | `edge_gateway_active_sessions` | In-flight buyer tunnels |
| Active TCP accepts | `edge_gateway_active_connections` | Proxy connections (buyer side) |
| Healthy providers (pod) | `edge_gateway_healthy_providers` | Refreshed on each `/metrics` scrape |
| Tunnels per pod | `active_sessions` (same as above) | Per-pod gauge; multiply replicas in K8s for cluster total |
| P99 CONNECT control | `histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))` | Excludes destination RTT |
| Auth p99 (proxy path) | `histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="PROXY"}[5m])) by (le))` | Includes CONNECT handling labels |
| Egress Gbps (approx) | `sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9` | Counter-derived; validate with host NIC if disputing |
| CPU | `rate(process_cpu_seconds_total[1m])` | Requires Prometheus `process` collector (enabled in binary) |
| RSS | `process_resident_memory_bytes` | Same |
| Connection errors | `sum(rate(edge_gateway_connection_errors[5m])) by (error_type)` | Spike triage |

### SLO targets (initial — blueprint §8.2)

| Area | Target |
|------|--------|
| Auth (cache hit) p99 | < 2 ms |
| Provider selection p99 | < 3 ms |
| CONNECT control overhead p99 | < 10 ms |
| Tunnel establish p99 (excl. provider RTT) | < 150 ms |

Baseline run **does not** fail the build if SLOs are missed; it **records** current values for comparison.

## Procedure

### 1. Steady-state snapshot (idle + one provider)

```powershell
cd services/edge-gateway
.\scripts\p0-record-baseline.ps1 -MetricsUrl http://127.0.0.1:9090/metrics
```

With legacy metrics on buyer port:

```powershell
.\scripts\p0-record-baseline.ps1 -MetricsUrl http://127.0.0.1:8090/metrics
```

Append a second snapshot after a short CONNECT load test (note load duration in the commit message or run section title).

### 2. Grafana (optional)

Import `infra/grafana/dashboards/edge-gateway-red.json`. Panels **P99 CONNECT latency** and **Active proxy connections** should match PromQL above.

### 3. Host resources

On Linux gateway host during load:

```bash
# CPU % and RSS for edge-gateway process
ps -o pid,pcpu,rss,cmd -C edge-gateway
```

Record **cores allocated**, **replica count**, and **provider count** in the baseline appendix.

### 4. Throughput / tunnels per pod (load lab)

Under sustained authenticated CONNECT traffic:

1. Note `edge_gateway_active_sessions` plateau per pod.
2. Note `rate(process_cpu_seconds_total)` per pod.
3. Derive **tunnels/pod** and **Gbps/pod** at ~70–80% CPU if chasing capacity planning.

Document environment: machine SKU, `YAMUX_CONNS_PER_NODE`, `MAX_CONCURRENT_CONNECTIONS`, provider count.

## Artifact storage

Automated snapshots append to [`P0_BASELINE.md`](P0_BASELINE.md) (git-tracked). Each run includes timestamp, machine name, metrics URL, and parsed gauge/histogram summaries.

**Sign-off:** product/ops agrees the captured row is the reference for “pre-vNext production-like dev stack.” Engineering tracks open soak/SLO proof in [`REMAINING_PHASES.md`](REMAINING_PHASES.md).

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `/metrics` 404 on buyer port | `METRICS_PORT` set — scrape `:9090` instead |
| `healthy_providers` = 0 | Provider not connected; `/ready` may be 503 if `READY_REQUIRE_PROVIDERS=true` |
| No CONNECT histogram | No CONNECT attempts yet — run authenticated proxy client |
| QUIC listener exits at start | `PROVIDER_TRANSPORT=quic` requires TLS cert/key env (same as TCP tunnel TLS) |
| `9092/metrics` connection reset (Docker) | Use buyer-mapped port if `METRICS_PORT` listener is unhealthy, e.g. `http://127.0.0.1:18090/metrics` when compose maps `18090:8090` |
