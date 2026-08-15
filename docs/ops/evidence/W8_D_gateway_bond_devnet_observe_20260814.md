# Evidence: Wave 8 / P0.4 gateway-bond **devnet** observe — 2026-08-14

## Verdict

**PASS** — `W8_DEVNET_DEPLOY_OK` + `W8_DEVNET_SOAK_OK`.

One tiny bond on Solana **devnet**. No accuse. No slash. GCP dual-gates stay
**off**. Honesty `live_economic_slash=false`. `programs/session` was not
deployed. Not DePIN.

## Exit claim

`programs/gateway-bond` is on public-cluster **devnet** (not session, not
mainnet). `initialize_config` started with `deploy_allowed=false`, then
`set_deploy_allowed(true)` for a single 1_000_000 lamport bond. Execute slash
is still dual-gated and was **not** armed.

## On-chain

| Field | Value |
|-------|--------|
| Program Id | `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` |
| ProgramData | `6s35Uh62LXA2cgPLYRJCuV8jzVCuXdDwTt5UwquMDG2F` |
| Upgrade authority | `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` (laptop) |
| Last deployed slot | `483716945` |
| ELF size | 317928 |
| ELF sha256 | `538027b2c375f5b0caaf9e9e411d57234131bdf81066345ece6f50a2db085186` |
| RPC | `https://api.devnet.solana.com` |
| Payer | oracle `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Deploy tx | `3GvUB6hADJMrAZPyoZG7bBMAck32XBLmPq5amYeJ2TS5a1Z3nDaEiFah4PyJ6TfMwci4hexudQKX45KgT3hhUG8d` |
| Config PDA | `3r56iZ5JA5CKtZN9oiEtcwLkedNTYtYwU17SzQLCSoD8` |
| Init tx (`deploy_allowed=false`) | `2PU1vVVVnrwCpdcm2fjasE5Jnt5ysGuPmPgpfiJK8Erx59jyGeFXYwkXEJM5b5iETRvRtJPXQRUyWmZe2aCrhweX` |
| `set_deploy_allowed(true)` | `4Sep9houei7foHtn9x3qZTCHU97SkCfBMmezTWmARjCyvk6p9oJzUVeN65dSLLHBeUJ2Apo2FwKBt6FxKuVxvxTp` |
| Operator | oracle (same pubkey) |
| Bond PDA | `H9a8FNvtRM5o7TWV9TVeaAvBiGGeXyNajUQ9Pgb8nbcq` |
| Bond tx | `3fEJbTYbJdzNLNBzsAo5fWNdiMsq9Gqax5Cbam4711iL981iXUJQXsocsrJAWcPYDYfYrFWEXuDwWcQfkLiAGece` |
| Stake | 1_000_000 lamports (`min_stake`) |
| `accused` / `slashed` | false / false |

```
CONFIRM_W8_DEVNET_DEPLOY=1 powershell -File scripts/w8-devnet-deploy-gateway-bond.ps1
CONFIRM_W8_DEVNET_SOAK=1 powershell -File scripts/w8-devnet-soak-gateway-bond.ps1
```

Soak JSON (2026-08-14):

```
W8_DEVNET_SOAK_OK
accused=false slashed=false live_economic_slash=false
gateway_slash_execute=off bonded_gateway_program=devnet_observe
initialize_config=already_present set_deploy_allowed=already_true
programs_session=unsafe_do_not_deploy
```

`CONFIRM_W8_DEPLOY=1` is **not** a deploy tool. Slash env vars were unset.

## GCP

Slash gates **not** set (`PROXYHUB_GATEWAY_SLASH_AUTO` /
`PROXYHUB_GATEWAY_SLASH_CONFIRM` absent). Public honesty
`live_economic_slash=false`. GCP may still label
`bonded_gateway_program=localnet_soak` until a later control-api binary
roll; that label is **stale**, not an execute claim. Execute stays off.

## Non-claims

- Not live economic slash (`live_economic_slash` stays false until W11.C)
- Not `programs/session`
- Not mainnet
- Not DePIN / staking APY
- Host-B still `same_org`
- Upgrade authority was **not** copied to the app VM
