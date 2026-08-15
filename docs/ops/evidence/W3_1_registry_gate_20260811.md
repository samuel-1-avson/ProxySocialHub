# W3.1 / DISC-01 — ProviderRegistry gate (observe/enforce)

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `DISC01_REGISTRY_GATE_LANDED` (default `off`) |
| Live gcp | Default **`enforce`** in `docker-compose.gcp-testnet.yml` (2026-08-11); override via `.env` if needed |

## What landed

1. Flags in `decentralization/mode.go`: `PROXYHUB_PROVIDER_REGISTRY_GATE` (`off`/`observe`/`enforce`), heartbeat TTL.
2. `providergate.Check` — reads on-chain `ProviderRegistry` via oracle (separate package to avoid import cycles).
3. Wired into marketplace session activation (`syncSessionToRedis`) and smart-match **enforce** filter.
4. Metrics: `proxyhubb_provider_registry_gate_checks_total{mode,result}`.

## Operator

```bash
# Observe first (log + metric, no buyer breakage)
PROXYHUB_PROVIDER_REGISTRY_GATE=observe
# After registry coverage is healthy:
# PROXYHUB_PROVIDER_REGISTRY_GATE=enforce
```

## Non-claims

- Not on-chain listing catalog
- Not edge CONNECT Solana RPC on hot path
- Not censorship-resistant moderation (W3.4)
