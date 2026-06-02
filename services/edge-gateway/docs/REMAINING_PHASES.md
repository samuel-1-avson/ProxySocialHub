# Edge Gateway vNext — remaining work tracker

Tracks [EDGE_GATEWAY_VNEXT_BLUEPRINT](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) phases. Update checkboxes as items complete.

## Near term (close current phases)

### P1 — Hot-path performance · signed off

- [x] Code deliverables (snapshot, moka, logs, splice, allocations)
- [x] CI bench smoke (`registry_bench`, `hotpath_bench` `--test`)
- [x] Full criterion baseline @ 10k (`P1_SIGNOFF.md`, `P1_BASELINE.md`)
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
- [x] QUIC feature flag (`PROVIDER_TRANSPORT`, `--features quic`, `quic_listener` placeholder)
- [x] `transport_bench` + `p4-transport-exit-verify.*` + `p4-transport-smoke.*`
- [x] Sign-off [`P4_SIGNOFF.md`](P4_SIGNOFF.md)
- [ ] Quinn QUIC listener (post-P4)
- [ ] Transport soak at scale (ops / load lab)

### P5 — Security & observability

- [x] OTel bootstrap (`observability`, `--features otel`, [`P5_OTEL.md`](P5_OTEL.md))
- [ ] Hot-path spans (CONNECT, tunnel, registry)
- [ ] RED dashboards
- [ ] In-process TLS + ALPN h2
- [ ] JA3/JA4 fingerprinting (code in `security/fingerprint.rs`; wire on accept)
- [ ] Honeytoken provider attribution

### P6 — Protocol expansion

- [ ] HTTP/3 ingress
- [ ] SOCKS5 ingress

## Ongoing (product / ops)

- [ ] P0 baseline metrics (tunnels/pod, p99 CONNECT, CPU/Gbps) in runbook
- [ ] Marketplace map merge ([MARKETPLACE_NODE_MAP_MERGE_PLAN](../../../docs/MARKETPLACE_NODE_MAP_MERGE_PLAN.md)) if still in scope

## Compose port matrix

| Stack | Buyer | Tunnel | Redis |
|-------|------:|-------:|------:|
| resilience | 18090 | 13128 | 16379 |
| p3-multipod edge-a | 28090 | 23128 | 26379 |
| p3-multipod edge-b | 28091 | 23129 | (shared) |
| p3-split edge-a/b (ingress) | 28100 / 28101 | — | 26479 |
| p3-split tunnel-a/b | 28110 / 28111 | 23228 / 23229 | (shared) |

**Note:** P3 always uses compose project `edge-p3` (`.\scripts\p3-multipod-up.ps1`). Fixed `container_name` values were removed to avoid global name clashes; if you still have old `proxyhubb-p3-*` containers, run `.\scripts\p3-multipod-down.ps1 -RemoveLegacy`.
