# P3b sign-off — Tunnel tier split

**Status:** Signed off (2026-06-02)  
**Scope:** Blueprint P3b (split ingress / tunnel pools)  
**Detail:** [`P3b_TUNNEL_SPLIT.md`](P3b_TUNNEL_SPLIT.md) · ADR [`0002`](../../../docs/adr/0002-edge-gateway-p3b-tunnel-tier-split.md)

## Deliverables

| PR | Status |
|----|--------|
| PR 1 — `EDGE_MODE=split`, `EDGE_ROLE`, `TUNNEL_GW_ADDRS`, compose sketch | Done |
| PR 2 — Tunnel tier rejects buyer CONNECT/WS (`403`) | Done |
| PR 3 — Ingress forwards via `TUNNEL_GW_ADDRS` (`owner_forward_base_url`) | Done |
| PR 4 — `p3-split-smoke.*`, `p3-split-exit-verify.ps1` | Done |

## Exit criteria

| Criterion | Verification |
|-----------|--------------|
| Split compose starts (4 gateways + Redis) | `p3-split-up.ps1 -Build` |
| Tunnel tier blocks buyer proxy | `p3-split-smoke.ps1` (403 on tunnel HTTP) |
| Ingress serves buyer path (auth gate) | `p3-split-smoke.ps1` (407 without session) |
| Directory visible on ingress | `p3-split-smoke.ps1` (seed + `/debug/directory/stats`) |
| Routing config unit tests | `p3-split-exit-verify.ps1` |

## Commands

```powershell
cd services/edge-gateway
.\scripts\p3-split-exit-verify.ps1
.\scripts\p3-split-up.ps1 -Build
.\scripts\p3-split-smoke.ps1
.\scripts\p3-split-down.ps1
```

## Notes

- **P3b smoke** does not require a live `provider-node`; it validates tier separation, health, directory seed, and ingress auth wiring.
- **Full buyer-via-ingress / provider-on-tunnel E2E** uses the same internal-forward protocol as P3a, but providers must dial **tunnel** host ports (`23228` / `23229`), buyers **ingress** (`28100` / `28101`). Automate in a follow-up if needed.
- **K8s split manifests** remain a future slice (see ADR 0002 D5).

## Next

**P4** — provider transport (multi-yamux / QUIC). **Ongoing** — marketplace map merge, P0 metrics runbook.
