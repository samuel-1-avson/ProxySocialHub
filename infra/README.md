# Infra secrets (local only)

Never commit Solana keypair JSON files. Git tracks only `oracle-keypair.json.example` (all zeros — not a wallet).

## Oracle keypair for Docker / devnet

1. Copy the example or run:

   ```powershell
   .\scripts\ensure-oracle-keypair.ps1
   ```

   ```bash
   ./scripts/ensure-oracle-keypair.sh
   ```

2. For real devnet/mainnet signing, generate a new key (do not reuse any key that was ever in git history):

   ```bash
   solana-keygen new -o infra/oracle-keypair.json --no-bip39-passphrase
   solana-keygen pubkey infra/oracle-keypair.json
   ```

3. Fund the oracle pubkey on the target cluster before settlement smoke tests.

`docker-compose.yml` and `docker-compose.dev.yml` mount `./infra/oracle-keypair.json` read-only. The file must exist on the host before `compose up`.

If a keypair was previously pushed to GitHub, treat it as **compromised**: generate a new file locally, update on-chain oracle authority if applicable, and rotate any API keys that lived in `.env`.
