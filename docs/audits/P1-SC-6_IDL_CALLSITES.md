# P1-SC-6: IDL regeneration, call-site audit and devnet redeploy checklist

Status: preparation complete. **Not deployed.** The devnet upgrade still needs
the operator checks and explicit go-ahead listed at the end.

## 1. What was regenerated

- Toolchain: Rust 1.89.0, Solana CLI 2.3.0, Anchor 0.32.1, Node 24.10.0
  (`anchor build` in a Linux container, same pins as the CI `anchor-test` job).
- New canonical snapshots, committed with this change:
  - `services/solana-programs/proxyhub/idl/proxyhub.json`
    (61 instructions, 28 accounts, 77 types, 47 events;
    SHA-256 `c8446afe…e4c9d`)
  - `services/solana-programs/proxyhub/idl/session.json`
- The previously committed IDL, `apps/web/src/lib/idl/proxyhub.json`, is an
  old-format (pre-0.30, camelCase) subset with only four instructions
  (`initializeEscrow`, `initializeEscrowMultisig`, `refundEscrow`,
  `settleEscrow`). It was **not** overwritten: the web app uses the old
  `@project-serum/anchor` API, which cannot parse the new IDL format.
  Migrating the web client is P2-ABI-1 / P3-FE-2 work, not a deploy blocker,
  because the web app calls none of the hardened instructions directly
  (section 3).

## 2. What the hardening changed on chain (commit 6997c8c)

Account-list changes (callers must pass different accounts):

| Instruction | Before | After |
|---|---|---|
| `claim_bandwidth_rewards` | pool, provider (signer), program_state | pool, **epoch_claim receipt (new, init)**, provider (unchecked), **oracle = admin**, program_state, system_program |
| `submit_review_attestation` | oracle, attestation, system_program | + **program_state** appended last |
| `log_spending_event` | oracle only | + **program_state** |

Signer-constraint changes (same accounts; the existing signer must now equal
`program_state.admin`): `update_program_config`, `stake_provider`,
`unstake_provider`, `lock_session_commitment`, `create_proposal`,
`open_dispute_onchain`, `initiate_jury_dispute`. Legacy `settle_escrow`
enforces the same check inside its handler. `multi_sig_pause_vote` keeps its
accounts and its `approvals` argument, but the argument is now ignored: only
real transaction signers in the oracle set are counted.

## 3. Call-site audit

Go builders in `services/control-api/internal/solana` were compared
account-by-account against the regenerated IDL. All match, and all sign with
the single oracle key:

| Instruction | Builder | Verdict |
|---|---|---|
| `stake_provider`, `unstake_provider` | `staking_tx.go` | Match (incl. `program_config` on unstake) |
| `lock_session_commitment` | `session_commitment.go` | Match |
| `create_proposal` | `governance.go` | Match |
| `open_dispute_onchain` | `dispute.go` | Match |
| `submit_review_attestation` | `review.go` | Match (fixed in `2bfa191`) |
| `settle_escrow` | `settlement.go` (`buildSettleInstruction`) | Match |
| `settle_session_escrow` | `session_escrow.go` | Match |
| `submit_usage_proof` | `settlement.go` | Match (admin-bound before this hardening round) |

No Go or web callers exist for `update_program_config` (the Go client in
`program_config.go` is read-only; only an unused discriminator constant
exists), `initiate_jury_dispute`, `cast_jury_vote_onchain`,
`claim_bandwidth_rewards`, `log_spending_event` or `multi_sig_pause_vote`.
Their only callers are the Anchor TS tests, updated in the hardening commit
and green in the full suite (72 passing).

Web (`apps/web/src/lib/solana.ts`) calls only `initializeEscrow`,
`initializeEscrowMultisig`, `refundEscrow`, `initializeTokenEscrow`,
`refundTokenEscrow` and `raiseDispute`. None is in the hardened set.
Pre-existing drift to hand to P2-ABI-1: `raise_dispute` and
`emergency_refund`/`refundEscrow` do not exist under those names in the
current program, and `apps/web` governance goes through the control-api HTTP
API, not the program.

A golden test now pins the Go side to this IDL snapshot:
`internal/solana/idl_accounts_test.go` checks discriminators, account name
order and the admin signer slots for every instruction above. It cannot
fail on the pre-change tree in the usual sense — neither the test nor the
committed IDL snapshot exists there — so it is a drift guard from here on,
not a red-to-green proof.

Conclusion: no Go code change is required for the upgrade. The single
runtime precondition is that the control-api **oracle key equals
`program_state.admin`** on the target cluster.

