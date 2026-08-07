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

Related: [GCP cost optimization](GCP_COST_OPTIMIZATION.md), [custody split](../custody-split.md)
(Sprint E: GCP KMS oracle + vault/hot/cold on testnet),
`config/gcp/Caddyfile.example`, `scripts/gcp-ha-lite-install.sh`.

## Topology

| Plane | Path | SPOF? |
|-------|------|-------|
| Web / API TLS | Host Caddy → `127.0.0.1:3000` / `:8080` | Caddy + single web/api containers |
| Buyer CONNECT | DNS → VM `:8090` (edge-gateway) | Single edge process |
| Provider tunnel | DNS → VM `:3128` / `:8443` (TLS) | Sticky to one edge process |
| Control plane | control-api ×1 | Workers start in-process — **do not scale** |
| Postgres | Named volume + GCS dumps + boot snaps | Single instance |
| Redis | AOF (`appendonly yes`, `everysec`) + volume | Single instance; LRU can drop keys |
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
| Sessions / metering hot keys | Redis eviction under 512mb LRU | Re-auth / re-meter | **Not** HA — EV-05 still open |

## Do not

- `docker compose scale control-api=2` — duplicate settlement workers, no leader election
- Scale edge-gateway on the live compose path — tunnels and host ports stick to one process
- Treat `infra/k8s/*` as the live path (Compose-only until a dedicated cutover)
- Confuse `PROXYHUB_REQUIRE_SESSION_PDA` with deploying `programs/session` (unsafe; undeployed)

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
2. Edge multipod + sticky tunnel DNS
3. Redis Sentinel/Memorystore + metering WAL drain (EV-05)
4. Cloud SQL PITR or streaming replica
5. Multi-VM / k8s cutover with tested overlays
