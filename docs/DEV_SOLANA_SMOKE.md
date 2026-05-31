# Dev Solana smoke checklist (~30 min)

Quick pass after changing program id, treasury address, or oracle keypair. Assumes Docker dev stack on `main`.

## Prerequisites

| Item | Typical value |
|------|----------------|
| API | http://localhost:18080 |
| Web | http://localhost:3000 |
| Escrow program | `SOLANA_PROGRAM_ID` → `9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2` |
| Treasury (deposits) | `SOLANA_TREASURY_ADDRESS` → `8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4` |
| Oracle signer | `infra/oracle-keypair.json` → pubkey `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Network | devnet |

Start stack:

```powershell
docker compose -f docker-compose.dev.yml up -d postgres redis nats db-migrate control-api web
```

Rebuild web after changing `apps/web/src/lib/solana.ts` or program env:

```powershell
docker compose -f docker-compose.dev.yml build web
docker compose -f docker-compose.dev.yml up -d web
```

## 1. API health (2 min)

```powershell
Invoke-RestMethod http://localhost:18080/health
Invoke-RestMethod http://localhost:18080/v1/solana/health
```

(`/v1/solana/health` is public. The same path under the authenticated group still exists for logged-in clients.)

| Check | Pass |
|-------|------|
| `/health` → ok | ☐ |
| `/v1/solana/health` → `status` ok, `network` devnet, oracle pubkey + balance | ☐ |
| Or skip Solana health if treasury shows `oracle_configured: true` (step 2) | ☐ |

## 2. Treasury transparency (2 min)

```powershell
Invoke-RestMethod http://localhost:18080/v1/treasury/public | ConvertTo-Json -Depth 5
```

| Check | Pass |
|-------|------|
| `oracle_configured` = true | ☐ |
| `treasury.address` = your `SOLANA_TREASURY_ADDRESS` | ☐ |
| `treasury.hot.address` matches treasury | ☐ |
| `operational_healthy` = true (or explain status vs balance) | ☐ |
| http://localhost:3000/treasury matches API | ☐ |

## 3. Deposit → wallet credit (10 min)

1. Open http://localhost:3000/dashboard/wallet → **Linked Wallets**: connect Phantom (devnet), sign to **link** the wallet.
2. **Overview** → **Deposit SOL**: enter amount, connect the **same** linked wallet if prompted, click **Deposit SOL**, approve in Phantom.
3. The UI confirms on-chain, then calls `POST /v1/wallet/deposit/crypto` with the signature automatically.
4. Fallback: expand “Already sent SOL? Paste signature” only if you transferred outside the app.

| Check | Pass |
|-------|------|
| Tx recipient on Solscan = treasury address | ☐ |
| Sender = linked wallet | ☐ |
| Internal wallet balance increases | ☐ |

## 4. Escrow program (10 min)

1. Create or interact with escrow in UI (flow that calls Anchor program).
2. Confirm client uses `9Mrp…` (browser devtools / Solscan program id on tx).

| Check | Pass |
|-------|------|
| `apps/web/src/lib/idl/proxyhub.json` matches deployed `9Mrp…` program | ☐ |
| Escrow tx lands on devnet without “program mismatch” / IDL errors | ☐ |
| Escrow listener / indexer sees program (optional: check API logs) | ☐ |

If escrow fails: update IDL from chain (`anchor idl fetch`) or redeploy program to match repo.

## 5. Payout / withdraw (5 min)

Outbound transfers sign from the **oracle** wallet (`8P4uuap…`), not the treasury display address.

```powershell
solana balance 8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 --url devnet
# If low:
solana airdrop 2 8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 --url devnet
```

| Check | Pass |
|-------|------|
| Small SOL withdraw or provider payout succeeds | ☐ |
| Failure is not “insufficient funds” on oracle while treasury shows high balance | ☐ |

## 6. Phase 4 extras (optional)

| Area | Pass |
|------|------|
| Admin multisig treasury withdrawal (>100 SOL, `TREASURY_MULTISIG_ADMIN_IDS`) | ☐ |
| Provider claim summary / prepare / confirm | ☐ |

## Known dev gotchas

- **Treasury ≠ oracle:** Dashboard balance on `8g7WUu…`; payouts debit `8P4uuap…`. Fund both for full smoke or align addresses in `.env`.
- **Program id ≠ treasury:** `9Mrp…` is the escrow program; deposits use `SOLANA_TREASURY_ADDRESS` unless you intentionally use the same pubkey.
- **Oracle keypair:** Docker mounts `./infra/oracle-keypair.json`, not empty `./oracle-keypair.json`.

## Full wallet regression

For whitelist, cooldown, large-withdraw signature, GDPR: see [WALLET_E2E_SMOKE.md](./WALLET_E2E_SMOKE.md).
