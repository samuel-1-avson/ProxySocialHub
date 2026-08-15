# GCP HA lite — single-VM Compose recovery (Phase A)

**Scope:** `proxyhubb-testnet` (one GCE VM) running:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.testnet.yml \
  -f docker-compose.gcp-testnet.yml \
  up -d
```

This is **not** multi-node HA. Do not claim regional failover or replica sets until
leader election + multipod edge + managed Redis/Postgres exist.

**PHASE-A acceptance (2026-08-09):** single-VM SPOF is **formally accepted** for limited
Testnet invites — [`evidence/PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md`](evidence/PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md).

Related: [GCP cost optimization](GCP_COST_OPTIMIZATION.md), [custody split](../custody-split.md)
(Sprint E: GCP KMS oracle + vault/hot/cold on testnet),
`config/gcp/Caddyfile.example`, `scripts/gcp-ha-lite-install.sh`.

## Topology

| Plane | Path | SPOF? |
|-------|------|-------|
| Web / API TLS | Host Caddy → `127.0.0.1:3000` / `:8080` | Caddy + single web/api containers |
| Buyer CONNECT | DNS → VM `:8090` (single edge) **or** Caddy sticky → `18090`/`18091` (J2) | Single process unless J2 overlay |
| Provider tunnel | DNS → VM `:3128` / `:8443` (TLS); J2 adds `:3129` for edge-b | Sticky to one edge process / pod |
| Control plane | control-api ×1 | Workers start in-process — **do not scale** |
| Postgres | Named volume + GCS dumps + boot snaps | Single instance |
| Redis | AOF + volume; optional Sentinel+HAProxy on same VM (M2) | **Host** SPOF; process failover only; LRU can drop keys |
| NATS JetStream | Named volume `nats_data` + `-sd /data` | Single instance |

## What survives

| Event | Survives | Lost / reset |
|-------|----------|--------------|
| `compose restart <svc>` | Process state for that service | In-memory only |
| `compose up -d --force-recreate` (container) | Named volumes (PG, Redis, NATS) | Ephemeral container FS |
| VM reboot | Volumes on boot disk; Caddy; cron | Until containers come back (`restart: unless-stopped`) |
| Boot disk loss / VM delete | Only what was in GCS / snapshots | Everything local |

## RTO / RPO (honest)

| Store | RPO | RTO (approx) | Mechanism |
|-------|-----|--------------|-----------|
| Postgres | Last successful dump (cron ~daily) + last snap | Tens of minutes (restore drill) | `gcp-postgres-backup.sh` → GCS; `gcp-postgres-restore-drill.sh` |
| Redis | Seconds (AOF everysec) on same disk | Minutes (container recreate) | AOF + volume; optional daily GCS copy |
| NATS JetStream | Since last durable write on volume | Minutes | `nats_data` volume |
| Sessions / metering hot keys | Redis eviction under 512mb LRU | Re-auth / re-meter | EV-05 PARTIAL — spill lite (below) |

## Session PDA required (Sprint J1)

`PROXYHUB_REQUIRE_SESSION_PDA=true` (gcp-testnet default):

- Instant PAYG creates `pending_payment` → `fund/solana` → on-chain
  `initialize_session_escrow` → `confirm-escrow` → Redis activate
- Billing/intent settle refuses custodial `balance_sol` when no session PDA
- Legacy `POST /v1/sessions` and `from-listing` return **410** `session_pda_required`
  even if legacy direct-session env is on
- **W1.1 fail-closed:** `fund/solana` only records a pending PDA; Active /
  CONNECT require `escrow_confirmed_at` (set by `confirm-escrow` after on-chain
  Pending/Active). Edge aborts intent CONNECT when control-api returns
  `402 session_escrow_required`.

This uses **proxyhub** `initialize_session_escrow` / `settle_session_escrow`.
Do **not** deploy `programs/session`.

Smokes: `scripts/gcp-smoke-sprint-j1-failclosed.sh` → `SPRINT_J1_FAILCLOSED_OK`
(includes intent Active 402 without `escrow_confirmed_at`).
Happy-path on-chain (`gcp-smoke-sprint-j1-session-pda.sh`) needs a buyer
keypair + oracle signer path; after hot/oracle keyfile quarantine the default
`infra/oracle-keypair.json` mount may be absent — treat full PDA fund/settle
smoke as PARTIAL until a KMS-aware funder script is wired.

## Metering spill lite (Sprint H / EV-05)

When edge Redis WAL or pending writes fail, the gateway POSTs
`/v1/gateway/metering/spill` and control-api stores rows in `metering_wal_spill`.
A drain worker promotes them into `usage_receipts` (same nonce uniqueness as
normal flush).

## Session hydrate lite (Sprint J0 / EV-05 PARTIAL↑)

`StoreSession` dual-writes the Redis `session:{username}` JSON into
`session_gateway_cache` (keyed by sha256 of the plaintext username — PG
`credentials_user` is encrypted and not queryable). On Redis miss, edge auth
calls `GET /v1/gateway/sessions/hydrate?username=…` (gateway auth) and control-api
returns the blob + rewarms Redis.

**This is still not Redis HA.** Hot path remains Redis; hydrate covers key
eviction/miss for sessions that were dual-written. Do **not** mark EV-05 FIXED
or claim “session survives Redis process wipe for all keys forever.”

Smoke: `scripts/gcp-smoke-sprint-j0-session-hydrate.sh` → `SPRINT_J0_SESSION_HYDRATE_OK`.

**Wave 2.2:** control-api runs `SessionGatewayCacheReaper` (every 5m) to delete
expired `session_gateway_cache` rows. This bounds table growth; it does **not**
make Redis HA. Evidence: `docs/ops/evidence/W2_2_session_hydrate_reaper_20260811.md`.

**This is not Redis HA.** Live sessions still live in Redis; a Redis outage still
drops auth SoT until hydrate. Spill only reduces **unreported usage** under Redis
blips/write failures. Do **not** mark EV-05 FIXED.

## Multipod edge lite (Sprint J2 / Wave 2.1) — PARTIAL

Optional same-VM overlay (not default gcp-testnet compose):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.testnet.yml \
  -f docker-compose.gcp-testnet.yml \
  -f docker-compose.j2-multipod.yml \
  up -d
```

