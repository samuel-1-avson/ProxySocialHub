# W12.A — Usage challenge (slice 1)

A buyer can dispute a **claimed** settlement `leaves_hash` by filing an
off-chain petition. The protocol accuser (same pubkey as Wave 8
`gateway-bond` `config.accuser`) may then `accuse` with ADR 0015 D1
`evidence_hash`.

This is **not** trustless metering. Groth16 still binds a claimed digest,
not physical bytes (ADR 0010). Slice 1 is **not** permissionless
buyer-to-chain. Not DePIN. Never `programs/session`. Prefer
`resolve_release`. Do not arm `PROXYHUB_GATEWAY_SLASH_*`. Do not set
`live_economic_slash=true` from a release.

## Evidence hash (D1)

```
SHA256("PROXYHUB_USAGE_CHALLENGE:v1:" || window_key || "|" || hex(leaves_hash) || "|" || receipt_signature)
```

`leaves_hash` is 32 bytes, lowercase hex in the message.
`receipt_signature` is the portable receipt’s base58 Ed25519 signature.

## Operator / auditor (laptop)

Need a signed W9.C receipt (`w9c-settlement-bundle emit` or
`GET /v1/usage/settlement-receipts/:window_key`) and the 32-byte
`leaves_hash` being disputed.

```
cd services/control-api

go run ./cmd/w9c-settlement-bundle emit > receipt.json
# 32-byte leaves_hash being disputed (64 hex chars):
go run ./cmd/w12a-usage-challenge petition receipt.json abababababababababababababababababababababababababababababababab > petition.json
# or: go run ./cmd/w12a-usage-challenge demo

go run ./cmd/w12a-usage-challenge verify petition.json
go run ./cmd/w12a-usage-challenge hash petition.json
```

On-chain open (protocol accuser keypair; slash env **unset**):

```
export PROXYHUB_GATEWAY_BOND_PROGRAM_ID=7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5
export SOLANA_RPC_URL=https://api.devnet.solana.com
export SOLANA_ORACLE_KEYPAIR=/path/to/accuser-keypair.json
CONFIRM_W12A_ACCUSE=1 go run ./cmd/w12a-usage-challenge accuse petition.json <operator>
go run ./cmd/w8-gateway-bond wait-window <operator>
CONFIRM_W11C_RELEASE=1 go run ./cmd/w8-gateway-bond resolve-release <operator>
```

`resolve_slash` is not a CLI command. Escrow clawback is a **separate**
dual-gate and stays `WouldBroadcast=false` until a later soak.

Replay without a receipt file:

```
.\scripts\w12a-usage-challenge-client.cmd
# or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/w12a-usage-challenge-client.ps1
# or: bash scripts/w12a-usage-challenge-client.sh
```

Those scripts **do not** send an accuse tx.

## Honesty

- Slice 1 accuser SPOF: ProxyHubb-shaped `config.accuser`
- Bytes remain gateway-attested
- A usage challenge that **releases** is not economic slash
- Live usage accuse on the public-cluster bond is a distinct soak
- Not W12.A slice 2 (buyer-signed open without ProxyHubb as accuser)

## Non-claims

- Not TEE / R1CS-over-packets
- Not `programs/session`
- Not live economic slash
- Not DePIN
