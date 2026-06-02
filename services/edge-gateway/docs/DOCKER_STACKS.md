# Edge gateway — which Docker stack to use

Only one **buyer** gateway should own ports **8090** / **3128** for the main ProxyHubb dev loop. P3 and resilience stacks use **different host ports** on purpose.

## Canonical stacks

| Purpose | Compose project | File | Buyer (host) | Tunnel (host) | Redis (host) |
|---------|-----------------|------|-------------:|--------------:|-------------:|
| **Main dev** (with `proxyhubb` / control-api) | `proxyhubb` | repo `docker-compose.dev.yml` → `edge-gateway` | **8090** | **3128** | `proxyhubb-redis` :6380 |
| **P1 / P2** resilience tests | `edge-resilience` | `docker-compose.resilience.yml` | **18090** | **13128** | **16379** |
| **P3** multipod | `edge-p3` | `docker-compose.p3-multipod.yml` | **28090** / **28091** | **23128** / **23129** | **26379** |
| **P3b** split (sketch) | `edge-p3-split` | `docker-compose.p3-split.yml` | **28100**–**28101** (ingress), **28110**–**28111** (tunnel health) | **23228** / **23229** | **26479** |

## Commands

```powershell
cd services/edge-gateway

# P3 (recommended for multipod / pod-drain work)
.\scripts\p3-multipod-up.ps1 -Build
.\scripts\p3-multipod-down.ps1 -RemoveLegacy   # drops old fixed-name containers

# P2 resilience only (do not run alongside duplicate project names)
docker compose -p edge-resilience -f docker-compose.resilience.yml up -d --build
docker compose -p edge-resilience -f docker-compose.resilience.yml down

# P3b split (ingress + tunnel tiers)
.\scripts\p3-split-up.ps1 -Build
.\scripts\p3-split-smoke.ps1

# Remove legacy / duplicate stacks
.\scripts\edge-docker-cleanup.ps1
```

## Do not use

- Fixed names `proxyhubb-p3-redis`, `proxyhubb-p3-edge-a`, `proxyhubb-p3-edge-b` (removed from compose; use `edge-p3` project).
- Duplicate compose project `edge-gateway` for the same `docker-compose.resilience.yml` (use **`edge-resilience`** only).

## After cleanup

- Dev UI / control-api → `http://127.0.0.1:8090` (`proxyhubb-edge-gateway`)
- P3 edge-a / edge-b → `http://127.0.0.1:28090` / `:28091`
- P2 soak → `http://127.0.0.1:18090`

Rebuild dev gateway after pulling new edge-gateway code:

```powershell
cd F:\project\proxyhubb
docker compose -f docker-compose.yml -f docker-compose.dev.yml build edge-gateway
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d edge-gateway
```
