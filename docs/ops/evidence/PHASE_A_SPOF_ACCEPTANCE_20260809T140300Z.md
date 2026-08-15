# PHASE-A — Formal acceptance of single-VM SPOF

**Result:** `PHASE_A_SPOF_ACCEPTED`  
**Date:** 2026-08-09T14:03:00Z  
**Scope:** Live Testnet VM `proxyhubb-testnet` (GCE `us-central1-a`), Solana **devnet**  
**Decision:** Remain on Phase A topology for limited-cohort invites; **do not** claim always-on / regional HA / 99.9% SLO until Phase B exit criteria are met.

## Decision

ProxyHubb Testnet **formally accepts** the single-VM single-Compose SPOF for Phase A operations.

This is an **ops + product honesty** decision, not a multi-VM HA delivery. Mitigations (backups, on-VM Redis Sentinel, metering spill, session hydrate, invite banner) reduce blast radius; they do **not** remove host SPOF.

## Accepted topology

Compose path (unchanged):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.testnet.yml \
  -f docker-compose.gcp-testnet.yml \
  # + optional overlays (e.g. docker-compose.redis-ha.yml)
  up -d
```

| Plane | Instance count | Host SPOF? | Notes |
|-------|----------------|------------|-------|
| GCE VM / boot disk | 1 | **Yes** | Disk loss → GCS dumps + snapshots only |
| Caddy / web / control-api | 1 each | **Yes** | Deploy ≈ brief outage |
| edge-gateway (CONNECT + tunnels) | 1 | **Yes** | Sticky tunnels to one process |
| Postgres | 1 | **Yes** | Daily GCS dump + boot snaps; RTO tens of minutes |
| Redis | 1 logical (Sentinel trio + HAProxy on same VM) | **Yes (host)** | Process failover **PASS** (M2); Memorystore deferred |
| NATS JetStream | 1 | **Yes** | `nats_data` volume |

Authoritative recovery notes: [`docs/ops/GCP_HA_LITE.md`](../GCP_HA_LITE.md)  
Phase A overview: [`docs/GCP_TESTNET_PHASE_A.md`](../../GCP_TESTNET_PHASE_A.md)

## What we claim (allowed)

- Limited-cohort **invite-ready** on Solana **devnet**
- Best-effort recovery via named volumes, GCS Postgres dumps, VM snapshots, compose `restart: unless-stopped`
- On-VM Redis process failover (Sentinel + HAProxy) — evidence `M2_redis_ha_20260809T135920Z.md`
- Metering spill + session hydrate lite when Redis keys miss (EV-05 PARTIAL↑↑)
- Honest UI: `TestnetEnvironmentBanner` + Help “single server (not HA)”

## What we do **not** claim

- Regional / multi-AZ failover
- Automatic VM replacement without operator action
- 99.9% (or any hard) availability SLO
- Always-on large public Testnet without capacity and HA upgrades
- Mainnet capital custody readiness
- “Trustless” marketplace / discovery / gateway (platform-operated hybrid)

## Residual risks (owned)

| Risk | Severity under Phase A | Mitigation / residual |
|------|------------------------|------------------------|
| VM stop / zone incident | High outage | Snapshots + restore drill (S8); operator restart |
| Boot disk corruption | High data loss beyond backup RPO | GCS dumps + snaps; Redis AOF same disk |
| control-api single process | Deploy / OOM outage | Compose recreate; workers in-process (do not scale replicas yet) |
| Postgres single instance | Write path SPOF | Backups; Cloud SQL = Phase B |
| Redis host SPOF | Sessions/metering if VM dies | M2 process HA only; Memorystore = paid upgrade |
| Journal dual-write drift | Accounting honesty | Accepted for Testnet (M4); banner + soft alerts |

## Exit criteria (leave Phase A → Phase B)

Phase A ends only when **all** of the following are true (or explicitly waived in a new decision record):

1. **Compute:** ≥2 VMs or managed orchestration with documented failover for control-api + edge (sticky tunnels addressed)
2. **Postgres:** Managed Cloud SQL (or equivalent) with PITR / replica path
3. **Redis:** Memorystore (or equivalent cross-host Sentinel) — not same-VM only
4. **Workers:** Leader election / single-writer safe for multi-control-api
5. **Claims:** Public always-on SLO language approved; banner updated accordingly

Until then, backlog item **PHASE-A** is **ACCEPTED** (not “exited”).

## Disclosure checklist (verified in repo)

| Surface | Status |
|---------|--------|
| `TestnetEnvironmentBanner` — “single-server ops” | Present |
| Help — “single server (not HA)” | Present |
| `GCP_HA_LITE.md` — “not multi-node HA” | Present |
| Invite packaging evidence | `INVITE_PACKAGING_20260808T224200Z.md` |

## Related evidence

| Item | Evidence |
|------|----------|
| S8 restore drill | `S8_dr_20260808T175337Z.md` |
| M1 product load | `M1_product_load_20260808T223400Z.md` |
| M2 Redis on-VM HA | `M2_redis_ha_20260809T135920Z.md` |
| Invite honesty | `INVITE_PACKAGING_20260808T224200Z.md` |

## Operator sign-off

- **Decision:** Accept single-VM SPOF for Phase A Testnet invites.
- **Next always-on gate:** Phase B exit criteria above (not Memorystore-only; not Sentinel-on-same-VM alone).
- **Backlog:** `PHASE-A` → **ACCEPTED** (`PHASE_A_SPOF_ACCEPTED`).
