# Production / public-test readiness verdict

**Date:** 2026-07-18  
**Question:** Can we invite external users to test (public shared / public testnet), not mainnet custody?  
**Environment assessed:** Local Docker stack on operator host (`docker-compose.yml` + `docker-compose.provider.yml`).

---

## Verdict

# **NO-GO** for public production / inviting external internet users

**Scope note:** This is **not** a mainnet readiness claim. Even for **public Solana devnet testnet**, the **currently running deployment is local-only** and must not be advertised as a public shared environment.

**Local operator self-test:** the stack is **healthy** and suitable for *you* (same machine) to exercise product flows.

---

## Runtime evidence (summary)

Probed 2026-07-18 against live containers:

| Surface | Host port | Status |
|---------|-----------|--------|
| control-api `/health` | 18080 | **200** `{"status":"ok"}` |
| `/v1/system/map/health` | 18080 | **200** (9 explorer nodes, 2 purchasable listings) |
| `/v1/map/links` | 18080 | **200** topology_available, session arcs present |
| `/v1/marketplace/map` | 18080 | **200** listing + node points |
| `/v1/listings` | 18080 | **200** signed listing present |
| `/v1/explorer/nodes` | 18080 | **200** |
| `/v1/solana/health` | 18080 | **200** **devnet**, oracle ok |
| web app pages + `/api/health` | 3009 | **200** |
| edge-gateway | 18090 / 3128 | **healthy** |
| postgres / redis / nats / provider-node | various | **healthy** |

**Web flags:** `NEXT_PUBLIC_GLOBE_TOPOLOGY=true`, `NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=true`, API base `http://localhost:18080`.

---

## Security posture (summary)

| Area | Result |
|------|--------|
| Live secrets not in current git index | **PASS** |
| `.gitignore` for env/keypairs | **PASS** |
| Keypair paths in git history | **Residual risk** — rotate before public |
| `APP_ENV=development` + dev listing/escrow flags | **Public fail** |
| Provider signature enforce | **PASS (local)** |
| Postgres/Redis/NATS/Grafana on `0.0.0.0` | **Public fail** |
| Mainnet / full decentralization | **Not ready** |

See `docs/SECURITY_GATES.md` and `docs/runbooks/public-testnet-authority-matrix.md`.

---

## End-user path assessment

| Path | Local | External public user |
|------|-------|----------------------|
| Open web UI | Works | Needs public HTTPS app URL + rebuild |
| Browse marketplace / map / globe | Works | Needs public API URL in web build |
| Wallet buy (devnet) | Plausible if funded | Same + public API |
| Remote home provider | Local container only | Public tunnel + bootstrap |
| Buyer CONNECT | Local `:18090` | Public proxy host |

---

## Blockers before inviting external testers

1. No public DNS/TLS/IP — web points at **localhost**.  
2. Dev flags: `APP_ENV=development`, `PROXYHUB_ALLOW_DEV_*`.  
3. Data-plane ports exposed on all interfaces.  
4. Rotate oracle/treasury keys for any shared environment.

## Nice-to-have

- Grafana auth, CLI dist for remote providers, public e2e wallet buy, decentralization hardening.

---

## Recommended path to GO (public devnet testnet)

1. Deploy per `docs/GCP_TESTNET_PHASE_A.md` or `docs/TESTNET_VPS_DEPLOYMENT.md`.  
2. Public env URLs + compose testnet/gcp overlay.  
3. Production-like flags (no dev bypasses); internal DB/redis.  
4. Rebuild web with public `NEXT_PUBLIC_*`.  
5. Smoke health + one remote provider + one buyer flow.  
6. Invite testers with **devnet-only** disclaimer.

---

## One-line answer

**Do not invite public users yet.** Local Docker is healthy for operator testing on **Solana devnet**; shared public testnet needs VPS/GCP + TLS + public URLs + hardened flags first.
