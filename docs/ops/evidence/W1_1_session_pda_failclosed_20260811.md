# W1.1 Session PDA fail-closed — code evidence

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `W1_1_SESSION_PDA_FAILCLOSED_CODE` |
| Live VM smoke | Run `scripts/gcp-smoke-sprint-j1-failclosed.sh` for `SPRINT_J1_FAILCLOSED_OK` |

## Changes

- Migration `000144_session_escrow_confirmed_at`
- `fund/solana` sets `solana_session_escrow_pending`; confirm sets `escrow_confirmed_at`
- Active blocked without confirm (`402 session_escrow_required`)
- Edge aborts CONNECT/WS on `SessionEscrowRequired`
- Unit tests: `TestIntentRequiresFundedSessionPDA_*`
