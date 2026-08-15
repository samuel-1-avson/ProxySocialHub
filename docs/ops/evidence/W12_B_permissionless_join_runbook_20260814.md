# Evidence: Wave 12.B permissionless join runbook — 2026-08-14

## Verdict

**PASS (runbook)** — `W12B_JOIN_RUNBOOK_OK`.

**Not claimed:** live foreign org, `multi_org`, shop merchandising, DePIN,
`CONFIRM_W7D_EXTERNAL_VPS=1`, a bond tx from a new operator SOL key.

## Exit claim

An operator can **keygen, sign a foreign `org_id` manifest, and produce a
verifiable discovery bundle** without a ProxyHubb engineer inserting a
Postgres row. Bond is a separate operator tx
(`CONFIRM_W12B_BOND=1 go run ./cmd/w8-gateway-bond bond`) and was **not**
sent in this proof (no extra SOL key). Host-B in
`gen-lang-client-0022105784` still does not count as org 2.

## What shipped

- [`docs/ops/W12_PERMISSIONLESS_JOIN.md`](../W12_PERMISSIONLESS_JOIN.md)
- `scripts/w12b-permissionless-join.sh` and `.ps1` (Python-free)
- `w7d-operator-join sign-from-keygen` / `extract-bundle`
- `w8-gateway-bond bond` (gated; not executed here)

Replay:

```
.\scripts\w12b-permissionless-join.cmd
# or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/w12b-permissionless-join.ps1
# or: bash scripts/w12b-permissionless-join.sh
```

## Proof (2026-08-14, this laptop)

```
ok edge-ext-w12b
verified=1 failed=0 discovery_sot=bundle
W7B_BUNDLE_VERIFY_OK
postgres_seed=false
W12B_BOND_SKIPPED (no operator SOL keypair in this script)
W12B_JOIN_RUNBOOK_OK
```

`org_id=ext-operator-org-1` (not the platform org). Bundle JSON has no
`signing_key`. `CONFIRM_W7D_EXTERNAL_VPS` was unset; the script refuses if
it is `1`.

## Honesty

- `operator_org_diversity` stays `same_org`
- Not permissionless **shop listing**
- Not W11.B three-org proof
- Not live economic slash
- Not `programs/session`
- Checkout / new orders may still need control-api
