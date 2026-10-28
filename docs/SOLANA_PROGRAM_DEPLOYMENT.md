# Solana program deployment and environment

ProxyHubb’s on-chain escrow program must match `SOLANA_PROGRAM_ID` (API) and `NEXT_PUBLIC_SOLANA_PROGRAM_ID` (web). A program id in `.env` that was never deployed on your cluster will fail governance, escrow, and deposit flows with “program mismatch” or simulation errors.

## Program ids in this repo

| Context | Program id | Notes |
|---------|------------|--------|
| **Local validator (recommended for E2E)** | `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7` | Deployed by `scripts/solana-local/deploy-proxyhub.ps1` via `docker-compose.local-solana.yml`. Used by `.\scripts\run-governance-devnet-e2e.ps1 -UseLocalSolana`. |
| **Legacy default in `docker-compose.dev.yml`** | `9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2` | Historical placeholder; **not** guaranteed on public devnet. Do not assume it is live. |
| **Production / staging** | Your deployed id | Set explicitly after `anchor deploy` (or your pipeline). Required in `docker-compose.prod.yml`. |

## Local stack (governance + marketplace devnet E2E)

```powershell
docker compose -f docker-compose.local-solana.yml up -d
.\scripts\solana-local\deploy-proxyhub.ps1
.\scripts\run-governance-devnet-e2e.ps1 -UseLocalSolana
```

The E2E script sets `SOLANA_PROGRAM_ID` and `NEXT_PUBLIC_SOLANA_PROGRAM_ID` to `2yDRy…` when `-UseLocalSolana` is passed.

## Public devnet

1. Configure Solana CLI for devnet and fund a deploy wallet.
2. Build and deploy from `programs/proxyhub` (see project Anchor README).
3. Record the deployed program id and set:

```env
SOLANA_PROGRAM_ID=<your-deployed-id>
NEXT_PUBLIC_SOLANA_PROGRAM_ID=<your-deployed-id>
```

4. Align `apps/web/src/lib/idl/proxyhub.json` with the deployed program (IDL from build output).
5. Run [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) against that id.

## Docker compose defaults

| File | Default `SOLANA_PROGRAM_ID` |
|------|-----------------------------|
| `docker-compose.yml` | `2yDRy…` |
| `docker-compose.dev.yml` | `9Mrp…` (override for local deploy or public devnet) |
| `docker-compose.local-solana.yml` | `2yDRy…` (after deploy script) |
| `docker-compose.prod.yml` | **Required** — no default |

For day-to-day dev on public RPC without a local validator, either deploy once to devnet and set the id, or use the local-solana compose file.

## Related docs

- [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) — manual smoke checklist
- [MANUAL_DEVNET_SESSION.md](./MANUAL_DEVNET_SESSION.md) — wallet / session flows
- [GOVERNANCE_VOTING.md](./GOVERNANCE_VOTING.md) — voting and execution readiness
