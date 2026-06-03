# ProxyHubb staging enforce runbook

**Scope:** provider proof enforcement, map buy checks, registry merge verification, and D4 settlement smoke.

## Required services

| Service | Default host port | Notes |
|---------|-------------------|-------|
| control-api | `18080` | API base for scripts and web rewrites |
| edge-gateway | `18090` or `8090` | Check `docker ps`; container listens on `8090` |
| edge metrics | `9092` | Container metrics port is `9090` |
| web dev E2E | `4011` | `npm run dev:e2e` |

## Enforce proof rollout

1. Start the provider stack:

```powershell
docker compose up -d edge-gateway
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d provider-node
```

2. Verify health and proof policy:

```powershell
.\scripts\soak-enforce-monitor.ps1
```

3. Create one signed listing:

```powershell
.\scripts\post-signed-listing-docker.ps1
```

Success means:

- `PROVIDER_SIGNATURE_MODE=enforce`
- `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS=true`
- provider heartbeat `Verified: true`
- listing `listing_offer_verified = t`

## Registry merge smoke

Gateway registration should now return `provider_nodes.id` as `id`, with `legacy_node_id` only for compatibility.

Check:

```sql
SELECT id, gateway_node_id, is_healthy, active_connections, latency_ms
FROM provider_nodes
WHERE gateway_node_id IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;

SELECT node_id, provider_user_id, is_active, last_heartbeat
FROM explorer_nodes
ORDER BY updated_at DESC
LIMIT 10;
```

Expected:

- `explorer_nodes.node_id` references `provider_nodes.id`.
- `nodes.provider_node_id` is populated for compatibility rows during the transition.

## D4 settlement smoke

After a marketplace order has a Solana escrow PDA and the session ends:

```sql
SELECT id, session_id, order_id, total_bytes, status, on_chain_tx_hash
FROM usage_proofs
ORDER BY created_at DESC
LIMIT 10;

SELECT id, status, session_id, escrow_pda, tx_hash
FROM orders
ORDER BY created_at DESC
LIMIT 10;
```

Expected:

- A terminated escrow-backed session creates a `usage_proofs` row synchronously.
- On-chain anchoring/settlement updates `on_chain_tx_hash` / `orders.tx_hash` when oracle config is present.
- If oracle is not configured, the proof remains available for signing/submission.

## Marketplace Phase 2 migrations

Apply before moderation enforce or funnel SQL checks:

```powershell
# From repo root — adjust for your migration runner
# Migrations: 000095_listing_pending_review, 000096_marketplace_funnel_events
```

Verify:

```sql
SELECT status, COUNT(*) FROM proxy_listings GROUP BY status;
SELECT event_name, COUNT(*) FROM marketplace_funnel_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY event_name
ORDER BY COUNT(*) DESC;
```

## Marketplace moderation enforce soak

1. Set on **control-api** (staging):

```bash
MARKETPLACE_LISTING_MODERATION=enforce
```

2. Create a listing as a provider (UI or API). Expect status `pending_review` and **no** appearance on `/marketplace` browse or map.

3. Open **`/dashboard/admin`** as `admin` / `moderator` / `superadmin`. Approve the listing.

4. Confirm listing is **`active`** and visible on browse/map.

5. Optional API checks:

```powershell
# Pending queue (moderator JWT)
curl -s -H "Authorization: Bearer $MODERATOR_JWT" http://localhost:18080/v1/moderation/listings/pending
```

Docs: [MARKETPLACE_MODERATION.md](./MARKETPLACE_MODERATION.md), funnel: [MARKETPLACE_FUNNEL_METRICS.md](./MARKETPLACE_FUNNEL_METRICS.md).

## Web checks

```powershell
cd apps\web
npm run validate:routes
npm run typecheck
npm run test:e2e:marketplace
```

`test:e2e:marketplace` runs map + browse + moderation in a single Playwright session (shared `dev:e2e` on :4011). Set `TEST_ADMIN_JWT` or `TEST_JWT_SECRET` when using a custom `TEST_BASE_URL`.

## Live devnet map-buy E2E

This test is intentionally opt-in because it uses real Solana devnet and a funded test wallet.

Required env:

- `E2E_LIVE_MAP_BUY=1`
- `TEST_BASE_URL=http://127.0.0.1:4011`
- `TEST_BUYER_JWT`
- `E2E_LIVE_LISTING_ID`
- `NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET=1`
- `NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET` (JSON-array or base64 Solana keypair secret, test-only)
- `NEXT_PUBLIC_SOLANA_PROGRAM_ID`
- `NEXT_PUBLIC_SOLANA_RPC_URL`

Run:

```powershell
cd apps\web
npm run test:e2e:map-buy:devnet:check
npm run test:e2e:map-buy:devnet
```

Do not commit test wallet secrets. Use only a disposable funded devnet wallet.

## Live devnet governance E2E (Phase 1 / Phase 3 gate)

Opt-in Playwright flow: create a **Community signal** proposal on-chain, open the proposal page (impact preview), then cast a **yes** vote via build → sign → relay → DB mirror.

Required env:

- `E2E_LIVE_GOVERNANCE=1`
- `TEST_BASE_URL=http://localhost:4011` when using `npm run dev:e2e` (recommended; see below)
- `TEST_API_URL=http://localhost:18080` (optional if API is proxied only through web)
- `TEST_BUYER_JWT` — real JWT (not a placeholder). Mint locally:

```powershell
# From repo root — uses JWT_SECRET + DATABASE_URL from .env
.\scripts\mint-e2e-buyer-jwt.ps1 -WalletSecret $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET -EnsureBuyer
$env:TEST_BUYER_JWT = '<paste token from script output>'
```

Or after browser login: DevTools → Application → sessionStorage → `proxyhubb_token`.
- `NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET=1`
- `NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET` (JSON array or base64 keypair; must match linked wallet)
- `NEXT_PUBLIC_SOLANA_PROGRAM_ID`
- `NEXT_PUBLIC_SOLANA_RPC_URL`

Preflight checks execution-readiness and that the JWT profile wallet matches the Playwright test keypair.

Run:

```powershell
cd apps\web
$env:TEST_BASE_URL = "http://127.0.0.1:3009"
$env:TEST_API_URL = "http://localhost:18080"
npm run test:e2e:governance:smoke
npm run test:e2e:governance:devnet:check
npm run test:e2e:governance:devnet
```

Or API + UI smoke only:

```powershell
.\scripts\verify-phase3-gate.ps1 -RunUiSmoke
```

**Playwright wallet vs Docker web:** `NEXT_PUBLIC_PLAYWRIGHT_SOLANA_*` is inlined at Next.js **build** time. The Docker web image on `:3009` does not include the test wallet unless you rebuild with those build args. For governance devnet E2E, run the app in dev mode:

```powershell
# Terminal 1
cd apps\web
$env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET = "1"
$env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET = "<your 64-byte keypair JSON>"
$env:NEXT_PUBLIC_SOLANA_PROGRAM_ID = "9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2"
$env:NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com"
npm run dev:e2e

# Terminal 2 (same env + TEST_BUYER_JWT)
$env:TEST_BASE_URL = "http://localhost:4011"
$env:E2E_LIVE_GOVERNANCE = "1"
npm run test:e2e:governance:devnet
```

Do not start Phase 4 (unified network) until `test:e2e:governance:devnet` is green.
