# ADR 0004 — Edge Gateway v2 deferred items (elephant, pricing, blockchain, ML)

- **Status:** Accepted
- **Date:** 2026-06-02
- **Context phase:** vNext closure — post P4/P5/P6 landing
- **Related:** [`EDGE_GATEWAY_VNEXT_BLUEPRINT.md`](../EDGE_GATEWAY_VNEXT_BLUEPRINT.md), [`adr/0001-edge-gateway-scope-and-ports.md`](./0001-edge-gateway-scope-and-ports.md), [`REMAINING_PHASES.md`](../../services/edge-gateway/docs/REMAINING_PHASES.md)

---

## Context

P0–P4 and most of P5/P6 are implemented locally or signed off. Three closure buckets remain before calling v2 production-ready:

1. Land uncommitted P5/P6 + observability infra in git.
2. Ops proof at scale (10k streams, 24h soak, SLO baseline, alerts).
3. Explicit product/architecture decisions on items deferred from the blueprint.

ADR 0001 preserved `pricing` and `blockchain` behind feature flags pending a wire-or-delete decision. The blueprint also lists elephant raw-TCP, ML routing, NATS metering, and prod-default provider mTLS as open items.

## Decision

### D1 — Elephant raw-TCP fast path · **Deferred**

| Choice | Rationale |
|--------|-----------|
| **Do not implement in v2** | Multi-yamux + QUIC provider transport shipped; dev soak (20–50 tunnels) passes. Raw-TCP bypass adds complexity (dedicated socket per flow, directory ownership edge cases). |

**Revisit when:** 10k+ stream load-lab on dedicated hardware shows mux head-of-line blocking or throughput ceiling vs single-TCP baseline. Track in `P4_TRANSPORT_SOAK.md`.

### D2 — `pricing` module · **Do not wire; keep feature-flagged**

| Choice | Rationale |
|--------|-----------|
| **No routing integration on the edge** | Price/demand belongs in control-api marketplace and listing APIs. The data plane should not embed oracle/demand loops. |
| **Keep `--features pricing`** | Preserves compile-only code for future experiments; CI continues `cargo check --features pricing`. |
| **Do not delete** | Aligns with ADR 0001 — avoid losing work without a replacement design. |

If price-aware routing is needed later, scores should arrive **pre-computed from control-api** (snapshot or header), not from an in-process pricing engine.

### D3 — `blockchain` module · **Do not wire; keep feature-flagged**

| Choice | Rationale |
|--------|-----------|
| **No gRPC usage stream in edge-gateway main** | Settlement and chain interaction belong in control-api / billing workers. Edge meters via existing sync HTTP to control-api. |
| **Keep `--features blockchain`** | Optional build for lab; not in default Docker image. |
| **NATS async metering (blueprint §5.9)** | **Deferred** with this decision — sync path is sufficient for v2 exit. Revisit when billing volume requires event streaming. |

### D4 — ML routing (`ml` / `Dockerfile.ml`) · **Shelved for production**

| Choice | Rationale |
|--------|-----------|
| **Heuristic/geo/health routing remains default** | No production A/B or replay dataset proving ONNX lift. |
| **Keep `ml` feature + `Dockerfile.ml`** | Lab and CI compile checks only. |
| **Production promotion gate** | Measurable routing-quality lift (latency, success rate, or cost) on replay traffic vs baseline heuristic; documented in a future sign-off. |

### D5 — Provider mTLS prod-default · **Opt-in for v2**

`TLS_REQUIRE_CLIENT_CERT` stays **off** in default compose/K8s until provider fleet certificate issuance and rotation are documented. JA3/JA4 fingerprinting on tunnel accept is the v2 security baseline.

## Alternatives considered

- **Delete `pricing`/`blockchain` now.** Rejected — same as ADR 0001; flags cost little and preserve option value.
- **Wire pricing into `select_provider_*` immediately.** Rejected — duplicates control-api marketplace truth and expands hot-path scope.
- **Implement elephant path before scale proof.** Rejected — premature; transport upgrade already delivered multi-yamux/QUIC.

## Consequences

- v2 default edge-gateway binary and image remain lean (auth, route, bridge, meter, registry, optional ingress).
- Blueprint §16 stakeholder checkboxes for pricing/blockchain/ML can be marked decided (this ADR).
- Ops backlog is explicit: 10k soak, 24h soak, `p0-record-baseline.ps1` SLO snapshot, Prometheus alert verification — not blockers for merging P5/P6 code.
- Follow-up: ADR or runbook when revisiting elephant (post load-lab) or ML (post A/B).
