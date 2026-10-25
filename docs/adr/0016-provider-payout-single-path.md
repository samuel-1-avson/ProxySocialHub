# ADR 0016: Pay a provider through one path per session

- Status: accepted (implements BE-CRIT-02 of the 2026-10-25 audit)
- Date: 2026-10-25

## Context

A finished session could pay its provider up to three times:

1. **Custodial settle.** `billing.settleSession` debits the buyer, credits the provider's
   `wallets.balance_sol` once (ledger reference `<session>:provider`), and
   `queueProviderPayout` later pays the balance out on chain *and debits it by the same
   amount*. This path is internally balanced.
2. **`recordProviderEarning`.** Called when a session ends (and from the escrow outbox). For
   every session that was not backed by an order escrow it also called
   `BatchPayoutProcessor.QueuePayout` for the earning amount. That payout was not debited
   from any balance, so it was paid in addition to path 1 for custodial sessions, and in
   addition to `settle_session_escrow` for session-escrow sessions.
3. **`POST /v1/provider/claim/confirm`.** Paid every `provider_earnings` row still
   `pending` straight from the treasury hot wallet, again without debiting a balance. Rows
   created for custodial sessions were never moved out of `pending`, so they stayed
   claimable.

## Decision

Each session is paid by exactly one mechanism, chosen by how it was funded, and
`provider_earnings` is bookkeeping, not a payment instruction.

| Funding | Pays the provider | Earning row becomes `paid` |
|---|---|---|
| Order escrow PDA | `settle_escrow` on chain | `finalizeProviderPayoutAfterSettle` (with the tx hash) |
| Session escrow PDA | `settle_session_escrow` on chain | `billing.markProviderEarningPaid` |
| Custodial balance | Ledger credit in `settleSession`, then the balance payout | `billing.markProviderEarningPaid` |

Changes:

- `recordProviderEarning` no longer queues a payout. If the provider was already credited
  when the row is created (the ledger entry exists), the row starts `paid`.
- `settleSession` marks the session's pending row `paid` after the credit or the on-chain
  session settle.
- `POST /v1/provider/claim/prepare|confirm` stay switched off (`ENABLE_PROVIDER_CLAIM`).
  With the rows no longer left pending they would not double-pay, but the flow still sends
  treasury SOL without debiting a balance, so it should be removed or rebuilt as a
  withdrawal from the provider's balance before it is enabled.

## Consequences

- A custodial session is paid once. Providers on that path who relied on the extra direct
  payout now receive only the balance payout, which waits for `providerPayoutThresholdSOL`.
- The dashboard's pending figure now falls when a session is credited instead of staying
  pending forever.
- **Not done: reconciliation.** Sessions already paid more than once before this change
  need a ledger comparison (credits of type `provider_earning`, rows in `pending_payouts`
  whose idempotency key is `sha256(provider:wallet:session)`, and claims) against treasury
  outflows. It needs production data and is left to an operator.
- `provider_earnings` already has a unique index on `session_id`, so a session still gets
  at most one earning row.
