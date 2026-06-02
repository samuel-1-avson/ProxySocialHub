# Local Solana validator (unlimited test SOL)

Use when devnet faucets are rate-limited. Unlimited `solana airdrop` against `http://127.0.0.1:8899`.

## Windows note

Native `solana-test-validator` often fails with **error 1314** unless PowerShell is **Run as administrator**. The reliable path on Windows is **Docker** (section 2B).

## 1. Install CLI (once)

```powershell
pwsh -File scripts/solana-local/install-solana-cli.ps1
```

Open a **new** terminal, then verify:

```powershell
solana --version
solana-test-validator --version
```

If `solana` is not found, add to PATH:

```powershell
$env:Path = "$env:USERPROFILE\.local\share\solana\install\active_release\bin;" + $env:Path
```

## 2. Start validator

### 2A — Native (Linux/macOS, or Windows **as Administrator**)

**Foreground** (keep terminal open):

```powershell
pwsh -File scripts/solana-local/start-validator.ps1
```

**Background**:

```powershell
pwsh -File scripts/solana-local/start-validator-background.ps1
Start-Sleep -Seconds 8
```

Stop: `pwsh -File scripts/solana-local/stop-validator.ps1`

### 2B — Docker (recommended on Windows)

```powershell
pwsh -File scripts/solana-local/start-validator-docker.ps1
```

Uses `solanalabs/solana:v1.18.26` (`solana-test-validator`) on ports 8899/8900. No admin rights required.

## 3. Fund platform wallets

In a second terminal:

```powershell
pwsh -File scripts/solana-local/fund-oracle.ps1
```

Defaults: **100 SOL** → oracle `8P4uuapg…`, **50 SOL** → treasury `8g7WUu…` (override with `.env` addresses).

## 4. Point ProxyHubb at local RPC

**If you used Docker validator (2B):**

```powershell
docker compose -f docker-compose.dev.yml -f docker-compose.local-solana.yml up -d control-api web
```

**If you used native validator (2A):**

```powershell
pwsh -File scripts/solana-local/apply-docker-local-rpc.ps1
docker compose -f docker-compose.dev.yml --env-file .env --env-file .env.local-solana up -d control-api web
```

Check API:

```powershell
Invoke-RestMethod http://localhost:18080/v1/solana/health
# balance_sol should be ~100 on localnet
```

## 5. Phantom / browser

Public devnet is **not** used. In Phantom:

1. Settings → Developer settings → **Testnet mode** (or add custom RPC).
2. Custom RPC URL: `http://127.0.0.1:8899`

Your linked wallet must use the **same** RPC to send/receive on the local chain.

Get personal SOL for deposits:

```powershell
solana airdrop 10 YOUR_PHANTOM_PUBKEY --url http://127.0.0.1:8899
```

## Notes

- **Escrow program** (`9Mrp…`) is not deployed on a fresh local validator unless you deploy it; wallet deposit/withdraw still work (system program transfers).
- `--reset` on each validator start wipes chain state; re-run `fund-oracle.ps1` after restart.
- `devnet-pow` needs `~/.config/solana/cli/config.yml`; `Ensure-SolanaConfig` in our scripts creates it pointing at localhost.
