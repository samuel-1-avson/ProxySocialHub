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

Recommended (full dev stack + QUIC provider tunnel):

```powershell
.\scripts\compose-up-dev.ps1
```

Or bootstrap + start:

```powershell
.\scripts\bootstrap-provider-docker.ps1 -StartProvider
# or rebuild image:
.\scripts\bootstrap-provider-docker.ps1 -Build -StartProvider
```

`docker-compose.provider.yml` sets `PROVIDER_TRANSPORT=quic` on **both** edge-gateway and provider-node (UDP `3128` + QUIC build). Always pass **both** compose files when starting the provider; starting gateway with `docker-compose.yml` alone leaves yamux/TCP and breaks the QUIC provider.

Equivalent manual command:

```powershell
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d edge-gateway provider-node
```
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

## 4. Marketplace create (web) with dev server signing

When `PROVIDER_SIGNATURE_MODE=enforce`, the create listing page needs a signed offer. Options:

| Method | When |
|--------|------|
| **Wallet sign** | Connected wallet matches `provider_nodes.hotkey` |
| **Dev server sign** | `PROXYHUB_PROVIDER_SIGNING_KEY` is set on control-api and `PROXYHUB_ALLOW_DEV_LISTING_SIGN=true` (default in `docker-compose.yml` for local stacks) |
| **CLI** | `sign-provider-listing.ps1` / `post-signed-listing-docker.ps1` |

Policy endpoint: `GET /v1/system/provider-proof-policy` returns `dev_server_signing: true` when server signing is available.

Authenticated dev sign: `POST /v1/provider/listings/sign-offer` with the same JSON body as `POST /v1/listings` (without `proof`). The server signs with `PROXYHUB_PROVIDER_SIGNING_KEY`; the key must match the node hotkey (use `bootstrap-provider-docker.ps1 -ResyncHotkey`).

Set the signing key on control-api after bootstrap, e.g. in `.env`:

```env
PROXYHUB_PROVIDER_SIGNING_KEY=<from config/docker/provider.compose.env>
PROXYHUB_ALLOW_DEV_LISTING_SIGN=true
```

Then recreate control-api: `docker compose up -d --force-recreate control-api`.

## 5. Sign a listing payload (CLI)

Create a listing JSON without `proof`:

```json
{
  "title": "My signed provider listing",
  "description": "Residential HTTP proxy capacity",
  "provider_node_id": "<provider_nodes.id>",
  "proxy_type": "residential",
  "protocol": "http",
  "price_per_gb": 0.5,
  "min_purchase_gb": 1,
  "available_bandwidth_gb": 10,
  "max_concurrency": 5,
  "listing_offer_expires_at": 0
}
```

Then sign it with the same key used by the Docker provider node:

```powershell
.\scripts\sign-provider-listing.ps1 `
  -InputPath .\listing.json `
  -Output .\listing.signed.json
```

The wrapper reads `PROXYHUB_PROVIDER_SIGNING_KEY` from `config/docker/provider.compose.env`, resolves the node's `gateway_node_id` from Docker Postgres, and writes a request body with a `proof` envelope attached.

For proof-only output:

```powershell
.\scripts\sign-provider-listing.ps1 -InputPath .\listing.json -ProofOnly
```

## 6. POST signed listing (enforce mode)

With `PROVIDER_SIGNATURE_MODE=enforce` on control-api, create a listing via API using the dev provider JWT:

```powershell
$env:PROVIDER_SIGNATURE_MODE = "enforce"
docker compose up -d --force-recreate control-api

.\scripts\post-signed-listing-docker.ps1
```

The script signs a draft listing, exchanges `PROXYHUB_API_KEY` for a session JWT via `POST /v1/provider/auth`, posts to `POST /v1/listings`, and checks `listing_offer_verified` in Postgres.

## Troubleshooting: edge-gateway port 9090 already allocated

`provider-node` depends on a healthy **edge-gateway**. Compose maps gateway Prometheus metrics to host port **`EDGE_GATEWAY_METRICS_PORT`** (default **9092**). An older **`proxyhubb-prometheus`** container may still bind **9090**, which blocks edge-gateway if your compose still mapped metrics to 9090.

**Check:**

```powershell
docker ps --filter "publish=9090" --format "{{.Names}} {{.Ports}}"
netstat -ano | findstr ":9090"
```

**Fix (pick one):**

```powershell
# A) Recreate prometheus on 9091 (current docker-compose.yml) and start gateway
docker compose up -d --force-recreate prometheus
docker compose up -d edge-gateway

# B) Or only start gateway with metrics on 9092 (add to .env)
# EDGE_GATEWAY_METRICS_PORT=9092
docker compose up -d edge-gateway

# C) Then provider
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d provider-node
```