| Piece | Detail |
|-------|--------|
| Pods | `edge-gateway-a` (`EDGE_POD_ID=edge-a`), `edge-gateway-b` (`edge-b`) |
| Buyer loopback | `:18090` / `:18091` → container `:8090` |
| Provider tunnels | `:3128` (a) / `:3129` (b); providers stick to one |
| Mode | `EDGE_MODE=colocated` + mutual `EDGE_PEER_URLS` |
| Sticky CONNECT | Uncomment Caddy `:8090` block in `config/gcp/Caddyfile.example` |

Smoke: `scripts/gcp-smoke-sprint-j2-multipod.sh` → `SPRINT_J2_MULTIPOD_OK`.

**Honest claim:** process failover for buyer health when one pod dies. Host VM,
control-api, Redis, and Postgres remain SPOFs. Not multi-region. Not multi-operator.
Cross-pod provider selection: peer forward is wired; live gcp path may stay
**sticky-only PARTIAL** until a full provider-on-A / buyer-on-B e2e is run
(see P3 lab `services/edge-gateway/scripts/p3-multipod-e2e-full.ps1` and
`docs/ops/evidence/W2_3_cross_pod_partial_20260811.md`).

## Do not

- `docker compose scale control-api=2` — duplicate settlement workers, no leader election
- Blindly `scale edge-gateway=N` on the **default** compose path — host ports stick to one process; use `docker-compose.j2-multipod.yml` instead
- Treat `infra/k8s/*` as the live path (Compose-only until a dedicated cutover)
- Confuse `PROXYHUB_REQUIRE_SESSION_PDA` with deploying `programs/session` (unsafe; undeployed)
- Claim multi-operator DePIN or regional HA after enabling J2

## Install / verify

```bash
# On the VM (once):
sudo GCS_BACKUP_BUCKET=<bucket> ./scripts/gcp-ha-lite-install.sh

# Verify backups (weekly cron also runs this):
./scripts/gcp-postgres-backup-verify.sh
# Optional restore drill:
./scripts/gcp-postgres-backup-verify.sh --run-drill

# Confirm NATS volume persists JetStream across recreate:
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  up -d --force-recreate nats
# Streams/consumers that lived on the volume should still be listed after recreate.
```

## External uptime

GitHub Actions: `.github/workflows/uptime-probe.yml` every 15 minutes.

- Set repo variable `UPTIME_API_BASE_URL=https://api.proxyhubb.com`
- Soft-skip only if `UPTIME_PROBE_OPTIONAL=true`
- Otherwise missing URL or failed `/health` **fails** the job

## Failure signals

| Signal | Where |
|--------|-------|
| Backup cron / verify FAIL | `/var/log/proxyhubb-backup.log`, `/var/log/proxyhubb-backup-verify.log` |
| API down from outside | Uptime Probe workflow |
| Redis memory pressure | Redis `used_memory` vs 512mb; session drops |
| JetStream lost after recreate | Missing `nats_data` mount or wrong `-sd` path |

## Redis durability (lite)

- Live compose: `--appendonly yes --appendfsync everysec --maxmemory 512mb --maxmemory-policy allkeys-lru`
- AOF survives container recreate on the same volume
- Under memory pressure, **keys are evicted** (sessions/metering WAL) — this is not Redis HA
- Optional: `scripts/gcp-redis-backup.sh` copies AOF/RDB snapshot to GCS (installed by HA lite cron)

## Next real HA (out of this sprint)

1. Leader election / single-writer workers for control-api
2. ~~Edge multipod + sticky tunnel DNS~~ → **J2 PARTIAL** (same-VM; see above); multi-VM sticky still open
3. Redis Sentinel/Memorystore + close EV-05 fully (beyond J0 hydrate)
   - **2026-08-09:** on-VM Sentinel + HAProxy **PASS** (`M2_redis_ha_20260809T135920Z.md`).
     Survives Redis process death with automatic failover. Host VM SPOF remains;
     Memorystore still the managed cross-VM option when budget allows.
4. Cloud SQL PITR or streaming replica
5. Multi-VM / k8s cutover with tested overlays

Wave 2 continues: J2 multipod smoke on VM, W2.3 cross-pod e2e optional, Wave 3 discovery.