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

### P3b — Tunnel tier split

- [ ] Separate tunnel-gw deployment
- [ ] Edge → tunnel internal API (replace co-located forward)
- [ ] `EDGE_MODE=split`, `TUNNEL_GW_ADDRS`

### P4 — Provider transport

- [ ] Multi-yamux per provider
- [ ] QUIC transport (feature flag)
- [ ] Transport benchmarks

### P5 — Security & observability

- [ ] In-process TLS + ALPN h2
- [ ] JA3/JA4 fingerprinting
- [ ] OTel traces + RED dashboards
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

**Note:** P3 always uses compose project `edge-p3` (`.\scripts\p3-multipod-up.ps1`). Fixed `container_name` values were removed to avoid global name clashes; if you still have old `proxyhubb-p3-*` containers, run `.\scripts\p3-multipod-down.ps1 -RemoveLegacy`.
