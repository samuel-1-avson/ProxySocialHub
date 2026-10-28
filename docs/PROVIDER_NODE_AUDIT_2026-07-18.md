# Provider-node system audit

**Date:** 2026-07-18  
**Scope:** `services/provider-node`, Docker provider overlay, edge tunnel integration, control-api registry path  
**Live stack:** `docker-compose.yml` + `docker-compose.provider.yml`

## Executive summary

| Area | Status |
|------|--------|
| Codebase / operator tooling | **Strong** — CLI, doctor, dashboard, proofs, multi-gateway |
| Local Docker “healthy” label | **Misleading** — process up, **tunnel not serving traffic** |
| Gateway session | **Broken** — continuous reconnect loop |
| Registry / listings / map pins | **Partially fine** — node + listing exist via API; live tunnel not required for pin data |
| Production readiness | **Not ready** until tunnel transport + TLS + healthcheck honesty are fixed |

**Bottom line:** The provider-node *product* is mature enough to operate; the *current running instance* is not actually providing bandwidth. Healthchecks and transport config hide that.

---

## Architecture (what exists)

```text
provider-node (Rust)
  ├─ register / keygen / config validate / doctor / status / dashboard / service
  ├─ start → tunnel client (TCP/yamux or QUIC+yamux)
  │            ├─ AUTH + CAPABILITY handshake
  │            ├─ heartbeats + signed proofs (Ed25519)
  │            └─ proxy handler (serve buyer streams)
  └─ metrics :9090/stats

edge-gateway
  ├─ buyer CONNECT :8090
  ├─ provider tunnel :3128 (yamux TCP/TLS *or* QUIC UDP — exclusive)
  └─ metrics :9090

control-api
  └─ provider_nodes registry, leases, heartbeats mirror, listings
```

Docs: `docs/PROVIDER_NODE_OPERATIONS.md`, `docs/PROVIDER_REGISTRY.md`, compose overlay `docker-compose.provider.yml`.

---

## Live runtime findings (evidence)

### 1. Container looks healthy but tunnel is down

- Container: `proxyhubb-provider-node` — **Up (healthy)** for hours  
- Logs (repeating every ~30s):

  `Gateway session lost … error=TCP dial to edge-gateway:3128 failed`  
  then `Rotating to next gateway...`

- Local metrics (`/stats`):

  - `active_connections: 0`, `total_connections: 0`  
  - `last_heartbeat_ago_ms` ≈ **3.7e6** (~1 hour) — no successful gateway heartbeat path

**Root cause of false healthy:** Dockerfile healthcheck only spiders metrics:

```dockerfile
HEALTHCHECK … wget … http://127.0.0.1:9090/stats
```

That only proves the process + stats server are up, **not** tunnel connectivity.

### 2. Transport mismatch (provider vs gateway)

| Component | `PROVIDER_TRANSPORT` observed |
|-----------|-------------------------------|
| Root `.env` | `yamux` |
| edge-gateway container | **`quic`** (from `docker-compose.provider.yml`) |
| provider-node container | **`yamux`** (effective at runtime) |

Edge log:

- `PROVIDER_TRANSPORT=quic: listening on UDP…`  
- `Provider TCP/yamux tunnel disabled`  
- **`QUIC tunnel listener error: provider QUIC TLS init failed: No such file or directory`**

Provider is dialing **TCP** while gateway expects **QUIC** and QUIC failed to start.

### 3. Missing TLS material for QUIC

Edge env:

- `TLS_CERT_PATH=/app/certs/server.crt`  
- `TLS_KEY_PATH=/app/certs/server.key`  
- Volume: `./certs:/app/certs:ro`

Host `certs/` is **empty** (no `server.crt` / `server.key`). QUIC cannot initialize.

### 4. Registry / marketplace side (partially OK)

- `provider.toml` has `node_id`, API key, signing key, `control_api_url=http://control-api:8080`  
- Marketplace map / listings still show Accra listing tied to provider node UUID (geo/listing path does not require live tunnel)  
- Signed listing path + `PROVIDER_SIGNATURE_MODE=enforce` exist on control-api (product-level OK)

Without tunnel, **buyers cannot actually proxy through this node**.

### 5. Edge buyer health probe

`http://localhost:18090/health` timed out during audit windows (metrics also slow). Gateway process is up for SOCKS/buyer logs historically, but responsiveness is degraded enough to treat as an ops signal.

---

## What is in good shape (code / design)

