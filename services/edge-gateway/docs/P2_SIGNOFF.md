# P2 sign-off — Admission & resilience

**Status:** Signed off (2026-06-02)  
**Scope:** Blueprint §5.2, §6 (session limits, challenge/anomaly), §7 (circuit unify)  
**Detail:** [`P2_ADMISSION_RESILIENCE.md`](P2_ADMISSION_RESILIENCE.md)

## Deliverables

| Item | Evidence |
|------|----------|
| HTTP **503** on admission saturation | `admission.rs`, `main.rs` semaphore `try_acquire` |
| Session time limits | `SessionData.session_within_time_limit()` — CONNECT, Redis, live revalidate |
| Redis auth fail-closed **407** | Auth `Err` → no anonymous CONNECT |
| Unified circuit breaker | `CircuitConfig::from_env` + `circuit_config_from_env` test |
| Challenge enforcement | **429** + `X-Challenge-Token` / `X-Challenge-Response` |
| Anomaly RPM cap | **429** when `MAX_RPM_PER_SESSION` exceeded |
| control-api buyer **8090** | `EDGE_GATEWAY_BUYER_*`, Go tests `BuyerProxy*` |

## Exit criteria

| # | Criterion | Verification | Status |
|---|-----------|--------------|--------|
| 1 | Admission **503** under load | `p2-resilience-smoke.*`, `writes_http_503_and_closes` | Pass |
| 2 | Redis down → **407**, no crash | `p2-resilience-smoke.*` | Pass |
| 3 | Admission soak (503 then recovery) | `p2-admission-soak.*` (hold TCP + flood) | Pass |
| 4 | Extended Redis chaos | `p2-chaos-loop.*` (default 3 cycles) | Pass |
| 5 | Session / circuit unit tests | `p2-exit-verify.ps1` | Pass |
| 6 | control-api buyer port | `go test` `BuyerProxy*` | Pass |

## Commands

**Unit (no Docker):**

```powershell
cd services/edge-gateway
.\scripts\p2-exit-verify.ps1
```

```bash
cargo test --bin edge-gateway session_within_time_limit writes_http_503_and_closes circuit_config_from_env
cd services/control-api && go test ./internal/config/... -run BuyerProxy && go test ./internal/api/... -run BuyerProxyConnectInfo
```

**Integration (Docker resilience stack on 18090):**

```powershell
.\scripts\p2-compose-verify.ps1          # up + all P2 scripts
# or stepwise:
.\scripts\p1-compose-smoke.ps1
.\scripts\p2-resilience-smoke.ps1
.\scripts\p2-admission-soak.ps1
.\scripts\p2-chaos-loop.ps1 -Iterations 3
```

```bash
./scripts/p2-compose-verify.ps1   # use pwsh on Windows; or run individual scripts after compose up
```

## CI parity

| Check | `edge-gateway-check` | `control-api` job |
|-------|----------------------|-------------------|
| Full `cargo test --bin edge-gateway` | Yes (includes P2 unit tests) | — |
| P1 bench smoke | Yes | — |
| `go test` buyer proxy | — | Yes (when control-api changes) |
| Docker P2 integration | Optional local / `p2-compose-verify` | Not in CI (Docker cost) |

Docker-based P2 integration is documented for release gates; unit tests run on every edge-gateway CI change.

## Next phase

**P3** multi-pod — [`P3_MULTI_POD.md`](P3_MULTI_POD.md), `p3-multipod-e2e-full.ps1`.
