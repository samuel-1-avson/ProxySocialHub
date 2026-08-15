# W4.4 — Governance autonomy

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `GOV_AUTONOMY_NARROW_PAUSE` |
| ADR | [0009](../../adr/0009-governance-autonomy.md) |
| Spec | [GOVERNANCE_AUTONOMY.md](../GOVERNANCE_AUTONOMY.md) |

## What landed

1. Pause scope split: API = Redis app-level; on-chain pause dual-gated.
2. `ExecuteProposalOnChain` client (status flip only).
3. Treasury auto-spend flag default false + explicit non-implementation log.
4. Public `governance` honesty meta on system config.
5. Reputation post-deploy init completed earlier same day (`deploy_allowed=true`).

## Non-claims

No on-chain treasury CPI; custody multisig still required for SOL movement.
