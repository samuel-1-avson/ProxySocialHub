# Treasury / Oracle Custody Split (BC-08 / BC-09)

## Roles

| Role | Key material | Holds funds? | Purpose |
|------|--------------|--------------|---------|
| **Oracle** | `SOLANA_ORACLE_KEYPAIR` | Fee dust only | Signs settle / attest / program instructions; vault withdraw authority |
| **Deposit vault PDA** | Program PDA `["deposit_vault"]` | Inbound user deposits | Users send SOL here; only withdrawable to hot |
| **Treasury hot** | `SOLANA_TREASURY_HOT_KEYPAIR` | Operational SOL | `SendSOL` withdrawals and provider payouts |
| **Treasury cold** | `SOLANA_TREASURY_COLD_ADDRESS` (pubkey only) | Long-term reserves | Manual / multisig top-ups into hot |

On GCP testnet the cold private key lives in Secret Manager
(`proxyhubb-testnet-treasury-cold-keypair`) and on-VM
`/opt/proxyhubb/secrets/treasury-cold-keypair.json` — it is **not** mounted into
`control-api`. Wire with `scripts/gcp-wire-treasury-cold.sh`.

Production (`APP_ENV=production`) **refuses to start** when:
- `SOLANA_TREASURY_HOT_KEYPAIR` is missing
- treasury hot pubkey equals oracle pubkey
- `SOLANA_TREASURY_HOT_ADDRESS` does not match the loaded hot keypair
- cold address equals oracle or hot (when set)
- `SOLANA_DEPOSIT_VAULT_ADDRESS` equals oracle, hot, or cold (when set)
- `SOLANA_DEPOSIT_VAULT_ADDRESS` does not match the derived PDA for `SOLANA_PROGRAM_ID`

## Deposit vault cutover (Phase 1)

```bash
# After program upgrade includes initialize_deposit_vault / withdraw_from_vault:
# 1) Init vault (admin = program_state.admin; withdraw_authority = oracle)
# 2) Set env:
export SOLANA_DEPOSIT_VAULT_ADDRESS=<derived PDA>
export PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED=true   # credit when SOL lands on vault
export PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT=true # keep dual-write initially
export PROXYHUB_DEPOSIT_VAULT_UI=false              # flip true when ready for users
export PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=false     # optional BC-07 hardening
export PROXYHUB_REQUIRE_ESCROW_PDA=false            # flip true to block custodial order settle

# Cutover order:
# credit on (UI still legacy) → smoke → UI on → freeze legacy credit →
# sweep remaining SOL from legacy treasury EOA into vault → REQUIRE_ESCROW_PDA on
#
# GCP helper (flags + recreate control-api; optional SWEEP=1):
#   bash scripts/gcp-cutover-deposit-vault.sh
#   SWEEP=1 LEGACY_TREASURY_KP=/opt/proxyhubb/secrets/legacy-treasury-keypair.json \
#     bash scripts/gcp-cutover-deposit-vault.sh
#
# When REQUIRE_ESCROW_PDA=true (wired via docker-compose / gcp-testnet overlay):
# - confirm-escrow / release require orders.escrow_pda (pay/solana first)
# - auto-release will not custodially credit sellers without a PDA
# - billing worker skips custodial settle for escrow-backed marketplace sessions
# - sandbox / activate-dev stay disabled
#
# gcp-testnet overlay defaults (after cutover):
#   PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED=true
#   PROXYHUB_DEPOSIT_VAULT_UI=true
#   PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT=false
```

Native SOL transfers into the vault PDA are accepted (no deposit instruction required).
Ops top-up: `withdraw_from_vault` moves vault → hot only (destination bound on-chain).

## Session program (BC-03 / BC-04) — do not deploy

The Anchor program under `services/solana-programs/proxyhub/programs/session` is
**unsafe to deploy** (unconstrained `complete_session` / `slash_gateway`). Keep it
undeployed on all clusters until a Config PDA binds oracle/admin/treasury.

Do **not** confuse this with `PROXYHUB_REQUIRE_SESSION_PDA`, which enforces the
**proxyhub** program's SessionEscrow PDA on PAYG sessions — that flag is unrelated
to deploying `programs/session`. Compose/GCP must not set a `SESSION_PROGRAM_ID`
that points production traffic at the unsafe program.


