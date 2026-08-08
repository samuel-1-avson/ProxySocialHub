# BC-06 — Threshold / Multisig Settle

| Field | Value |
|-------|--------|
| **Stamp** | 2026-08-08T15:25:00Z |
| **Host** | proxyhubb-testnet |
| **Program** | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` (devnet) |
| **Verdict** | **PASS** |

## What landed

### On-chain
1. Program upgraded with BC-06 bytecode (`mut` on `multisig_oracle` + nonce `checked_add(1)` after settle).
   - Upgrade tx: `5zkWAzH7MsVJCLTMVTyWFpXLmzsX12oDKb3fnSaNdRpdhD1Mv7XnNfz4AbS7dszLbqVTkrqbvFfNLyLjNfTSkvvD`
   - Last deployed slot: `482124544`
   - Local `.so` SHA256: `16106686966EBD9FD6CEFA67AA14CD048B18A70860D7B41656202589849770D5`
2. `multisig_oracle` PDA initialized threshold=2:
   - Signers: oracle `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2`, cosigner `5LbJZuqBWfQCnJNAHLwt5D12K6kUFSZudBDXUWux5qWy`
   - Init tx: `3rQAZGLjxwiYPUaYugzowJrTg5Po4mGRmNSdZrQfczxo7aa1ZnCJwkWK5EeWXtqYEGAur3fz1CC4sg4i4pZgGkc2`
3. `price_oracle` initialized (required by `initialize_escrow_multisig`).

### Smoke (devnet)
- Script: `services/solana-programs/proxyhub/scripts/bc06-smoke-settle.mjs`
- Escrow PDA: `MmRicGnWStb88padCKfphUWyeWfbXYQ1as5MXLaKCL6` (`escrow_multisig` seeds)
- Settle tx: `5CSuohn9reiJD9yJvhhy9cPoyKTSPnr62CESdiLKQd1J52iQHwDwiRmqcQo13da5Fatks4VBCvbwxUrBRZP4aVcG`
- Nonce: `0 → 1` (**BC06_SMOKE_SETTLE_OK**)
- Escrow status: Settled

### Control-api (proxyhubb-testnet)
1. Amount gate: `PROXYHUB_MULTISIG_SETTLE_ENABLED=true`, threshold `100000000` lamports
2. Cosigner mounted/readable at `/opt/proxyhubb/secrets/multisig-cosigner.json`
3. Migration `000142` columns: `escrow_seed_kind`, `escrow_expires_at`
4. Boot log: `Multi-Sig Oracle initialized - Threshold: 2, Signers: 2, authorized_local=true, cosigner_env=true`
5. `/health` = 200
6. Routes: `pay/solana` → `escrow_multisig` when gated; `api.escrow.release` + compensation outbox → `SettleOrderEscrow` / `SettleEscrowMultiSigLocal`
7. Web sources installed for `initializeEscrowMultisig` (web image rebuild optional for UI path)

### Client fixes discovered during cutover
- Multisig init must run **after** KMS `RegisterOracleClient` (gcp-testnet has empty `SOLANA_ORACLE_KEYPAIR`).
- Go `LoadMultiSigConfig` now parses Borsh `Vec` (len + items), not a false fixed-5 array.
- Anchor builds must set `CARGO_TARGET_DIR` to repo `target/` — sandbox target dirs produced stale `.so` without BC-06.

## Live checks

| Check | Result |
|-------|--------|
| Program upgrade slot advanced | yes (`482124544`) |
| Nonce N→N+1 on multisig settle | yes (`0→1`) |
| Multisig oracle threshold=2 | yes |
| control-api healthy | yes |
| Multi-Sig boot log authorized_local | yes |
| DB columns escrow_seed_kind / escrow_expires_at | yes |
| Cosigner readable in container | yes |

## Tests
- `TestMultisigSettleEnabled` / `TestMultisigSettleAmountLamports` — ok
- `TestOrderUsesMultisigSettle` — ok
- Anchor suite: BC-06 nonce bump case added in `tests/proxyhub.ts`
- On-chain smoke settle — **PASS**

## Ops notes
- Upgrade script: `scripts/upgrade-proxyhub-bc06-devnet.sh`
- Ensure oracle: `services/solana-programs/proxyhub/scripts/bc06-ensure-multisig.mjs`
- Deploy helpers: `scripts/ops-deploy-bc06.sh`, `scripts/ops-upload-bc06.ps1`
- Cosigner key is testnet-only under `secrets/` (gitignored); do not reuse for hot/oracle.

## Remaining / follow-ups
- ~~Rebuild/redeploy **web** image~~ → done in `BC06_multisig_settle_ext_20260808T155500Z.md`.
- ~~Auto-release / usage settle~~ → routed through `SettleOrderEscrow(Usage)` (same ext evidence).
- Optional: full wallet marketplace buy→release of a gated order (smoke settle already PASS).
