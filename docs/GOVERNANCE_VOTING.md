# Governance voting (buyers & operators)

How proposals, quorum, and voting power work on ProxyHubb. For implementation status see [reports/PHASE_IMPLEMENTATION_STATUS.md](./reports/PHASE_IMPLEMENTATION_STATUS.md).

---

## For participants

### Creating a proposal

- Choose a **template** (signal, fee change, treasury transfer, etc.). Each template validates `execution_data` before submit.
- Set a **voting window** of 1–14 days (`duration_days`). The window starts when the proposal is created on-chain (after relay).
- **Signal** proposals record community sentiment; **executable** types require a healthy oracle and deployed governance program (see readiness on the create page or `GET /v1/governance/execution-readiness`).

### Casting a vote

1. Connect the same wallet you use on the platform (Playwright/dev wallets are for CI only).
2. Choose **For**, **Against**, or **Abstain**.
3. Sign the transaction in your wallet; the app relays it and mirrors your vote to the API.
4. Tallies may take a few seconds after relay; the UI retries if the mirror is not ready yet.

### Quorum and voting power (VP)

- **Quorum** is shown in **voting power (VP)** units on the proposal, not as a simple head count.
- Your weight comes from on-chain **PHB / stake rules** enforced by the program and relay — not from a separate off-chain score.
- If tallies look stuck at zero, refresh after finalization; the API maps `yes_votes` / `no_votes` (and abstain) from the mirrored record.

### Abstain

- Abstain counts toward participation where the program defines it; it does not add to For or Against totals on the progress bar.

### Discussion

- Each proposal can link a **forum thread** (Discussion tab). Use it for rationale; the binding vote is always on-chain.

---

## For operators

### Two authority modes

| Mode | What users see |
|------|----------------|
| **Chain mode** | Create/vote/execute go through Solana program + oracle. List may still show DB-backed metadata. |
| **Degraded** | Create/vote return **503** when oracle or program is not ready; fix RPC, program id, and oracle key before announcing DAO votes. |

Use **local E2E** (`docker-compose.local-solana.yml`, program `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7`) for CI. The default public devnet id `9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2` is **not** a deployed program on public devnet — do not use it for live governance smoke without deploying first.

### Multi-sig governor vs token governance

- **Token governance** (proposals in the app) uses the on-chain governance program and mirrored votes.
- **In-process multi-sig governor** (dev defaults) is separate, ephemeral across API restarts, and is not a substitute for production treasury control. Use hardware/multisig or Squads for real funds.

### Treasury execution

- After a proposal passes, execution depends on template type and executor worker health. Surface execution status on the proposal **Execution** tab; audit treasury rows when the `treasury_transactions` table is migrated in your environment.

---

## Related docs

- [STAGING_ENFORCE_RUNBOOK.md](./STAGING_ENFORCE_RUNBOOK.md) — live devnet governance E2E
- [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) — env vars and wallets
- [PHASE_IMPLEMENTATION_STATUS.md](./reports/PHASE_IMPLEMENTATION_STATUS.md) — what is done vs open