```bash
# Generate a dedicated hot wallet (do this once; store offline backup)
solana-keygen new --no-bip39-passphrase -o treasury-hot-keypair.json

# Derive pubkey for compose/env
solana-keygen pubkey treasury-hot-keypair.json

# Env
export SOLANA_ORACLE_KEYPAIR=./infra/oracle-keypair.json
export SOLANA_TREASURY_HOT_KEYPAIR=./treasury-hot-keypair.json
export SOLANA_TREASURY_HOT_ADDRESS=<pubkey from above>
export SOLANA_TREASURY_ADDRESS=<legacy deposit address during dual-write>
export SOLANA_DEPOSIT_VAULT_ADDRESS=<deposit_vault PDA>
export SOLANA_TREASURY_COLD_ADDRESS=<optional cold pubkey>
```

Fund the **hot** wallet for withdrawals; keep the **oracle** wallet near empty aside from tx fees.
User deposits should target the **vault PDA** once `PROXYHUB_DEPOSIT_VAULT_UI=true`.

## Upgrade authority

After deploying/upgrading `proxyhub`, move upgrade authority off the hot oracle wallet:

```bash
# Generate an offline/hardware pubkey (store seed offline — never on the app VM)
solana-keygen new --no-bip39-passphrase -o upgrade-authority.json
solana-keygen pubkey upgrade-authority.json

CURRENT_KP=./infra/oracle-keypair.json \
NEW_AUTHORITY=<offline-pubkey-or-keypair-path> \
bash scripts/set-proxyhub-upgrade-authority.sh
# Pubkey-only transfers use --skip-new-upgrade-authority-signer-check
```

Oracle remains program admin for settle ixs; upgrade authority should be a cold/offline key.

**Devnet (2026-08-06):** upgrade authority moved off oracle `8P4uu…Kii2` → cold pubkey
`6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` (keypair under `infra/secrets/`, gitignored — store offline / hardware).

## AWS KMS (oracle signer)

Set `USE_AWS_KMS=true` with `AWS_KMS_KEY_ID` + `AWS_KMS_PUBLIC_KEY`.
In `APP_ENV=staging|production`, KMS init failure is **fail-closed** (no MockHSM fallback).
Dev may still fall back to the local oracle keypair.

## GCP Cloud KMS (preferred on GCP)

**Live `proxyhubb-testnet` (Sprint H finish / 0.6, 2026-08-07, still on Solana devnet):**

- Oracle settle/attest: **GCP Cloud KMS** (`USE_GCP_KMS=true`, `PROXYHUB_REQUIRE_GCP_KMS=true`)
- Deposits: **vault PDA** (`destination_kind=vault`; `SOLANA_TREASURY_ADDRESS` = vault ≠ hot)
- Payouts: **treasury hot via Cloud KMS** (`USE_GCP_KMS_HOT=true`, pubkey `Feunr…`)
- Compose: **no oracle/hot private key JSON mounts** on gcp-testnet (`volumes: !override`)
- App VM: quarantine + `treasury-cold-keypair.json` + root `oracle`/`treasury` JSON **shredded**; backups in Secret Manager / KMS (`SPRINT_06_KEYS_OFFBOX_OK`)
- Backlog **0.6**: **FIXED on app VM** (no oracle/hot/cold private JSON under `/opt/proxyhubb`); workstation/CI scrub still unverified. Still **not** mainnet-ready.
- **W1.4 (2026-08-11):** `docker-compose.prod.yml` matches KMS-only policy (no oracle/hot file mounts). Scrub runbook: `docs/ops/BC09_WORKSTATION_SCRUB.md`. Cosigner host JSON on gcp-testnet remains residual.
- Do **not** claim mainnet-ready

**Prior Sprint G note:** hot KMS was live while file mounts could remain for rollback.

Primary path for `proxyhubb-testnet` / GCP deployments:

