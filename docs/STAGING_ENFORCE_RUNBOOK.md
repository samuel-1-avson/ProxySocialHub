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

## Web checks

```powershell
cd apps\web
npm run validate:routes
npm run typecheck
npm run test:e2e:map
```

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
