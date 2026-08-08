# BC-06 extension — Multisig settle on auto-release + usage paths

| Field | Value |
|-------|--------|
| **Stamp** | 2026-08-08T15:55:00Z |
| **Host** | proxyhubb-testnet |
| **Program** | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` (devnet) |
| **Verdict** | **PASS** (deploy + binary/source gates; full wallet buy→release still optional) |

## What landed

### Control-api
All escrow settle call sites now go through `SettleOrderEscrow` / `SettleOrderEscrowUsage`, which routes `escrow_seed_kind=multisig` to `SettleEscrowMultiSigLocal`:

| Path | Source tag | Shared helper |
|------|------------|---------------|
| Manual release | `api.escrow.release` | `SettleOrderEscrow` |
| Auto-release worker | `api.escrow.auto_release` | `SettleOrderEscrow` |
| Usage meter settle | `api.usage.anchor_and_settle` | `SettleOrderEscrowUsage` |
| Compensation outbox | settle retry | `SettleOrderEscrowUsage` / `EnqueueEscrowSettleUsage` |

### Web
- Rebuilt/redeployed image with `initializeEscrowMultisig` + BuyListingModal gate on `escrow_seed_kind === 'multisig'`.
- Deploy script: `scripts/ops-deploy-bc06-ext.sh`

## Live checks (proxyhubb-testnet)

| Check | Result |
|-------|--------|
| control-api `/health` | 200 |
| web `/` | 200 |
| Binary contains `SettleOrderEscrowUsage` | yes |
| Binary contains `api.escrow.auto_release` / `api.usage.anchor_and_settle` | yes |
| Boot: Multi-Sig Oracle threshold=2, cosigner_env=true | yes (`2026/08/08 15:49:25`) |
| Source: auto_release → `SettleOrderEscrow` | yes (`escrow.go`) |
| Source: usage → `SettleOrderEscrowUsage` | yes (`usage.go`) |
| Web build includes `BuyListingModal` + `initializeEscrowMultisig` | yes (`.next` chunks) |
| Deploy marker | `BC06EXT_DEPLOY_DONE` / `VERIFY2_OK` |

## Tests
- Existing: `TestOrderUsesMultisigSettle`, amount-gate tests
- On-chain BC-06 smoke settle (prior evidence) remains the settle-ix proof

## Notes / residual
- Full marketplace gated buy → release with a funded wallet was not re-run in this cut; smoke settle + shared helper coverage is the evidenced bar.
- Multisig amount gate + cosigner wiring unchanged from BC-06 base evidence.
