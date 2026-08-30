# D.1 metrics lock — 20260820T1954Z

| Field | Value |
|-------|-------|
| Host | proxyhubb-testnet |
| Verdict | **PASS** |
| Rollback | `proxyhubb-control-api:pre-metrics-lock-20260820-1950` |
| Edge-a | not recreated (`started=2026-08-13T10:01:36Z`) |

## What shipped

- Caddy `api.proxyhubb.com`: `/metrics*` → 404; other paths still reverse-proxy to `:8080`
- control-api `RequireMetricsAccess`: Host `api.proxyhubb.com` and `X-Forwarded-For` → 404; compose scrape Host `control-api:8080` → 200
- Overlays unchanged: w6 private + w10 observe + w11 enforce last. Slash envs unset. Capability `enforce`, listing `observe`

## Probe

| Check | Result |
|-------|--------|
| `https://api.proxyhubb.com/metrics` | 404 |
| `Host: api.proxyhubb.com` on `:8080/metrics` | 404 |
| `X-Forwarded-For` on `:8080/metrics` | 404 |
| `Host: control-api:8080` on `:8080/metrics` | 200 |
| `http://127.0.0.1:8080/health` | 200 `{"status":"ok"}` |

Compose printed the usual orphan warning (J2 edges / redis-ha). Deploy used `--no-deps --force-recreate control-api` only — no `--remove-orphans`.
