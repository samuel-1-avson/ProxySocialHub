# Manual devnet session (~45 min)

Single playbook for **wallet E2E** + **provider CLI** on local Docker devnet. Run automated preflight first, then complete the checkboxes in the browser/CLI.

**Preflight (automated):**

```powershell
.\scripts\local-verification.ps1
```

**Interactive guide (prints URLs + DB hints):**

```powershell
.\scripts\manual-devnet-session.ps1
```

---

## Environment snapshot (devnet)

| Item | Value |
|------|--------|
| API | http://localhost:18080 |
| Web | http://localhost:3000 |
| Treasury (deposits) | `8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4` |
| Oracle signer | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Escrow program | `9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2` |
| Gateway tunnel | `localhost:3128` |

Confirm live balances:

```powershell
Invoke-RestMethod http://localhost:18080/v1/solana/health
Invoke-RestMethod http://localhost:18080/v1/treasury/public
```

Oracle should show **> 0.5 SOL** on devnet for withdrawals/payouts; treasury should be **HEALTHY** for deposits.

---

## Part A — Wallet (browser, ~20 min)

Use Phantom (or Solflare) on **devnet**. Get devnet SOL from a faucet if needed.

| # | Step | URL / action | Pass |
|---|------|----------------|------|
| A1 | Log in (email or wallet auth) | http://localhost:3000/login | ☐ |
| A2 | Open Financial HQ | http://localhost:3000/dashboard/wallet | ☐ |
| A3 | **Linked Wallets** — connect + sign link message | Same page | ☐ |
| A4 | **Deposit** — send SOL to treasury `8g7WUu…`, approve in wallet | Deposit flow; balance increases | ☐ |
| A5 | **Withdraw ≤ 10 SOL** (e.g. 0.5) | Withdraw tab | ☐ |
| A6 | **Withdraw > 10 SOL** without sign | Expect error / signature required | ☐ |
| A7 | Sign `withdraw:<nonce>:<amount>` and retry large withdraw | ☐ |
| A8 | **Whitelist** — set primary linked address | Withdrawal security section | ☐ |
| A9 | Treasury page matches API | http://localhost:3000/treasury | ☐ |

**Optional API token path** (after login, copy JWT from devtools):

```powershell
$token = "<paste JWT>"
.\scripts\wallet-manual-e2e.ps1 -AccessToken $token
```

**Automated auth smoke (synthetic user, no Phantom):**

```powershell
cd services\control-api
go run ./cmd/smoke_wallet_api -base http://localhost:18080
```

Deposit (B) and real on-chain withdraw still need a funded linked wallet.

Detail: [WALLET_E2E_SMOKE.md](./WALLET_E2E_SMOKE.md), [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md).

---

## Part B — Provider CLI (~20 min)

| # | Step | Pass |
|---|------|------|
| B1 | Log in as **provider** | http://localhost:3000/dashboard/provider/setup | ☐ |
| B2 | Create **API token** (copy once) | Setup → API Tokens | ☐ |
| B3 | **Register node** — copy node **UUID** | Provider → Nodes | ☐ |
| B4 | Build `provider.toml` (see below) | ☐ |
| B5 | Download CLI | http://localhost:18080/v1/cli/download?platform=windows&arch=amd64 | ☐ |
| B6 | Run CLI 2–3 minutes | `provider-node start --config ...` | ☐ |
| B7 | DB check | `.\scripts\registry-e2e-check.ps1 -ProfileId '<profile-uuid>' -NodeId '<node-uuid>'` | ☐ |

### Local dev without dashboard token copy (recommended)

From repo root (docker dev stack up, `.env` with `POSTGRES_PASSWORD` + `TOKEN_HMAC_SECRET`):

```powershell
.\scripts\bootstrap-provider-dev.ps1 -StartNode
```

Re-runs reuse the token in `%USERPROFILE%\.proxyhubb\provider.toml` when it still works (no new DB row each time). Use `-ForceNewToken` to mint a fresh one.

```powershell
.\scripts\bootstrap-provider-dev.ps1 -StartNode -RegistryCheck
```

Starts the node in the background, waits for heartbeats, then runs the registry DB check.

This runs `go run ./cmd/provider_dev_token`, which inserts a token using the **same HMAC secret** as control-api and writes `%USERPROFILE%\.proxyhubb\provider.toml`. No web UI step.

Optional flags: `-ProfileId <uuid>`, `-TokenOnly`, `-RegistryCheck`, `-ApiBaseUrl` for staging.

You can also set `PROXYHUB_API_KEY` and skip editing the file when starting the node.

### `provider.toml` (manual / staging)

```toml
control_api_url = "http://localhost:18080"
gateway_addr = "localhost:3128"
api_key = "<64-char hex token>"
node_id = "<provider_nodes.id UUID>"
connection_type = "residential"
use_tls = false
```

**401 Invalid token:** empty `api_key`, wrong `TOKEN_HMAC_SECRET`, or revoked token. Verify:

```powershell
.\scripts\test-provider-auth.ps1
```

- **`node_id`** is optional for connect; runtime identity is `node_<profile_uuid>` after auth.
- See [NODE_REGISTRY.md](./NODE_REGISTRY.md).

### Run CLI (Windows)

```powershell
$cli = "$env:TEMP\provider-node.exe"
curl.exe -fsSL -o $cli "http://localhost:18080/v1/cli/download?platform=windows&arch=amd64"
& $cli start --config "$env:USERPROFILE\.proxyhubb\provider.toml"
```

Or use a build from `cli/` if you compile locally.

### Verify registry

```powershell
.\scripts\registry-e2e-check.ps1 `
  -ProfileId "741719aa-9973-43ac-a802-63fbd137fdec" `
  -NodeId "<your-provider_nodes.id>"
```

Expect: `gateway_node_id = node_741719aa-...`, `status = online`, `nodes.provider_node_id = pn.id`.

Detail: [STAGING_ENFORCE_RUNBOOK.md](./STAGING_ENFORCE_RUNBOOK.md), [PROVIDER_PROOFS_DOCKER.md](./PROVIDER_PROOFS_DOCKER.md).

---

## Part C — Optional product checks

| Page | Pass |
|------|------|
| Provider earnings + claim | http://localhost:3000/dashboard/provider/earnings | ☐ |
| Manage listings | http://localhost:3000/marketplace/manage | ☐ |
| Marketplace map | http://localhost:3000/marketplace/map | ☐ |

---

## Staging (when ready)

Replace base URL only — same scripts:

```powershell
.\scripts\local-verification.ps1 -ApiBaseUrl https://staging-api.yourdomain.com
.\scripts\wallet-manual-e2e.ps1 -ApiBaseUrl https://staging-api.yourdomain.com -WebBaseUrl https://staging.yourdomain.com
.\scripts\manual-devnet-session.ps1 -ApiBaseUrl https://staging-api.yourdomain.com
```

Tick [WALLET_PRODUCTION_CLOSURE.md](./WALLET_PRODUCTION_CLOSURE.md) §6 **Staging / prod** column.

---

## Sign-off

When A + B checklists are complete on devnet, note date and environment in your team channel or PR. Staging repeats the same flow with mainnet-beta only after explicit env change and KYC checks.
