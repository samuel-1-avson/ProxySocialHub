# Provider proofs on Docker

End-to-end signed provider heartbeats in the main `docker-compose.yml` stack.

## Prerequisites

- Main stack running: `docker compose up -d`
- `.env` with `POSTGRES_PASSWORD`, `TOKEN_HMAC_SECRET`, and other required secrets
- Compose services (`db-migrate`, `control-api`) build `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` with host `postgres:5432` (see `docker-compose.yml`). Keep those three vars aligned with each other and with the password the Postgres volume was created with.
- Optional `DATABASE_URL` in `.env` is for **host-run** tools (localhost + `POSTGRES_HOST_PORT`, usually `55432`). If `db-migrate` fails with `password authentication failed`, your `POSTGRES_PASSWORD` does not match the existing volume — fix the password or reset volumes (`docker compose down -v`, destructive).
- In `.env`, put comments on their own line (not `GIN_MODE=debug # release`). Inline comments break Gin when passed through Compose; `control-api` in `docker-compose.yml` pins `GIN_MODE=release` for containers.
- After `docker compose down -v`, bootstrap uses `-ensure-profile` to create a dev provider user if the DB has no profiles yet.

## 1. Bootstrap credentials

```powershell
.\scripts\bootstrap-provider-docker.ps1
```

If bootstrap fails with `ConvertFrom-Json` / empty JSON, pull latest code (bootstrap uses `-output-json` to avoid Go log noise on stdout) and retry:

```powershell
.\scripts\bootstrap-provider-docker.ps1 -ForceNewToken
```

If a node exists but `hotkey` does not match the signing key (heartbeats stay unsigned), resync after bootstrap:

```powershell
.\scripts\bootstrap-provider-docker.ps1 -ResyncHotkey
```

This writes `config/docker/provider.compose.env` (gitignored) with:

- `PROXYHUB_API_KEY` — dev provider token (HMAC, same as control-api)
- `PROXYHUB_PROVIDER_SIGNING_KEY` — base58 Ed25519 seed for heartbeat proofs

It also syncs `provider_nodes.hotkey` to the signing public key when a node row exists.

## 2. Start the provider container

```powershell
.\scripts\bootstrap-provider-docker.ps1 -StartProvider
# or rebuild image:
.\scripts\bootstrap-provider-docker.ps1 -Build -StartProvider
```

Equivalent manual command:

```powershell
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d provider-node
```

The provider connects to `edge-gateway:3128` and `control-api:8080` on the Docker network.

## 3. Verify

Wait about two minutes for the first signed heartbeat, then:

```powershell
.\scripts\verify-provider-proofs-docker.ps1
# or wait inline:
.\scripts\verify-provider-proofs-docker.ps1 -WaitSeconds 130
```

Success means `latest_heartbeat_verified = true` in Postgres for the active node.

## Fresh install checklist (done when)

Another developer (or a clean machine) should be able to run this without manual fixes:

```powershell
docker compose down -v
docker compose up -d
.\scripts\bootstrap-provider-docker.ps1 -StartProvider
.\scripts\verify-provider-proofs-docker.ps1 -WaitSeconds 130
```

Expect `[OK]` on Postgres auth, control-api health, bootstrap, and verified proofs.

## Environment reference

| Variable | Service | Default | Meaning |
|----------|---------|---------|---------|
| `PROVIDER_SIGNATURE_MODE` | control-api | `observe` | `observe` or `enforce` |
| `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS` | edge-gateway | `false` | Reject unsigned tunnel heartbeats |
| `PROXYHUB_PROVIDER_SIGNING_KEY` | provider-node | (bootstrap) | Base58 Ed25519 signing seed |
| `PROXYHUB_API_KEY` | provider-node | (bootstrap) | Provider API token |

## Enforcement rollout (staging)

Use **observe** first (default in `docker-compose.yml` and `.env.docker.example`). Only move to **enforce** on staging after signed heartbeats look healthy for a few days.

### Before enforce

Check verified heartbeats in Postgres (staging DB):

```sql
SELECT id, hotkey, latest_heartbeat_verified, latest_heartbeat_verification_error, last_seen_at
FROM provider_nodes
WHERE deleted_at IS NULL
ORDER BY last_seen_at DESC NULLS LAST
LIMIT 20;
```

Proceed when active nodes you care about show `latest_heartbeat_verified = true` and `hotkey` matches `latest_heartbeat_signer`.

### Staging flip

1. Set on **control-api** (env file, secrets manager, or deployment manifest):

   ```env
   PROVIDER_SIGNATURE_MODE=enforce
   ```

2. Recreate control-api (e.g. `docker compose up -d --force-recreate control-api` or your k8s rollout).

3. Optional — reject unsigned heartbeats at the tunnel (after control-api enforce is stable):

   ```env
   PROXYHUB_REQUIRE_SIGNED_HEARTBEATS=true
   ```

   Recreate **edge-gateway**.

4. Re-run verify against staging API/DB or watch provider logs for rejection errors.

**Local Docker dev** can stay on `observe` / `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS=false`; bootstrap + verify should keep working.

### Rollback

Set `PROVIDER_SIGNATURE_MODE=observe` (and `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS=false` if you enabled it), recreate the affected services.

## Host-run alternative

For a provider on the host (not Docker):

```powershell
.\scripts\bootstrap-provider-dev.ps1 -StartNode
```

Use `gateway_addr = "localhost:3128"` in `provider.toml` and add `provider_signing_key` (or `PROXYHUB_PROVIDER_SIGNING_KEY`).
