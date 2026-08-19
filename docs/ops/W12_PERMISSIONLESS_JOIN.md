# W12.B — Permissionless join runbook

An operator can **keygen, bond, sign a manifest, and appear in a discovery
bundle** without a ProxyHubb engineer inserting a Postgres row.

This is a **runbook**, not a live multi-org claim. Host-B in
`gen-lang-client-0022105784` still does not count. Shop merchandising on
proxyhubb.com may still omit the operator. Not DePIN.

## What “join” means here

| Step | Who | Postgres? |
|------|-----|-----------|
| 1. Ed25519 keygen | operator | no |
| 2. Solana `gateway-bond` `bond` (min stake) | operator | no |
| 3. Sign W6.B manifest (`org_id` ≠ platform) | operator | no |
| 4. Publish bundle (file / URL / CID) | operator | no |
| 5. Pin `PROXYHUB_OPERATOR_BUNDLE_*` on an edge | anyone | no |
| 6. Title / search on proxyhubb.com | platform (optional) | **yes** — merchandising only |

Censorship of the **shop UI** is not censorship of the commitment set. Edges
that pin the bundle can still list the operator.

## Operator (their machine)

Need: Go, Solana **devnet** SOL for rent + `min_stake` (1_000_000 lamports on
the current program), and `programs/gateway-bond`
`7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5`. Never `programs/session`.
Never mainnet. Leave `PROXYHUB_GATEWAY_SLASH_*` unset.

```bash
cd services/control-api

# 1. Manifest key (keep signing_key offline).
go run ./cmd/w7d-operator-join keygen > operator-key.json

# 2. Bond. SOLANA_ORACLE_KEYPAIR here is *your* Solana keypair JSON, not ProxyHubb's.
export PROXYHUB_GATEWAY_BOND_PROGRAM_ID=7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5
export SOLANA_RPC_URL=https://api.devnet.solana.com
export SOLANA_ORACLE_KEYPAIR=/path/to/your-solana-keypair.json
CONFIRM_W12B_BOND=1 go run ./cmd/w8-gateway-bond bond
go run ./cmd/w8-gateway-bond pda "$(solana-keygen pubkey /path/to/your-solana-keypair.json)"
# record bond_pda

# 3. Sign a foreign org_id (must not be gen-lang-client-0022105784).
go run ./cmd/w7d-operator-join sign-from-keygen < operator-key.json > operator-join.json
# or: pipe custom JSON to `sign` (signing_key, slug, org_id, host_id, buyer_base_url, …)

# 4. Publish bundle only (no signing_key).
go run ./cmd/w7d-operator-join extract-bundle < operator-join.json > operators-ext.json
go run ./cmd/w7b-manifest-bundle verify operators-ext.json
# Host operators-ext.json on HTTPS or IPFS. Give others the URL or CID.
```

Replay without typing the steps:

```
.\scripts\w12b-permissionless-join.cmd
# Windows:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/w12b-permissionless-join.ps1
```

Those scripts **do not** send a bond tx (no operator SOL key in CI). They prove
keygen → sign → bundle verify with **no Postgres**. Bond is a manual
`CONFIRM_W12B_BOND=1` step. Live `edge-ext` bond 2026-08-18:
[`evidence/W12_B_edge_ext_bond_20260818.md`](evidence/W12_B_edge_ext_bond_20260818.md).
`sign-from-keygen` defaults to `org_id=ext-operator-org-1` (override with
`W12B_ORG_ID`).

## Edges / buyers (pin, no seed)

```
PROXYHUB_OPERATOR_BUNDLE_PATH=/etc/proxyhubb/operators-ext.json
# or PROXYHUB_OPERATOR_BUNDLE_URL=https://…/operators-ext.json
# or PROXYHUB_OPERATOR_BUNDLE_CID=<cid>
```

`w7b-manifest-bundle verify` must succeed with control-api down.

## Platform (ProxyHubb)

May refuse merchandising (no `catalog_products` row, no title on proxyhubb.com).
Directory titles for `edge-ext` / `edge-org3` were set 2026-08-19
(`W12B_MERCHANDISE_TITLES_OK`;
[`evidence/W12_B_merchandise_titles_20260819.md`](evidence/W12_B_merchandise_titles_20260819.md)).
Join hosts were stopped (not deleted) the same day
([`evidence/W7_D_join_hosts_stopped_20260819.md`](evidence/W7_D_join_hosts_stopped_20260819.md)).
Must not require a seed of `gateway_operators` for the bundle to verify.
Must not hold the operator’s `signing_key`.
`CONFIRM_W7D_EXTERNAL_VPS=1` is a **live foreign host** claim. Claimed
2026-08-18 (`W7D_EXTERNAL_VPS_OK`):
[`evidence/W7_D_external_vps_20260818.md`](evidence/W7_D_external_vps_20260818.md).

## Honesty

- `operator_org_diversity` is **`multi_org`** when a foreign org is cached
  (live 2026-08-18: `edge-ext` / `fiffi-500411`).
- This runbook does not make join permissionless **shop listing**.
- Not DePIN.

## Non-claims

- Not W11.B three-org proof
- Not live economic slash
- Not `programs/session`
- Checkout / new orders may still need control-api
