# Evidence: Wave 10.C settlement receipt auditor path — 2026-08-14

## Verdict

**PASS** — `W10C_RECEIPT_EXPORT_OK` + `W9C_SETTLEMENT_RECEIPT_OK`.

`GET /v1/usage/settlement-receipts/:window_key` exported a signed receipt.
Offline verify did **not** read `orders`. `settlement_sot=escrow_pda` with
`escrow_tx` query param (live `orders.tx_signature`, 88 chars).
`WouldBroadcast()` is **false**. Slash / settlement-bundle dual-gates unset.
Not trustless metering. Not DePIN.

## Proof

Window: `17c4b690-b860-4885-ae74-d0ca22560bb4:2026-08-09T12:00:00Z`

```
receipt_http=200
W10C_RECEIPT_EXPORT_OK
verified=true settlement_sot=escrow_pda would_broadcast=false
W9C_SETTLEMENT_RECEIPT_OK
```

Auditor copy on Host-A: `/opt/proxyhubb/ops/w10c-settlement-receipt.json`

CLI: `/tmp/w7-bin/w9c-settlement-bundle verify` (no Postgres).

Host-A control-api was rebuilt to add the export route (VM tree lacked
`settlement/receipt.go`). Recreate kept `docker-compose.w6-host-a-private.yml`
and observe overlay. Slash env stayed unset.

## Non-claims

- Not a new SOL send path
- Public config may still omit a `settlement` object (honesty helper not on
  this binary); CLI `would_broadcast=false` is the soak proof
- Not DePIN / not `programs/session`
