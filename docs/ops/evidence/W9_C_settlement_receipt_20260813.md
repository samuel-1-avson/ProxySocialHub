# Evidence: Wave 9.C portable settlement receipt — 2026-08-13

## Verdict

**PASS** — `W9C_SETTLEMENT_RECEIPT_OK` (unit). Does not send SOL.
Not trustless metering.

## Exit claim

A settlement window can be exported as a signed receipt and verified without
reading `orders`. Chain tx (`escrow_tx`) is SoT when present; otherwise
`postgres` or `postgres_cache` if a bundle is pinned. Dual-gate
(`PROXYHUB_SETTLEMENT_BUNDLE_AUTO` + `PROXYHUB_SETTLEMENT_BUNDLE_CONFIRM=1`)
stays observe-only: `WouldBroadcast()` is always false.

## Unit proof

```
go test ./internal/settlement/ -count=1 -run 'ReceiptSoT|WouldBroadcast|SignAndVerifyReceipt|ParseReceipt'
# default postgres; pin → postgres_cache; escrow_tx → escrow_pda
# WouldBroadcast always false even when gates armed
# tamper fails verify
```

CLI: `go run ./cmd/w9c-settlement-bundle verify <file-or-url>`.
Protected export: `GET /v1/usage/settlement-receipts/:window_key`.

Public honesty: `GET /v1/system/config/public` → `settlement.settlement_sot`.

## Non-claims

- Not trustless metering (ADR 0010)
- Not a new treasury / SOL send path
- Not `programs/session`
- Not DePIN
- Custodial hot-wallet payouts may remain
