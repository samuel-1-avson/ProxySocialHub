# W2.3 — Cross-pod provider selection — PARTIAL

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `W2_3_CROSS_POD_PARTIAL` |

## Verified in-repo

| Layer | Status |
|-------|--------|
| Peer forward implementation | Done (`EDGE_MODE=colocated`, Redis directory, `internal_forward`) |
| P3 lab e2e (provider on A, CONNECT via B) | `services/edge-gateway/scripts/p3-multipod-e2e-full.ps1` |
| J2 compose peer URLs | Wired `edge-a ↔ edge-b` in `docker-compose.j2-multipod.yml` |
| J2 smoke peer env check | `scripts/gcp-smoke-sprint-j2-multipod.sh` asserts `EDGE_PEER_URLS` |
| Live gcp-testnet buyer↔provider cross-pod proof | **Not run in this landing** — treat as sticky-only until operator runs P3-style e2e against j2 ports |

## Honest product claim

**Sticky-only PARTIAL** for production messaging until a recorded live smoke shows:

1. Provider tunnel on edge-a `:3128`
2. Buyer CONNECT to edge-b `:18091` (or sticky Caddy that lands on B)
3. Logs/metrics show peer forward / `route=remote`

Do **not** market “any gateway reaches any provider globally” from J2 alone.

## Non-claims

- Not multi-operator DePIN
- Not trustless provider discovery
- Not multi-region mesh
