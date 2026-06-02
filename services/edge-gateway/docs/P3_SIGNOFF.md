# P3 sign-off — Multi-pod scale-out (P3a)

**Status:** Signed off (2026-06-02)  
**Scope:** Blueprint P3.0–P3.5 (co-located mode)  
**Detail:** [`P3_MULTI_POD.md`](P3_MULTI_POD.md)

## Deliverables

| Slice | Status |
|-------|--------|
| P3.0 Redis ownership claim/release | Done |
| P3.1 Directory-backed selection | Done |
| P3.2 Peer forward (`EDGE_PEER_URLS`) | Done |
| P3.3 Multipod compose + smoke | Done |
| P3.4 Horizontal scale benchmark | `p3-scale-benchmark.*` |
| P3.5 Pod drain + ownership migration | `pod_drain` + `p3-pod-drain.*` |

## Exit criteria

| Criterion | Verification |
|-----------|--------------|
| Provider reachable from any pod (routing path) | `p3-multipod-e2e-full.ps1` |
| Fleet directory visible on non-owner pod | `p3-scale-benchmark.ps1` |
| Pod drain stops traffic + releases ownership | `p3-pod-drain.ps1` |
| Unit tests | `p3-exit-verify.ps1` |

## Commands

```powershell
cd services/edge-gateway
.\scripts\p3-exit-verify.ps1
docker compose -f docker-compose.p3-multipod.yml up -d --build
.\scripts\p3-multipod-smoke.ps1
.\scripts\p3-scale-benchmark.ps1
.\scripts\p3-pod-drain.ps1
```

Full buyer-via-B / provider-on-A E2E still requires control-api + provider-node (`p3-multipod-e2e-full.ps1`).

## Next

**P3b** — signed off ([`P3b_SIGNOFF.md`](P3b_SIGNOFF.md)). **P4** — provider transport upgrade.
