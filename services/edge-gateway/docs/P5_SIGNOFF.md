# P5 — Security & observability sign-off (observability track)

Blueprint: [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §5.

## Scope delivered (observability)

| Item | Status |
|------|--------|
| `observability::init()` + `--features otel` | Done |
| Hot-path spans (CONNECT, bridge, registry, tunnel accept) | Done |
| Prometheus RED metrics + `metrics::init()` registration | Done |
| Grafana RED dashboard + provisioning | Done |
| `p5-otel-verify.ps1`, `p5-observability-up.ps1`, `p5-otel-docker-build.ps1` | Done |
| Docker `ENABLE_OTEL` + compose profile `otel` + collector | Done |
| CI `cargo check --features otel` | Done |

## Scope delivered (security — partial)

| Item | Status |
|------|--------|
| JA3 on provider tunnel TLS accept (peek ClientHello before `TlsAcceptor`) | Done |
| HTTP-layer bot classifier (UA, header order) | Done (pre-P5) |

## Deferred (remaining P5)

| Item | Notes |
|------|--------|
| In-process TLS + ALPN h2 on buyer `:8090` | Done (`BUYER_TLS_ENABLE`, `create_buyer_tls_acceptor`) |
| JA3 on buyer path | Done when buyer TLS enabled (peek + `fingerprint_db`) |
| JA4 on provider + buyer TLS (`Ja4Fingerprint`, `fingerprint_db.observe_ja4`) | Done |
| JA3 in buyer `BotClassifier` when `BUYER_TLS_ENABLE` | Done (`score_with_db`, per-connection TLS fp) |
| Buyer `SO_REUSEPORT` accept pool (`BUYER_ACCEPT_WORKERS`, Linux) | Done (`net_listen.rs`) |
| Honeytoken provider attribution | Done (`attribution_node_id`, `edge_gateway_honeytoken_hits_total`) |

## Verification

```powershell
# Metrics (host port from docker ps, often 18090)
.\services\edge-gateway\scripts\p5-otel-verify.ps1 -Strict -MetricsUrl http://127.0.0.1:18090/metrics

# OTLP image + collector (main compose)
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4317"
.\services\edge-gateway\scripts\p5-otel-docker-build.ps1
docker logs proxyhubb-edge-gateway-1 2>&1 | Select-String OTLP

# Grafana
.\services\edge-gateway\scripts\p5-observability-up.ps1
```

JA3: enable `TLS_CERT_PATH` / `TLS_KEY_PATH` on gateway, connect provider over TLS to `TUNNEL_PORT`; trace logs include `ja3=` and span field `tls.ja3_digest`.

## References

- [`P5_OTEL.md`](P5_OTEL.md)
- [`infra/grafana/dashboards/edge-gateway-red.json`](../../../infra/grafana/dashboards/edge-gateway-red.json)
- [`infra/otel/collector-dev.yaml`](../../../infra/otel/collector-dev.yaml)