Re-run soak after edge is healthy:

```powershell
curl http://localhost:8090/health
.\scripts\soak-enforce-monitor.ps1
```

## Fresh install checklist (done when)

Another developer (or a clean machine) should be able to run this without manual fixes:

```powershell
docker compose down -v
docker compose up -d
.\scripts\bootstrap-provider-docker.ps1 -StartProvider
.\scripts\verify-provider-proofs-docker.ps1 -WaitSeconds 130
```

Expect `[OK]` on Postgres auth, control-api health, bootstrap, and verified proofs.

## Hotkey binding (Phase 2)

`provider_nodes.hotkey` is the registered identity for proof verification and on-chain registry sync.

| Source | Behavior |
|--------|----------|
| `bootstrap-provider-docker.ps1 -ResyncHotkey` | Sets `hotkey` from `PROXYHUB_PROVIDER_SIGNING_KEY` public key |
| First **verified** heartbeat | Auto-binds `hotkey` when empty and signer matches profile `wallet_address` (if set) |
| Signed listing create/update | Same auto-bind when proof verifies and node has no hotkey |

In **`PROVIDER_SIGNATURE_MODE=enforce`**, heartbeats and signed listings must include a valid proof (not only when `hotkey` is already set). Rejections return `403` with `provider heartbeat proof required` or `provider listing proof required`.

If the user logged in with a Solana wallet, the proof signer must match that wallet before the first bind is accepted.

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

### Soak checklist (1–3 days)

While enforce is on in dev/staging:

1. Run daily: `.\scripts\soak-enforce-monitor.ps1` (modes, health, proof log grep, verify script, `GET /v1/listings/proof-policy`).
2. Confirm **no** `autoPublishListing: failed` after new node registration (auto-list is skipped under enforce).
3. Create a listing via **web** (`/marketplace/create`) with wallet matching node hotkey, or via `post-signed-listing-docker.ps1` for CLI keys.
4. Watch provider-node tunnel reconnects and map pins stay `latest_heartbeat_verified=true`.

## Marketplace map deep link

Open a listing detail panel on the map without clicking a pin:

`/marketplace/map?listing=<listing_uuid>`

E2E (from `apps/web`):

```powershell
# Two terminals — leave Terminal 1 running:
# Terminal 1:
$env:PLAYWRIGHT_E2E_AUTH_BYPASS = '1'
npm run dev:e2e
# Wait until middleware compile finishes; verify:
Invoke-WebRequest http://127.0.0.1:4011 -UseBasicParsing

# Terminal 2:
$env:TEST_BASE_URL = 'http://localhost:4011'
npm run test:e2e:map

# Single terminal (Playwright starts dev):
Remove-Item Env:TEST_BASE_URL -ErrorAction SilentlyContinue
npm run test:e2e:map
```

If Playwright times out starting the dev server, reinstall the SWC binary for your Node arch:

```powershell
cd apps/web
node -p "process.platform + ' ' + process.arch"
npm rebuild @next/swc-win32-x64-msvc
```

`dev:e2e` disables the React Compiler (needs native SWC) and uses `--webpack` so E2E can start when the native SWC package is broken.

## Registry links (`provider_nodes` ↔ `nodes` ↔ gateway)

- `provider_nodes.gateway_node_id` is `node_<user_uuid>` (stable tunnel identity).
- `nodes.provider_node_id` points at `provider_nodes.id` for explorer/map joins.
- `reconcileProviderNodeRegistry` runs on node create and on each verified heartbeat so dashboard, gateway, and `nodes` rows stay aligned.

## Web marketplace create (signed listings)

- `GET /v1/system/provider-proof-policy` returns `{ mode, required }` for the create UI (also `/v1/marketplace/proof-policy`, `/v1/listings/proof-policy`).
- After pulling proof-policy changes, **rebuild** control-api: `docker compose build control-api && docker compose up -d --force-recreate control-api`.
- `/marketplace/create` signs the listing offer with the connected Solana wallet when enforce is on (or when a provider node is selected).
- Wallet pubkey must match `provider_nodes.hotkey` when hotkey is already set; otherwise the first verified listing binds the hotkey.
- Docker dev nodes signed with `PROXYHUB_PROVIDER_SIGNING_KEY` still need `post-signed-listing-docker.ps1` unless that key is the same as the browser wallet.

## Host-run alternative

For a provider on the host (not Docker):

```powershell
.\scripts\bootstrap-provider-dev.ps1 -StartNode
```

Use `gateway_addr = "localhost:3128"` in `provider.toml` and add `provider_signing_key` (or `PROXYHUB_PROVIDER_SIGNING_KEY`).
