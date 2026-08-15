# BC-09 workstation / CI key scrub runbook (W1.4)

**Goal:** No funded oracle/hot/treasury private key JSON or JWT material on developer
workstations or CI runners. Production signing is Cloud KMS only.

## Checklist

1. Search the workstation (do **not** commit results):
   ```powershell
   Get-ChildItem -Path . -Recurse -File -ErrorAction SilentlyContinue |
     Where-Object { $_.Name -match 'keypair|oracle|treasury|jwt\.txt' } |
     Select-Object FullName, Length
   ```
2. For any real 64-byte Solana keypair JSON that ever signed funded accounts:
   - Rotate the on-chain authority / migrate funds
   - Shred local file (`cipher /w` on Windows or `shred -u` on Linux)
3. Remove empty placeholders that tempt reuse (`oracle-keypair.json` with zeros).
4. Confirm gitignore covers `*keypair*.json`, `jwt.txt`, `.env`.
5. CI: ensure gitleaks + keypair gate remain enabled in `proxyhubb-ci.yml`.
6. Compose: `docker-compose.prod.yml` must not mount oracle/hot JSON (KMS env required).

## Cosigner residual

`PROXYHUB_MULTISIG_COSIGNER_*` may still use a host JSON mount on gcp-testnet.
Track as follow-up: move cosigner to GCP KMS or Secret Manager sealed volume;
never reuse oracle/hot keys as cosigner.

## Evidence

File a pack under `docs/ops/evidence/BC09_workstation_scrub_<UTC>.md` with:
- date / operator
- files found (paths only, no key material)
- shred/rotate actions
- confirmation prod compose has zero oracle/hot mounts
