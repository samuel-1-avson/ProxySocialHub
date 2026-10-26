# Testnet VPS deployment

> **Google Cloud:** For Phase A (single GCE VM + Compose, ~$300 credits), use [GCP_TESTNET_PHASE_A.md](./GCP_TESTNET_PHASE_A.md) with `docker-compose.gcp-testnet.yml` and `config/gcp-testnet.env.example`.

Run the **platform** (API, edge, web, DB) on a VPS. Run **provider-node** on a home PC or a second small VM that dials **outbound** to the VPS tunnel port. Browse as **buyer** from any machine with a different account than the seller.

## Topology

```text
[VPS]  control-api + postgres + redis + edge-gateway + web
         ▲                              ▲
         │ HTTPS                        │ QUIC/TCP :3128 (outbound from provider)
[Home] provider-node ──────────────────┘
[Laptop] browser (buyer B) ──HTTPS──► web + API + buyer proxy :8090
```

Providers never need inbound ports on their home network.

## 1. VPS preparation

- Ubuntu 22.04+ (or similar), Docker + Compose v2.
- DNS records (example):
  - `api.testnet.example.com` → VPS (reverse proxy to `control-api:8080`)
  - `app.testnet.example.com` → VPS (`web:3009` or `3000`)
  - `proxy.testnet.example.com` → VPS (`edge-gateway:8090` buyer proxy, `:3128` provider tunnel)
- TLS termination via Caddy, nginx, or Traefik in front of compose ports.

## 2. Configure environment

```bash
cp config/testnet.env.example .env
# Edit: secrets, SOLANA_PROGRAM_ID, public URLs, treasury, oracle keypair path
```

Place `infra/oracle-keypair.json` on the server (or mount your devnet oracle). Deploy escrow program to devnet first — [SOLANA_PROGRAM_DEPLOYMENT.md](./SOLANA_PROGRAM_DEPLOYMENT.md).

## 3. Build CLI artifacts (on VPS or CI)

Providers download binaries from the API (`/dashboard/provider/cli`). The API serves files from `cli-dist/<version>/`.

```bash
# On a build machine with Rust:
./scripts/build-cli-dist.sh --all
# Copy cli-dist/ to VPS, or let CI artifact land in repo before compose up
```

Set `CLI_DIST_VERSION` in `.env` to match the folder name under `cli-dist/`.

## 4. Start stack

```bash
docker compose -f docker-compose.yml -f docker-compose.testnet.yml up -d --build
```

Verify:

```bash
curl -fsS "$API_BASE_URL/health"
curl -fsS "$API_BASE_URL/v1/solana/health"
curl -fsS "$GATEWAY_PUBLIC_URL/health"
```

## 5. Seller — provider at home

On the **seller machine** (Windows example):

```powershell
.\scripts\bootstrap-remote-provider.ps1 `
  -ControlApiUrl https://api.testnet.example.com `
  -GatewayAddr proxy.testnet.example.com:3128 `
  -StartProvider
```

Or manually:

1. Log in to **app** as seller → Provider → **Setup** / **CLI**.
2. Download `provider-node` for your OS.
3. Create API token + register node in the dashboard.
4. Edit generated `provider.toml`:
   - `control_api_url` = public API URL
   - `gateway_addr` = public tunnel host:3128
   - `node_id` = UUID from dashboard
5. Run: `provider-node start --config provider.toml`

Confirm node **online** in provider dashboard.

## 6. Buyer — any browser

Follow [LOCAL_TWO_USER_WEB_TEST.md](./LOCAL_TWO_USER_WEB_TEST.md) but use public URLs:

- Buyer account **≠** seller account.
- Buyer wallet **≠** seller wallet.
- Buy listing → Solana escrow on devnet → copy credentials → test CONNECT against `proxy.testnet.example.com:8090`.

## 7. Reverse proxy checklist

| Path | Backend | Notes |
|------|---------|--------|
| `/` | `web:3009` | Next.js |
| `/v1/*`, `/health` | `control-api:8080` | REST + WS upgrade |
| Buyer CONNECT | `edge-gateway:8090` | HTTP CONNECT; long-lived |
| Provider tunnel | `edge-gateway:3128` | UDP if QUIC (`docker-compose.provider.yml`) |

WebSocket: set `WS_PUBLIC_URL=wss://api.testnet.example.com` to match TLS termination.

## 8. Smoke tests

```bash
# Public CLI binary (linux VPS or CI)
./scripts/verify-cli-download.sh --api-base "$API_BASE_URL" --platform linux --arch amd64

# Provider tunnel (from repo on seller machine)
.\scripts\verify-provider-proofs-docker.ps1   # local docker only
```

## Security notes for testnet

- `PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE=false` (default in testnet overlay).
- `PROVIDER_SIGNATURE_MODE=enforce` and signed heartbeats on.
- Do not commit `.env`, `provider.compose.env`, or keypairs.

## Related docs

- [LOCAL_TWO_USER_WEB_TEST.md](./LOCAL_TWO_USER_WEB_TEST.md) — two users on one PC
- [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) — Solana health checks
- [MARKETPLACE_CREDENTIAL_GATING.md](./MARKETPLACE_CREDENTIAL_GATING.md) — order → credentials lifecycle
