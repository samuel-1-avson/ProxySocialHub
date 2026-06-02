# P5 — OpenTelemetry (first vertical)

Blueprint §5 / [`REMAINING_PHASES.md`](REMAINING_PHASES.md) P5 observability track.

## Status

| Item | Status |
|------|--------|
| `observability::init()` + fmt fallback | Done |
| `--features otel` OTLP/gRPC export | Done (opt-in build) |
| Span propagation on hot path (CONNECT, tunnel) | Planned |
| RED metrics / Grafana dashboards | Planned |
| JA3/JA4 wire-up on TLS accept | Separate P5 vertical |

## Build

Default image stays slim (no OTLP deps):

```bash
cargo build
```

OTLP-enabled binary:

```bash
cargo build --features otel
```

Docker: set build arg or alternate Dockerfile stage when you promote OTEL to production images.

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

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4317"
$env:RUST_LOG = "info,edge_gateway=debug"
cargo run --features otel
```

Expect log line: `OpenTelemetry OTLP tracing enabled`.

## Next PRs

1. Root spans: buyer CONNECT, provider tunnel accept, registry pick.
2. `tracing` fields → span attributes (node_id, region, lane index).
3. Prometheus RED panels aligned with existing `/metrics`.
