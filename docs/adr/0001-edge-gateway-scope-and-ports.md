# ADR 0001 — Edge Gateway Scope, Canonical Ports, and Dependency Strategy

- **Status:** Accepted
- **Date:** 2026-06-02
- **Context phase:** vNext P0 — "Operational truth"
- **Related:** [`EDGE_GATEWAY_VNEXT_BLUEPRINT.md`](../EDGE_GATEWAY_VNEXT_BLUEPRINT.md), [`REMAINING_PHASES.md`](../../services/edge-gateway/docs/REMAINING_PHASES.md)

---

## Context

The deep dive and vNext blueprint identified that the Edge Gateway suffered from
**configuration drift** and **scope creep**:

1. **Port drift.** `PORT`/`TUNNEL_PORT` defaults differed across `config.rs` (3000/4000),
   `docker-compose*.yml` (8090/3128), `.env*` (mixed), and the K8s manifest (8443/9090,
   plus a `/ready` probe with no implementation). This risked miswiring buyers and providers.
2. **Dead/heavy code on the data plane.** The `blockchain` (gRPC Solana stream) and `pricing`
   (oracle/demand) modules are compiled but **not wired** into `AppState`/`main`. The default
   build pulls in **Solana**, **arkworks ZK**, and optionally **ONNX/CUDA**, inflating image
   size, cold start, and CVE surface for a service whose hot job is auth + route + bridge + meter.

A single source of truth was needed before any performance or scale work.

## Decision

### D1 — Canonical ports (Accepted)

| Port | Env | Role |
|-----:|-----|------|
| **8090** | `PORT` | Buyer proxy API (HTTP/1.1+H2 `CONNECT`, WebSocket) **and** `/metrics`, `/health`, `/ready`. |
| **3128** | `TUNNEL_PORT` | `provider-node` yamux tunnel (TLS-capable). |

Rationale: 8090/3128 is the value already used by `docker-compose*.yml`, `Dockerfile*`,
`provider-node`, `cli`, `control-api`, the web app, and `SYSTEM_ARCHITECTURE_AND_PRODUCT_DEEP_DIVE.md`.
The `config.rs` defaults (3000/4000) and the K8s manifest (8443/9090) were the outliers and
have been corrected to match. `config.rs` defaults now equal the documented values so a bare
run matches the docs.

Consequences:

- `config.rs` defaults updated to `8090`/`3128`; unit test asserts this.
- `main.rs` `CONTROL_API_URL` default aligned to `http://localhost:8080` (matches `Config`).
- K8s manifest fixed: container/Service ports `8090` (`http`) + `3128` (`tunnel`); liveness/startup
  on `/health:8090`, readiness on `/ready:8090`; ServiceMonitor scrapes the `http` port at `/metrics`;
  required secrets (`JWT_SECRET`, `GATEWAY_SHARED_SECRET`, `SESSION_SECRET`, `PROVIDER_PRIVATE_KEY`)
  added via `secretKeyRef`.
- `.env.docker.example`/`.env.example` stragglers (`4000`, buyer `GATEWAY_PUBLIC_URL`) corrected to `3128`/`8090`.

### D2 — Dedicated metrics port (Accepted; implemented P5)

`METRICS_PORT` (canonical **9090**) serves `/metrics` only. Buyer `PORT` (**8090**) returns **404**
for `/metrics` when `METRICS_PORT` is set. Unset or `METRICS_PORT=0` keeps legacy behavior
(metrics on the buyer port) for local bare-metal runs.

### D3 — `/ready` semantics (Accepted)

`/ready` returns `200` when Redis answers `PING` (hard requirement — sessions cannot be
validated without it and the gateway fails-closed). Healthy provider count is reported and,
when `READY_REQUIRE_PROVIDERS=true`, also required. Default is **off** to prevent readiness
flapping on a freshly started pod that has no providers connected yet.

### D4 — Dependency feature-gating & lean default image (Accepted)

The edge default build contains **only** the proxy data plane. Heavy/optional concerns are
behind compile-time features:

| Feature | Purpose | Default image |
|---------|---------|---------------|
| *(none)* | Auth, route, bridge, meter, registry | `Dockerfile` (Debian slim) |
| `ml` | ONNX ML routing (CPU / dynamic load) | opt-in `cargo build --features ml` |
| `ml-gpu` | ONNX + CUDA/TensorRT | `Dockerfile.ml` |
| `legacy-zk` | arkworks Groth16 + Solana edge settlement | not in default build |
| `blockchain` | gRPC usage stream client (unwired in `main`) | not in default build |
| `pricing` | Oracle/demand modules (unwired) | not in default build |

Runtime flag `LEGACY_EDGE_ZK_SUBMISSION_ENABLED` only applies when built with `legacy-zk`.
CI runs `cargo test` on the lean binary and `cargo check --features legacy-zk,blockchain,pricing,ml`
to keep optional bundles compiling. `deploy_manifests_use_canonical_ports` asserts K8s/compose/Dockerfile
parity with `Config::CANONICAL_PORT` / `CANONICAL_TUNNEL_PORT`.

## Alternatives considered

- **Make buyers use 3128 (classic proxy port) and management 8090.** Rejected: the code serves
  buyer `CONNECT` on `PORT` and providers on `TUNNEL_PORT`; the authoritative architecture doc and
  every client config treat 8090 as the buyer API and 3128 as the provider tunnel. Changing buyer
  semantics would be a larger product change with no benefit here. (A separate latent discrepancy —
  `control-api` `session.go` returning a `:3128` buyer endpoint — is flagged for control-api follow-up.)
- **Delete `pricing`/`blockchain` now.** Deferred: preserve the work behind feature flags rather
  than delete, pending the vNext decision on price-aware routing.

## Consequences

- One canonical port mapping across code, compose, env, K8s, and docs.
- K8s manifests become actually deployable (correct ports/probes + required secrets).
- A clear, recorded plan to slim the default image and remove dead code from the hot path.
- Follow-up tickets: (a) implement D4 feature-gating; (b) reconcile `control-api` buyer endpoint string.
