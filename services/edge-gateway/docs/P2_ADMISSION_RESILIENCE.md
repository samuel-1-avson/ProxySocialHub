# P2 — Admission & resilience (signed off)

**Sign-off record:** [`P2_SIGNOFF.md`](P2_SIGNOFF.md) (2026-06-02)

## Implemented

| Item | Detail |
|------|--------|
| HTTP 503 on admission | `admission::write_service_unavailable_and_close` when `MAX_CONCURRENT_CONNECTIONS` semaphore is full |
| Session time limits | `SessionData.created_at` / `expires_at` (chrono), `session_within_time_limit()` on CONNECT, Redis validate, and `revalidate_live_session` |
| Redis auth fail-closed | Existing: auth backend `Err` → HTTP **407** (no anonymous CONNECT) |
| control-api buyer port | `EDGE_GATEWAY_BUYER_HOST` / `EDGE_GATEWAY_BUYER_PORT` (default **8090**); session `proxy_credentials` + SDK examples |

## Env

```bash
# edge-gateway
MAX_CONCURRENT_CONNECTIONS=8192

# control-api
EDGE_GATEWAY_BUYER_HOST=proxy.proxyhubb.com
EDGE_GATEWAY_BUYER_PORT=8090
```

## Verify

```bash
# edge-gateway
cargo test --bin edge-gateway session_within_time_limit
cargo test --bin edge-gateway deploy_manifests_use_canonical_ports
cargo test --bin edge-gateway writes_http_503_and_closes

# control-api
go test ./internal/config/... -run BuyerProxy
go test ./internal/api/... -run BuyerProxyConnectInfo
```

### Integration smoke (Docker)

Stack: `docker-compose.resilience.yml` (`MAX_CONCURRENT_CONNECTIONS=6` for admission test).

```bash
cd services/edge-gateway
./scripts/p1-compose-smoke.sh    # up + health wait + p1-load-smoke
./scripts/p2-resilience-smoke.sh # 503 admission + Redis stop → CONNECT 407
```

Windows:

```powershell
.\scripts\p2-exit-verify.ps1       # unit tests only
.\scripts\p2-compose-verify.ps1    # Docker: smoke + soak + chaos loop
.\scripts\p1-compose-smoke.ps1
.\scripts\p2-resilience-smoke.ps1
.\scripts\p2-admission-soak.ps1
.\scripts\p2-chaos-loop.ps1 -Iterations 3
```

## Sign-off checklist

- [x] `p2-resilience-smoke.sh` / `.ps1` — admission **503** + Redis stop → CONNECT **407**
- [x] `writes_http_503_and_closes` unit test
- [x] `p2-admission-soak.*` — hold permits + flood → **503** then health recovery
- [x] `p2-chaos-loop.*` — repeated Redis stop/start (default 3 cycles)
- [x] `p2-exit-verify.ps1` — session limits + admission + `circuit_config_from_env`
- [x] Unified circuit breaker config — `CB_*` env → `CircuitConfig::from_env`
- [x] Challenge enforcement — **429** + `X-Challenge-Token`; retry with `X-Challenge-Response`
- [x] Anomaly enforcement — **429** when session RPM exceeds `MAX_RPM_PER_SESSION`
