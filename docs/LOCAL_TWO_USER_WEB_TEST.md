# Local two-user web test (one PC)

Prove **seller + buyer** marketplace flows in the **web app** on a single machine. The provider daemon can stay in Docker; only the **buyer browser session** must be a different user and wallet than the listing seller.

## Why two identities?

| Constraint | Detail |
|------------|--------|
| Self-purchase | The API rejects buying your own listing on the session path (`You cannot buy from your own listing`). |
| Escrow | Solana escrow is keyed by **buyer wallet** + **seller wallet**. Same wallet on both sides is not a realistic buyer journey. |
| Same PC is OK | `provider-node` (seller path) and the browser (buyer path) are separate processes. They do not conflict. |

Your CLI E2E script already uses a **second buyer user** via `mint-e2e-buyer-jwt.ps1`. This runbook does the same split in the browser.

## Prerequisites

- Docker stack running: `control-api`, `redis`, `edge-gateway`, `postgres`, `web` (and `provider-node` if you sell from Docker).
- Active marketplace listing owned by **seller account A** (not the buyer).
- Solana **devnet** program deployed and env aligned — see [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) and [SOLANA_PROGRAM_DEPLOYMENT.md](./SOLANA_PROGRAM_DEPLOYMENT.md).
- Buyer proxy port matches your host mapping (default compose `8090`; if you use `EDGE_GATEWAY_PORT=18090`, set buyer env below).

### Env alignment (`.env`)

```env
CONTROL_API_PORT=18080
EDGE_GATEWAY_PORT=8090
EDGE_GATEWAY_BUYER_HOST=localhost
EDGE_GATEWAY_BUYER_PORT=8090
NEXT_PUBLIC_API_URL=http://localhost:18080
NEXT_PUBLIC_PROXY_ENDPOINT=localhost:8090
PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE=true
```

If edge is on host port **18090**, set `EDGE_GATEWAY_PORT=18090`, `EDGE_GATEWAY_BUYER_PORT=18090`, and `NEXT_PUBLIC_PROXY_ENDPOINT=localhost:18090`, then restart `control-api` and `web`.

## Roles

| Role | Account | Wallet | Where |
|------|---------|--------|--------|
| **Seller A** | Your provider login | Wallet A (linked in dashboard) | Profile 1 — provider dashboard, listing, Docker `provider-node` |
| **Buyer B** | Second login (new email or wallet) | Wallet B (different Phantom profile) | Profile 2 — marketplace buy flow |

## Step 1 — Seller (profile 1)

1. Start stack + provider:

   ```powershell
   .\scripts\bootstrap-provider-docker.ps1 -StartProvider
   ```

2. Log in as **seller A** → Provider dashboard → ensure a node is **online** and an listing is **active**.
3. Note the listing id from `/marketplace` or provider manage pages.

Do **not** use this browser profile to buy that listing.

## Step 2 — Buyer (profile 2)

Use a **separate browser profile** (Chrome profile, Firefox container, or Edge profile). Incognito alone is not enough if you share the same wallet extension state.

1. Open `http://localhost:3009` (or your `FRONTEND_URL`).
2. **Register / sign in** as a new user (different email or wallet than seller A).
3. Connect **wallet B** in Phantom (devnet, funded with SOL).
4. Link wallet B under **Dashboard → Wallet** if required.
5. Ensure internal wallet balance / devnet SOL is enough for a 1 GB purchase.

## Step 3 — Buy in the web UI

1. As buyer B, open **Marketplace** → select seller A’s listing.
2. **Buy** → confirm Solana escrow in wallet B.
3. Wait until the order status is **active** (escrow listener confirms on-chain).
4. Copy **proxy credentials** from the modal or **Orders** detail page.

## Step 4 — Verify CONNECT

```powershell
curl.exe -sf --max-time 60 -x "http://USER:PASS@127.0.0.1:8090" https://example.com -o NUL
```

Use your mapped port (`18090` if configured). Exit code 0 means buyer → edge → provider → internet works.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `You cannot buy from your own listing` | Same user as seller | Use buyer profile B |
| Escrow tx fails / program mismatch | Wrong `SOLANA_PROGRAM_ID` / IDL | [SOLANA_PROGRAM_DEPLOYMENT.md](./SOLANA_PROGRAM_DEPLOYMENT.md) |
| Order stuck `pending_payment` | Indexer/oracle not seeing tx | Check control-api logs, devnet RPC, oracle keypair |
| CONNECT 503 | Provider unhealthy | `docker logs proxyhubb-provider-node`; ensure `node_id` in `config/docker/provider.toml` |
| CONNECT timeout | Wrong proxy port in credentials | Set `EDGE_GATEWAY_BUYER_PORT` + `NEXT_PUBLIC_PROXY_ENDPOINT` |
| TLS/curl errors on wrong port | Credentials say `:8090` but edge on `:18090` | Align env and restart API |

## Optional — CLI buyer without second browser

To validate proxy path only (not the web buy UI):

```powershell
.\scripts\marketplace-buy-connect-e2e.ps1 -SkipStack
```

That mints buyer JWT B, creates an order against seller A’s listing, uses `activate-dev`, and curls through edge.

## Next

When local two-user web test passes, deploy a **testnet VPS** stack and run provider at home against public URLs: [TESTNET_VPS_DEPLOYMENT.md](./TESTNET_VPS_DEPLOYMENT.md).
