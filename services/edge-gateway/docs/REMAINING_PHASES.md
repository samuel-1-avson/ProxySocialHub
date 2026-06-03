# Edge Gateway vNext — remaining work tracker

Tracks [EDGE_GATEWAY_VNEXT_BLUEPRINT](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) phases. Update checkboxes as items complete.

## Near term (close current phases)

### P1 — Hot-path performance · signed off

- [x] Code deliverables (snapshot, moka, logs, splice, allocations)
- [x] CI bench smoke (`registry_bench`, `hotpath_bench` `--test`)
- [x] Full criterion baseline @ 10k (`P1_SIGNOFF.md`; raw logs trimmed from `P1_BASELINE.md`)
- [x] Sign-off doc [`P1_SIGNOFF.md`](P1_SIGNOFF.md)
- [ ] Linux flamegraph (optional archive)
- [ ] CONNECT soak with providers (CPU/memory note; out of P1 scope)

### P2 — Admission & resilience · signed off

- [x] HTTP 503 admission
- [x] Session time limits
- [x] Redis fail-closed 407
- [x] control-api buyer :8090
- [x] `CB_*` unified circuit config
- [x] DDoS challenge enforced
- [x] Anomaly RPM block enforced
- [x] `p2-resilience-smoke.*`
- [x] `p2-admission-soak.*` (hold TCP + flood → 503)
- [x] `p2-chaos-loop.*` (3× Redis stop/start)
- [x] Sign-off doc [`P2_SIGNOFF.md`](P2_SIGNOFF.md)

### P3 — Multi-pod (P3a) · signed off

- [x] P3.0 directory claim/release
- [x] P3.1 directory selection
- [x] P3.2 peer forward
- [x] P3.3 multipod compose + smoke
- [x] Full E2E (`scripts/p3-multipod-e2e-full.cmd` or `.ps1` with `-ExecutionPolicy Bypass`; provider on edge-a, CONNECT via edge-b; needs control-api :18080, repo `.env`, `go` for `cmd/p3_seed_redis`)
- [x] `provider_route_selection` Prometheus counters (local / remote / miss)
- [x] Horizontal scale benchmark (`p3-scale-benchmark.*`)
- [x] Pod drain / ownership migration (`pod_drain`, `p3-pod-drain.*`)
- [x] Sign-off [`P3_SIGNOFF.md`](P3_SIGNOFF.md)

### Hygiene

- [x] `services/edge-gateway/target/` in `.gitignore`
- [ ] Commit logical slices (avoid `target/` artifacts)

## Medium term

### P3b — Tunnel tier split · signed off

- [x] **PR 1:** ADR 0002, `EdgeMode::Split`, `EDGE_ROLE`, `TUNNEL_GW_ADDRS`, [`docker-compose.p3-split.yml`](../docker-compose.p3-split.yml), [`P3b_TUNNEL_SPLIT.md`](P3b_TUNNEL_SPLIT.md)
- [x] **PR 2:** reject buyer CONNECT/WebSocket on tunnel tier (`serves_buyer_connect`)
- [x] **PR 3:** ingress → tunnel via `owner_forward_base_url` / `TUNNEL_GW_ADDRS`
- [x] **PR 4:** `p3-split-smoke.*`, [`P3b_SIGNOFF.md`](P3b_SIGNOFF.md)

### P4 — Provider transport · signed off

