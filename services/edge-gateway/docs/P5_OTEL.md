# P5 — OpenTelemetry (first vertical)

Blueprint §5 / [`REMAINING_PHASES.md`](REMAINING_PHASES.md) P5 observability track.

## Status

| Item | Status |
|------|--------|
| `observability::init()` + fmt fallback | Done |
| `--features otel` OTLP/gRPC export | Done (opt-in build) |
| Hot-path spans (CONNECT, bridge, registry, tunnel accept) | Done (`observability::*_span`) |
| RED Grafana dashboard (`infra/grafana/dashboards/edge-gateway-red.json`) | Done |
| `edge_gateway_healthy_providers` gauge on `/metrics` | Done |
| JA3 on provider tunnel TLS (`peek_ja3_digest_from_tcp`) | Done |
| Buyer TLS + ALPN h2 (`BUYER_TLS_ENABLE`, `tls::create_buyer_tls_acceptor`) | Done (opt-in) |
| JA3 on buyer TLS | Done when `BUYER_TLS_ENABLE` |
| JA4 on provider + buyer TLS (`peek_tls_fingerprints_from_tcp`, `observe_ja4`) | Done |
| JA3 bot scoring on buyer TLS (`score_with_db`, per-connection fp) | Done |
| Buyer `SO_REUSEPORT` (`BUYER_ACCEPT_WORKERS`, `net_listen.rs`) | Done (Linux) |

## Build

Default image stays slim (no OTLP deps):

```bash
cargo build
```

OTLP-enabled binary:

```bash
cargo build --features otel
```

Docker build arg `ENABLE_OTEL=1` (compose: `EDGE_GATEWAY_ENABLE_OTEL=1`):

```powershell
$env:EDGE_GATEWAY_ENABLE_OTEL = "1"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4317"
docker compose build edge-gateway --build-arg ENABLE_OTEL=1
docker compose --profile otel up -d otel-collector edge-gateway
```

Or use [`scripts/p5-otel-docker-build.ps1`](../scripts/p5-otel-docker-build.ps1) / `p5-observability-up.ps1 -WithOtel` with `docker-compose.dev.yml`.

## Runtime env

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `info` | `tracing` filter |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (unset) | e.g. `http://localhost:4317` |
| `OTEL_SERVICE_NAME` | `edge-gateway` | Service name resource |

With `otel` feature and endpoint set, traces export via OTLP/gRPC (tonic). If init fails, gateway falls back to stdout fmt logs.

## Local collector (optional)

```bash
docker run -p 4317:4317 -p 4318:4318 otel/opentelemetry-collector-contrib:latest
```

Point `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317` at a collector that forwards to Jaeger/Tempo.

## Verify

**Prerequisite:** edge-gateway must be listening. Docker often maps **8090 inside the container** to another host port (e.g. `18090`). Check with:

```powershell
docker ps --format "table {{.Names}}\t{{.Ports}}" | findstr gateway
```

```powershell
# Auto-tries 8090, 18090, P3 ports, and docker port mappings
.\services\edge-gateway\scripts\p5-otel-verify.ps1

# Or pin the host port from docker ps
.\services\edge-gateway\scripts\p5-otel-verify.ps1 -MetricsUrl http://127.0.0.1:18090/metrics

# Wait up to 60s while compose starts
.\services\edge-gateway\scripts\p5-otel-verify.ps1 -WaitSeconds 60
```

OTLP export (optional collector on `:4317`) — **`cargo` must run in `services/edge-gateway`**:

```powershell
cd services\edge-gateway
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4317"
$env:RUST_LOG = "info,edge_gateway=debug"
cargo run --features otel
```

Expect log line: `OpenTelemetry OTLP tracing enabled`.

Span names (Tempo/Jaeger): `edge.buyer_connect`, `edge.buyer_connect_bridge`, `edge.provider_select`, `edge.provider_bridge`, `edge.provider_tunnel_accept`.

## Prometheus + Grafana (docker-compose.dev)

`infra/prometheus.yml` already scrapes `edge-gateway:8090/metrics` on the Docker network.

```powershell
.\services\edge-gateway\scripts\p5-observability-up.ps1
```

- Prometheus: http://localhost:9090  
- Grafana: http://localhost:3001 (default admin password from `GRAFANA_ADMIN_PASSWORD` or `admin`)  
- Dashboard **Edge Gateway RED** loads from [`infra/grafana/dashboards/`](../../../infra/grafana/dashboards/) provisioning.

Manual import (if not using compose): [`infra/grafana/dashboards/edge-gateway-red.json`](../../../infra/grafana/dashboards/edge-gateway-red.json).

## Troubleshooting compose

**`db-migrate` / `control-api` password errors**

Docker Compose uses **shell** `POSTGRES_PASSWORD` before `.env`. If your `.env` password differs from the variable in your PowerShell session, migrate fails while manual `psql` with `.env` may work.

```powershell
.\scripts\compose-heal-postgres-password.ps1 -RunMigrate
docker compose up -d control-api edge-gateway
```

**OTel rebuild should not recreate the whole stack**

Use `--no-deps` (default in `p5-otel-docker-build.ps1`) so only `edge-gateway` is recreated after `docker compose build edge-gateway --build-arg ENABLE_OTEL=1`.

## Metrics registration note

All `edge_gateway_*` families are registered in `metrics::init()` at process start (prometheus 0.13 lazy_static). `/metrics` is complete before the first CONNECT.

## Next PRs

1. Additional span fields (region, mux lane index) on bridge hot path.
2. JA3/JA4 fingerprinting on TLS accept ([`security/fingerprint.rs`](../src/security/fingerprint.rs)).
3. ~~Honeytoken provider attribution~~ — `attribution_node_id` on hit; metric `edge_gateway_honeytoken_hits_total{attribution="resolved|unknown"}`.
4. Tempo/Jaeger exporter on collector ([`infra/otel/collector-dev.yaml`](../../../infra/otel/collector-dev.yaml) is debug-only today).