1. **Operator UX:** `register`, `config validate`, `doctor`, `status --json`, `dashboard`, `watch`, `service install`, support bundle — documented and implemented.  
2. **Proofs / signing:** Heartbeat payloads + Ed25519 envelopes; signing key bootstrap via register/keygen.  
3. **Multi-gateway + yamux lanes:** Failover list, `YAMUX_CONNS_PER_NODE`, reconnect loop.  
4. **QUIC path coded:** Feature-gated build (`ENABLE_QUIC=1`), client dial, doctor checks for feature mismatch.  
5. **Registry model:** Canonical `provider_nodes` table + consolidation plan (P0–P4 largely done per docs).  
6. **Compose bootstrap scripts:** `bootstrap-provider-docker.ps1`, QUIC e2e scripts, proof verify scripts exist.  
7. **No code TODOs/FIXME** found in `services/provider-node/src` (implementation complete-ish; ops config is the hole).

---

## What still needs work (ranked)

### P0 — Broken now (blocks real provider utility)

| # | Issue | Fix direction |
|---|--------|----------------|
| 1 | **Tunnel not connected** | Align `PROVIDER_TRANSPORT` on **both** edge and provider (`yamux` *or* `quic`, never mixed). Recreate containers after change. |
| 2 | **QUIC TLS missing** | Generate dev certs into `./certs/server.crt` + `server.key`, or switch both sides to `yamux` for local TCP. |
| 3 | **False health** | Healthcheck must fail if `last_heartbeat_ago_ms` exceeds threshold or runtime state `tunnel_connected=false` (use `/stats` fields or doctor-style check). |

### P1 — Reliability / honesty

| # | Issue | Fix direction |
|---|--------|----------------|
| 4 | `.env` `PROVIDER_TRANSPORT=yamux` fights `docker-compose.provider.yml` quic intent | Document single source of truth; set compose to force both services explicitly and document root `.env` override. |
| 5 | Provider restarts forever with only WARN | After N failures, escalate log level / metrics counter `tunnel_connect_failures_total` for alerts. |
| 6 | Edge `/health` timeouts | Investigate blocking on health path; keep buyer health cheap and independent of tunnel TLS init failure. |

### P2 — Product / multi-node (addressed 2026-07-18)

| # | Issue | Status |
|---|--------|--------|
| 7 | Multi-provider Docker + home bootstrap | **Done:** `provider-node-2` profile, `bootstrap-provider-docker.ps1 -Instance 2`, `bootstrap-home-provider.ps1` |
| 8 | CLI dist for remote sellers | **Done:** migration `package_type`, public catalog/download, linux daemon in `cli-dist`, `verify-cli-download.ps1` |
| 9 | Registry P1 docs | Still open (cosmetic UUID UX consistency) |

### P3 — Security for shared environments

| # | Issue | Fix direction |
|---|--------|----------------|
| 10 | API keys / signing keys in compose env files | Documented; gitignore `provider*.compose.env`; rotate before public testnet |
| 11 | Dev listing sign flags on control-api | Disable for public testnet (see production readiness verdict). |

---

## Recommended fix path for *this* local stack (shortest path)

**Applied 2026-07-18 (local fix pass):**

1. Aligned `PROVIDER_TRANSPORT=${PROVIDER_TRANSPORT:-yamux}` on edge + provider in `docker-compose.provider.yml` (no more hard-coded quic mismatch).  
2. Generated `./certs/server.crt` + `server.key` for TLS tunnel (`scripts/generate-local-edge-certs.ps1`).  
3. Provider healthcheck now uses `/health/ready` (503 until recent gateway heartbeat); stats expose `tunnel_ready` + `tunnel_connect_failures`.  

**Option B — QUIC (still available):** set `PROVIDER_TRANSPORT=quic` for both, rebuild with QUIC features, keep certs present.

---

## Verification checklist (after fix)

```text
docker logs proxyhubb-provider-node --tail 50   # no endless "session lost"
curl -s http://localhost:9092/metrics | findstr provider   # or scrape edge metrics
docker exec proxyhubb-provider-node wget -qO- http://127.0.0.1:9090/stats
# last_heartbeat_ago_ms should be seconds, not millions
provider-node doctor --config …   # if binary available on host
```

Buyer path: create session → CONNECT via edge :18090 → traffic increments `bytes_up`/`bytes_down` on provider stats.

---

## Verdict

- **System design / code:** generally fine; solid operator surface.  
- **Current deployment:** **not fine** — provider is a **zombie healthy** process without a working gateway tunnel.  
- **Work remaining:** P0 transport+TLS+healthcheck (ops/config), then P1 observability, then multi-provider and public-test hardening.

This is independent of the earlier **NO-GO for public internet testers**: even for local E2E, provider bandwidth path needs the tunnel fixed first.
