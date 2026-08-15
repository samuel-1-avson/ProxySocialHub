# Evidence: Wave 8.D localnet bonded slash soak — 2026-08-13

## Verdict

**PASS** — `W8D_BOND_SLASH_OK` (localnet `solana-program-test`).

GCP / mainnet execute **not** claimed. Honesty `live_economic_slash=false`.
`programs/session` was not deployed.

## Exit claim

A real program keypair (`7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5`) runs
`initialize_config` → `set_deploy_allowed(true)` → `bond` → `accuse` →
`resolve_slash` **fails** while the 3600s window is open → clock warp →
`resolve_slash` moves `stake * 5000 / 10000` lamports to treasury.

## Live proof (localnet, 2026-08-13)

```
Program log: Instruction: ResolveSlash
Program log: AnchorError ... ChallengeWindowOpen ... Challenge window has not elapsed.
Program 7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5 failed: custom program error: 0x1777

Program log: Instruction: ResolveSlash
Program 7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5 success
treasury_delta=1000000000 expected=1000000000 program=7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5 session_rejected=1
W8D_BOND_SLASH_OK
```

```
cargo test --manifest-path programs/gateway-bond/Cargo.toml --test w8d_soak -- --nocapture
```

Keypair (gitignored): `programs/gateway-bond/keys/proxy_gateway_bond-keypair.json`
(also copied under `target/deploy/`). Pubkey committed in
`PROGRAM_ID.localnet`.

## Honesty (GCP)

`bonded_gateway_program=localnet_soak`  
`gateway_slash_execute=off` (unless dual-gate armed, still no broadcast)  
`live_economic_slash=false`  
`programs_session=unsafe_do_not_deploy`

Cluster deploy remains gated (`CONFIRM_W8_DEPLOY=1`, never mainnet, never session).

## Non-claims

- Not GCP / mainnet program deploy
- Not live economic slash in production
- Not DePIN / staking APY
- Not `programs/session`
- Not W7.D foreign org
