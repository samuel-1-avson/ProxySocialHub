# ADR 0009 — Governance autonomy (Wave 4.4)

- **Status:** Accepted (2026-08-11)
- **Related:** Wave 4 plan, `docs/ops/GOVERNANCE_AUTONOMY.md`

## Context

Ops could (a) flip Redis emergency pause via JWT admin and (b) hold the program admin key that can call `emergency_pause` on-chain. Treasury proposals that “execute” risked being confused with hot-wallet auto-spend. That concentrates pause + spend authority in a single ops path.

## Decision

### D1 — Split pause scopes

| Scope | Who | Default |
|-------|-----|---------|
| App-level (Redis watchtower) | JWT admin API | Allowed — stops API/edge flows |
| On-chain (`emergency_pause` ix) | Program admin key | **Not** via API unless `PROXYHUB_OPS_ONCHAIN_PAUSE=true` **and** `CONFIRM_ONCHAIN_PAUSE=1` |

### D2 — Treasury proposals → custody by default; dual-gated hot spend (W5.C.3)

Passed governance treasury transfers create `pending_custody` records by default.
`PROXYHUB_GOV_TREASURY_AUTO_SPEND` defaults **false**. Live hot-wallet `SendSOL`
requires **both** auto-spend **and** `PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM=1`.

This is still ops hot-wallet attestation — **not** on-chain proposal→treasury PDA CPI.

### D3 — On-chain `execute_proposal`

Status flip after ~24h timelock only. Does not move SOL. Documented client: `ExecuteProposalOnChain`.

## Consequences

- JWT admin alone cannot halt the Solana program.
- Custody/multisig remains the default path for treasury SOL movement.
- Dual-gated hot spend is an explicit ops escape hatch, not full DAO treasury autonomy.
- Full DAO autonomy (token-weighted on-chain treasury CPI) remains a later wave.
