# Evidence: Wave 8 / P0.4 Docker SBF for gateway-bond — 2026-08-13

## Verdict

**PASS** — `W8_GATEWAY_BOND_SBF_OK` (Docker `rust:1.89-trixie`, Anza CLI 2.3.0,
platform-tools cargo 1.84).

Devnet **deploy and soak are not done** in this evidence. Program account
`7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` is still missing on
`https://api.devnet.solana.com`. GCP slash gates were not set.
`live_economic_slash` stays **false**. `programs/session` was not built or
deployed.

## ELF

| Field | Value |
|-------|--------|
| Path | `programs/gateway-bond/target/deploy/proxy_gateway_bond.so` |
| Size | 317928 |
| sha256 | `538027b2c375f5b0caaf9e9e411d57234131bdf81066345ece6f50a2db085186` |
| Program id | `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` |
| Marker | `gateway-bond config init deploy_allowed=false` |
| Session id embedded | no |

Command:

```
powershell -File scripts/w8-docker-sbf-gateway-bond.ps1
```

## Why the SBF graph was stripped

`solana-program-test` / `solana-sdk` 1.18 (dev-dependencies) lock
`indexmap 2.14`, whose manifest needs **edition2024**. Platform-tools cargo
**1.84** cannot parse that. The Docker script:

1. Backs up `Cargo.toml` / `Cargo.lock` under `.sbf-bak/` (gitignored)
2. Drops `[dev-dependencies]` for the compile only
3. Pins edition2024 / MSRV offenders (`zerocopy 0.8.26`, `indexmap 2.11.4`,
   `proc-macro-crate 3.2.0`, `cc 1.2.16`, `jobserver 0.1.32`,
   `unicode-segmentation 1.12.0`, …)
4. Runs `cargo-build-sbf -- --ignore-rust-version`
5. Restores the test lockfile

Do **not** pin `zeroize` to 1.8.1: `curve25519-dalek 3.2.1` (solana 1.18)
requires `zeroize < 1.4`.

## Next (gated; never mainnet; never session)

```
$env:CONFIRM_W8_DEVNET_DEPLOY = "1"
powershell -File scripts/w8-devnet-deploy-gateway-bond.ps1

$env:CONFIRM_W8_DEVNET_SOAK = "1"
powershell -File scripts/w8-devnet-soak-gateway-bond.ps1
```

Soak is initialize + `set_deploy_allowed(true)` + one **1_000_000 lamport**
bond. It does **not** accuse or slash. `CONFIRM_W8_DEPLOY=1` remains a refuse
flag in the unit smokes.

## Honesty (GCP)

Unchanged:

- `bonded_gateway_program=localnet_soak` (no GCP env flip in this step)
- `gateway_slash_execute=off`
- `live_economic_slash=false`
- `programs_session=unsafe_do_not_deploy`

## Non-claims

- Not on-chain yet (devnet account missing)
- Not live economic slash
- Not DePIN
- Not `programs/session`
- Not W7.D foreign org