```bash
# 1) Import existing oracle Ed25519 key (keeps pubkey 8P4uu… / program admin)
ORACLE_KP=./infra/oracle-keypair.json \
EXPECT_PUBKEY=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 \
bash scripts/gcp-kms-oracle-provision.sh

# 2) Enable oracle KMS on the VM
GCP_KMS_KEY_NAME=projects/<proj>/locations/us-central1/keyRings/proxyhubb-oracle/cryptoKeys/oracle-ed25519/cryptoKeyVersions/1 \
GCP_KMS_PUBLIC_KEY=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 \
bash scripts/gcp-kms-oracle-enable.sh

# 3) Import treasury-hot key (keeps pubkey Feunr…)
HOT_KP=/opt/proxyhubb/secrets/treasury-hot-keypair.json \
EXPECT_PUBKEY=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3 \
bash scripts/gcp-kms-hot-provision.sh

# 4) Enable hot KMS on the VM
GCP_KMS_HOT_KEY_NAME=projects/<proj>/locations/us-central1/keyRings/proxyhubb-treasury/cryptoKeys/hot-ed25519/cryptoKeyVersions/1 \
GCP_KMS_HOT_PUBLIC_KEY=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3 \
bash scripts/gcp-kms-hot-enable.sh
```

Env:

| Var | Purpose |
|-----|---------|
| `USE_GCP_KMS=true` | Prefer Cloud KMS over local keypair / AWS (oracle) |
| `GCP_KMS_KEY_NAME` | Full `.../cryptoKeyVersions/N` resource (oracle) |
| `GCP_KMS_PUBLIC_KEY` | Solana base58 pubkey (must match on-chain admin) |
| `PROXYHUB_REQUIRE_GCP_KMS=true` | Fail closed even outside staging (oracle) |
| `USE_GCP_KMS_HOT=true` | Cloud KMS for treasury-hot `SendSOL` fee payer |
| `GCP_KMS_HOT_KEY_NAME` | Full hot cryptoKeyVersions resource |
| `GCP_KMS_HOT_PUBLIC_KEY` | Hot Solana pubkey (`Feunr…`) |
| `PROXYHUB_REQUIRE_GCP_KMS_HOT=true` | Fail closed for hot KMS init |

GCE instance SA needs `roles/cloudkms.signerVerifier` on **both** oracle and hot keys.
Treasury **hot** payouts use Cloud KMS when `USE_GCP_KMS_HOT=true` (Sprint G); file keypair is fallback only when REQUIRE is false.

When both `USE_GCP_KMS` and `USE_AWS_KMS` are true, **GCP wins**.

**Danger:** [`scripts/gcp-align-treasury-to-oracle.sh`](../scripts/gcp-align-treasury-to-oracle.sh)
collapses treasury/hot onto the oracle (BC-08 anti-pattern). It refuses to run unless
`ALLOW_ALIGN_TREASURY_TO_ORACLE=I_UNDERSTAND_BC08`. Do not use on live testnet.

Cold → hot top-ups remain ops-only: `scripts/gcp-topup-hot-from-cold.sh` / multisig — not automatic.

- Keypair JSON files are gitignored (`*keypair*.json`).
- Do **not** keep production keys under the repo on laptops.
- Prefer:
  - GCP Secret Manager → mount as `/run/secrets/*.json` in Compose/K8s
  - **GCP Cloud KMS** for the oracle signer (`USE_GCP_KMS=true`)
  - or `USE_AWS_KMS=true` (legacy) — treasury hot still needs a funded payer key until KMS payouts land
- After any accidental workstation exposure: **rotate** oracle + treasury hot, move funds, update Secret Manager.

## Treasury address ≠ hot

After deposit vault cutover:

```bash
# On VM: SOLANA_TREASURY_ADDRESS → vault PDA; HOT stays payout EOA
bash scripts/gcp-split-treasury-address.sh
```

Staging/production refuse to start when both addresses are set and equal.

## Compose (prod)

`docker-compose.prod.yml` mounts:

- `./oracle-keypair.json` → `/run/secrets/oracle-keypair.json`
- `./treasury-hot-keypair.json` → `/run/secrets/treasury-hot-keypair.json`

On GCP, replace host files with Secret Manager CSI / docker secrets — never SCP keys to a laptop.