- [x] Multi-yamux per provider (`YAMUX_CONNS_PER_NODE`, `YamuxMux`, tunnel attach), ADR 0003, [`P4_PROVIDER_TRANSPORT.md`](P4_PROVIDER_TRANSPORT.md)
- [x] `provider-node` multi-dial ([`tunnel/mux.rs`](../../provider-node/src/tunnel/mux.rs))
- [x] QUIC (`PROVIDER_TRANSPORT`, `--features quic`, Quinn listener + provider client)
- [x] `transport_bench` + `p4-transport-exit-verify.*` + `p4-transport-smoke.*`
- [x] Sign-off [`P4_SIGNOFF.md`](P4_SIGNOFF.md)
- [x] Docker QUIC E2E ([`scripts/compose-up-dev.ps1`](../../../scripts/compose-up-dev.ps1), [`scripts/quic-provider-e2e-docker.ps1`](../../../scripts/quic-provider-e2e-docker.ps1))
- [x] Transport soak script + runbook ([`P4_TRANSPORT_SOAK_RUNBOOK.md`](P4_TRANSPORT_SOAK_RUNBOOK.md), `p4-transport-soak.ps1`)
- [x] Dev transport soak (20–50 CONNECT tunnels; snapshots in [`P4_TRANSPORT_SOAK.md`](P4_TRANSPORT_SOAK.md))
- [ ] 10k+ stream load-lab soak (ops — `SOAK_CONCURRENT` on dedicated hardware)

### P5 — Security & observability · observability signed off

- [x] OTel bootstrap (`observability`, `--features otel`, [`P5_OTEL.md`](P5_OTEL.md))
- [x] Docker `ENABLE_OTEL` build arg + dev collector (`infra/otel/collector-dev.yaml`, compose profile `otel`)
- [x] Hot-path spans (CONNECT, bridge, registry, tunnel accept)
- [x] RED dashboard + Grafana provisioning ([`infra/grafana/dashboards/`](../../../infra/grafana/dashboards/))
- [x] Sign-off observability track [`P5_SIGNOFF.md`](P5_SIGNOFF.md)
- [x] JA3 on provider tunnel TLS accept (peek before `TlsAcceptor`)
- [x] In-process TLS + ALPN h2 (buyer `:8090`, opt-in `BUYER_TLS_ENABLE`)
- [x] JA3 on buyer TLS path (peek before `TlsAcceptor` when buyer TLS on)
- [x] JA4 fingerprinting (ClientHello parse, `observe_ja4`, buyer + provider TLS peek)
- [x] JA3 in buyer bot classifier (`BUYER_TLS_ENABLE` + `BotClassifier::score_with_db`)
- [x] Buyer `SO_REUSEPORT` accept pool (`BUYER_ACCEPT_WORKERS`, Linux)
- [x] Honeytoken provider attribution (`attribution_node_id` + slash target)
- [x] Dedicated `METRICS_PORT` listener (`9090`; `/metrics` not on buyer `PORT` when set)

### P6 — Protocol expansion

- [x] HTTP/3 ingress (initial `--features quic`, `ENABLE_HTTP3_INGRESS`, CONNECT over h3/quinn)
- [x] SOCKS5 ingress (`ENABLE_SOCKS5`, `SOCKS5_PORT`, username/password auth, CONNECT)

## Ongoing (product / ops)

- [x] P0 baseline metrics runbook ([`P0_BASELINE_RUNBOOK.md`](P0_BASELINE_RUNBOOK.md), [`scripts/p0-record-baseline.ps1`](../scripts/p0-record-baseline.ps1))
- [ ] Marketplace map cleanup if still in scope (tracked in `docs/reports/IMPROVEMENTS_AND_ROADMAP.md`)

## Compose port matrix

| Stack | Buyer | Tunnel | Redis |
|-------|------:|-------:|------:|
| resilience | 18090 | 13128 | 16379 |
| p3-multipod edge-a | 28090 | 23128 | 26379 |
| p3-multipod edge-b | 28091 | 23129 | (shared) |
| p3-split edge-a/b (ingress) | 28100 / 28101 | — | 26479 |
| p3-split tunnel-a/b | 28110 / 28111 | 23228 / 23229 | (shared) |

**Note:** P3 always uses compose project `edge-p3` (`.\scripts\p3-multipod-up.ps1`). Fixed `container_name` values were removed to avoid global name clashes; if you still have old `proxyhubb-p3-*` containers, run `.\scripts\p3-multipod-down.ps1 -RemoveLegacy`.
