# Evidence: W12.B distinct `gateway-bond` for `edge-ext` — 2026-08-18

## Verdict

**PASS** — `W12B_BOND_OK` + `W7D_EXT_BOND_OK` + `W7D_BOND_PDA_CACHED`.

A Solana key **generated on** `proxyhubb-w7d-ext` (`fiffi-500411`) bonded
`min_stake` (1_000_000 lamports) to `programs/gateway-bond` on **devnet**.
This PDA is **not** the 2026-08-14 oracle soak bond. Slash dual-gates stayed
unset. Host-A `control-api` was **not** restarted. Not DePIN. Not
`programs/session`. Not mainnet.

## On-chain

| Field | Oracle soak (2026-08-14) | `edge-ext` (2026-08-18) |
|-------|--------------------------|-------------------------|
| Operator (Solana) | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` | `4X7aGwyeiH2v587CPaTTcMtdmUsQRjq3GW34NEis7fre` |
| Bond PDA | `H9a8FNvtRM5o7TWV9TVeaAvBiGGeXyNajUQ9Pgb8nbcq` | `HxmZVafPyn4NEcxwzCnX1eGwni7E7CEj42Bj2wnZYBAM` |
| Stake | 1_000_000 | 1_000_000 |
| `accused` / `slashed` | false / false | false / false |

| Field | Value |
|-------|--------|
| Program | `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` |
| Config PDA | `3r56iZ5JA5CKtZN9oiEtcwLkedNTYtYwU17SzQLCSoD8` (`deploy_allowed=true`) |
| Fund tx (0.02 SOL dust) | `5yiq65GeCEMC4JcCTDB6WN3Mdp5kbk4jQbPEpXdSNRuGitTDrSRWHKprFpiL4ZjrbzwNWHFWYvLEJ5ZSUP6Fhdb6` |
| Bond tx | `2ZSMByjW5Tamyjo6ejUFECxgHqHSDQLSmuPPoJPasuUWzFiybBCG2qCAnCESYirThqFVPBnW7APbczmnuxNNdt18` |
| RPC | `https://api.devnet.solana.com` |

Independent `getAccountInfo` on the new PDA: owner = gateway-bond program,
space 68, lamports 2_364_160 (rent + stake account).

Manifest Ed25519 for `edge-ext` remains
`AH7dzbx9wk7ekb2jQdiH6Jron5xd7Q9q6zfKMQpk9EVq` (W7.D). The bond signer is a
**separate** Solana key. Seed files stay on the foreign VM
(`/home/samue/proxyhubb-w7d/operator-key.json` and `operator-solana.json`).
Neither was copied to Host-A.

Dust to pay rent + stake was transferred from the platform oracle wallet.
The **bond instruction** was signed on `proxyhubb-w7d-ext` with
`CONFIRM_W12B_BOND=1`. ProxyHubb does not hold that Solana seed.

## Host-A cache

`gateway_operators.stake_account` for `edge-ext` =
`HxmZVafPyn4NEcxwzCnX1eGwni7E7CEj42Bj2wnZYBAM`.

```
proxyhubb-control-api-1 StartedAt=2026-08-18T22:19:07.846230183Z (unchanged)
PROXYHUB_SESSION_CAPABILITY=observe
live_economic_slash=false
gateway_slash_execute=off
operator_org_diversity=multi_org
W7D_BOND_PDA_CACHED
```

## Public honesty (after)

```
operator_org_diversity=multi_org
live_economic_slash=false
session_capability_mode=observe
gateway_slash_execute=off
```

## Scripts

- `w8-gateway-bond keygen` / `pubkey` / `bond` (gated)
- `scripts/gcp-w7d-ext-bond.sh`
- `scripts/gcp-w7d-cache-bond-pda.sh`

## Non-claims

- Not a third org (W11.B still open)
- Not operator-minted CONNECT
- Not live economic slash (no accuse/slash on this bond)
- Not permissionless SOL (oracle funded 0.02 dust)
- Not shop merchandising of `edge-ext`
- Not DePIN