## 4. Devnet state observed (read-only, 2026-10-26)

- Program `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` is deployed and
  upgradeable. Upgrade authority: `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR`
  (from the ProgramData account `5goYxHCJopnqc34axdnbjTpDkwLDrPkTo7gYbhB3tk9n`).
- `program_state` PDA `DhtQtWwASyx6aKCNQTKRpE6sDT2jVrVypRu3KKcJwVVj` exists:
  admin `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2`, no pending admin,
  not paused. That admin pubkey appears nowhere in this repo.
  Operator confirmed 2026-10-26: the devnet oracle signer **is** this
  admin key, so no admin rotation is needed. (A different pubkey,
  `BHWyKN5Q…PypBq`, was briefly supplied and then withdrawn by the
  operator; it is a seller test wallet in
  `docs/ops/evidence/PHASE_C_money_loop_20260820.md`, not the oracle.
  Do not use it.) Custody of the private keys was not and cannot be
  verified from here; that part rests on the operator's confirmation.
- The deployed binary still predates the hardening commits. Only
  `submit_review_attestation` is order-sensitive: each side rejects the
  other side's account list for that one instruction. The order below
  (control-api first, as previously decided) keeps that window explicit.

## 5. Deploy checklist (operator-run; nothing here is automated in this PR)

Preconditions, in order. Stop if any check fails.

1. Oracle == admin: **confirmed by the operator** (see section 4).
   Before deploying, sanity-check that the target environment's oracle
   signer still resolves to `8P4uuapg…nKii2` (for example from
   control-api startup logs). If it ever stops matching, stop: rotate
   `program_state.admin` (two-step `propose_admin_transfer` /
   `accept_admin_transfer`) or repoint control-api; deploy neither side
   until they match again.
2. Set `ADMIN_JWT_SECRET` in the target environment (admin auth answers
   503 while it is empty). Decide `ENABLE_PROVIDER_CLAIM` stays off.
3. Build from clean `main` after this PR merges. Keep the previous
   `proxyhub.so` for rollback.
4. Deploy **control-api first** (it already passes the new
   `program_state` account; the old program ignores extra accounts only
   if Anchor tolerates them — for `submit_review_attestation` the old
   program will reject the extra account, so expect review attestation
   errors between steps 4 and 5 and keep that window short; every other
   audited call is account-identical on both versions).
5. Upgrade the program in place with the wallet that controls
   `6thzwmrf…bRJcR`, using the repo build that produced the committed IDL.
   Verify the script in
   `services/solana-programs/proxyhub/deploy-proxyhub-devnet.ps1` still
   matches the intended upgrade flow before running it (it cites an old
   bytecode hash); it must not be run verbatim without that check.
6. Publish the new on-chain IDL (`anchor idl upgrade` or `init` against
   the committed `idl/proxyhub.json`) so control-api's cached-IDL gates
   (`SupportsInstructionsFromCachedIDL`, 24h Redis TTL) see the new
   interface. Flush or wait out the `anchor:idl:<program>` cache.
7. Smoke on devnet: initialize escrow, confirm, settle (legacy and
   session), stake/unstake, create proposal, submit review, open dispute.
   Negative smoke: call `update_program_config` and a non-admin
   `stake_provider` from a throwaway key and confirm rejection.
8. Record the deployed bytecode hash (`solana program dump` + SHA-256)
   and the upgrade slot in this file, then tick P1-SC-6 and G0 in the
   tracker — only then.

Handshake note for step 4/5 ordering: because Anchor rejects unknown extra
accounts for `submit_review_attestation` on the old program, an alternative
is to pause review submission during the window rather than swap the order.
Swapping the order (program first) makes the same call fail from the old
control-api instead. Either way one side fails briefly for that single
instruction; keep the window minutes, not hours.

## 6. Not done / not covered by this preparation

- The devnet upgrade itself, and the on-chain IDL publish. Awaiting
  operator keys and explicit go-ahead.
- Verifying private-key custody for the admin (`8P4uuapg…nKii2`) and
  upgrade authority (`6thzwmrf…bRJcR`) keys. Operator-side only.
- C22 (jury vote spoofing, first-caller initializers) and C23 (mutual
  receipt unit mismatch) are unchanged by this work and still need their
  own decisions.
- Migrating `apps/web` off the old-format IDL, and Go binding generation
  from the IDL. Both are P2-ABI-1.
- Hosted CI execution of any of this: GitHub Actions currently cannot
  start jobs for this repository (see PR #44 discussion), so the
  `anchor-test` job that guards these account lists has local evidence
  only until Actions is restored.
