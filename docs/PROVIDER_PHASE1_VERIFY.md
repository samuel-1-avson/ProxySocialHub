# Provider Phase 1 verification

Automated script (repo root):

```powershell
.\scripts\verify-provider-phase1.ps1
```

## Prerequisites

```powershell
docker compose -f docker-compose.dev.yml up -d postgres redis nats zk-prover
docker compose -f docker-compose.dev.yml run --rm db-migrate
docker compose -f docker-compose.dev.yml build control-api
docker compose -f docker-compose.dev.yml up -d control-api
```

## Manual registry E2E

Prerequisites: `docker compose -f docker-compose.dev.yml up -d postgres redis nats edge-gateway control-api web`

### A. Dashboard (http://localhost:3000)

1. Log in as a **provider** account.
2. Open **Provider → Setup** (`/dashboard/provider/setup`).
3. **Create API token** — copy the `api_key` value (shown once).
4. **Register node** — pick a name; after success, open **Provider → Nodes** and copy the node **UUID** (or use Network tab in devtools on `POST /v1/provider/nodes`).

### B. `provider.toml` (repo example: `cli/provider.toml`)

```toml
control_api_url = "http://localhost:18080"
gateway_addr = "localhost:3128"
api_key = "<paste-token-from-setup>"
node_id = "<paste-provider_nodes-uuid>"
connection_type = "residential"
use_tls = false
```

- `node_id` must be the **dashboard UUID** (enables control-api heartbeats every ~120s).
- Gateway tunnel identity is still `node_<your-profile-uuid>` when the JWT identifies you; that is expected.

### C. Run the CLI

```powershell
# From repo after building or using cli-dist binary:
.\cli-dist\1.0.0\provider-node-1.0.0-windows-amd64.exe start --config .\cli\provider.toml
```

Keep it running 2–3 minutes. Check edge-gateway and control-api logs if connect fails.

### D. Verify in DB

```powershell
.\scripts\registry-e2e-check.ps1 -ProfileId '<profile-uuid>' -NodeId '<provider-node-uuid>'
```

Or SQL:

```sql
SELECT pn.id, pn.gateway_node_id, pn.status, pn.last_seen_at,
       n.id AS nodes_id, n.provider_node_id, n.gateway_node_id
FROM provider_nodes pn
LEFT JOIN nodes n ON n.provider_node_id = pn.id
WHERE pn.user_id = '<profile-uuid>'
ORDER BY pn.created_at DESC LIMIT 1;
```

Expect `gateway_node_id = node_<profile-uuid>`, `provider_node_id = pn.id`, `status = online` after heartbeats.

## Mainnet KYC

Set `SOLANA_NETWORK=mainnet-beta`, rebuild/restart API, apply as provider without KYC (expect pending). Approve KYC via webhook or admin flow; application should promote.

Unit tests: `go test ./internal/api/... ./internal/solana/... -run Mainnet`
