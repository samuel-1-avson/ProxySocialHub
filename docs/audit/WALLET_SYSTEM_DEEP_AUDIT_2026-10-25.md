# Wallet System — Deep Audit & Analysis Report

| Field | Detail |
|---|---|
| Project | ProxySocialHub (ProxyHubb) |
| Scope | User wallet system end-to-end: custodial SOL wallet, deposits, withdrawals, P2P transfers, spending limits, linked wallets, provider earnings & payouts, usage billing settlement, escrow money paths, treasury / hot-wallet ops, double-entry journal, reconciliation, Solana on-chain touchpoints, web wallet UI |
| Date | 2026-10-25 |
| Auditor | Muse Code (muse-wonder-full-1.0) — static code audit |
| Method | Manual line-by-line review of wallet-critical Go / SQL / TS / Rust surfaces, threat modelling (STRIDE), OWASP API checks, concurrency & atomicity analysis, money-invariant tracing. No live chain, database, or production traffic was exercised. |
| Codebase state | Working tree at audit time. Prior audits exist (`docs/audit/10_BILLING_WALLET_ESCROW_AUDIT.md`, `docs/audits/`); many earlier criticals (e.g. BE-CRIT-01, BE-CRIT-02) are visibly fixed in code. This report covers what **remains**. |
| **Verdict** | **BLOCKED for mainnet / real-value custody. Approved for devnet / capped testnet only.** |
| **Overall score** | **57 / 100** (see §11) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Map — What the Wallet System Actually Is](#2-system-map--what-the-wallet-system-actually-is)
3. [Findings Register (Summary Table)](#3-findings-register-summary-table)
4. [Critical & High Findings — Detail](#4-critical--high-findings--detail)
5. [Medium Findings — Detail](#5-medium-findings--detail)
6. [Low Findings & Hardening Gaps](#6-low-findings--hardening-gaps)
7. [Errors & Correctness Bugs (Non-Security)](#7-errors--correctness-bugs-non-security)
8. [Bottlenecks & Performance Analysis](#8-bottlenecks--performance-analysis)
9. [Bad Code & Maintainability Analysis](#9-bad-code--maintainability-analysis)
10. [Threat Model (STRIDE)](#10-threat-model-stride)
11. [Scoring](#11-scoring)
12. [What Is Done Well (Positive Controls)](#12-what-is-done-well-positive-controls)
13. [Remediation Roadmap](#13-remediation-roadmap)
14. [Testing Gaps & Recommended Tests](#14-testing-gaps--recommended-tests)
15. [Appendix A — File & Endpoint Inventory](#appendix-a--file--endpoint-inventory)
16. [Appendix B — Money Invariants Checklist](#appendix-b--money-invariants-checklist)
17. [Appendix C — Audit Limitations](#appendix-c--audit-limitations)

---

## 1. Executive Summary

The wallet system is a **custodial, SOL-only, off-chain ledger** (`wallets.balance_sol` / `balance_lamports` in Postgres) backed by platform Solana wallets (legacy treasury address, a deposit-vault PDA, and a treasury hot payout key). Users deposit SOL on-chain, get an internal balance, spend it on bandwidth / P2P transfers / escrows, and withdraw back to a linked Solana wallet. A second, double-entry journal (`ledger_journals` / `ledger_journal_lines`, migration `000124`) is dual-written alongside the original single-entry ledger (`wallet_ledger_entries`, made append-only in `000116`/`000137`/`000138`). Marketplace value can alternatively stay on-chain in escrow / session PDAs, but every chain-authoritative gate is **off by default**.

The core ledger discipline is better than average for a codebase of this age: `SELECT … FOR UPDATE` locking is used consistently in the main credit/debit helpers, lamports-integer math was retrofitted under the float API, deposits verify an on-chain balance delta and sender, and compensation/outbox patterns exist for failed refunds and escrow settles. Several previously-found treasury-drain bugs are fixed and commented (BE-CRIT-01/02 in `wallet.go` / `provider_earnings.go`).

**It is still not safe to custody real user funds.** The blocking problems are not exotic cryptography — they are **atomicity gaps between “debit the DB” and “move/record the money”**, plus **identity/cooldown bypasses** and **insecure-by-default feature flags**:

1. **Provider batch payouts can silently destroy already-debited funds** — a constant idempotency key combined with delete-then-process queue claiming (W-01, W-02).
2. **Withdrawals have no durable state machine on the direct path** — debit commits, then an unconfirmed on-chain send happens with no timeout and no persisted intent/tx-hash; the queued path enqueues *after* the debit commits (W-03).
3. **The 24-hour withdrawal cooldown and withdrawal-address binding can be bypassed** by using the parallel `/linked-wallets` API instead of `/wallet/link`, and linking an Ethereum wallet **overwrites** the Solana identity used for deposits/withdrawals (W-04, W-05).
4. **Spending-limit “0” means unlimited in code but “zero allowed” in the security design** — a user (or session hijacker) can set limits to `0` and defeat trust-tier ceilings entirely (W-06).
5. **Deposit crediting trusts fee-payer + balance-delta instead of a verified transfer source**, at `confirmed` (not `finalized`) commitment by default (W-07).
6. **When the SOL price feed is unavailable, usage billing silently charges 0 and marks usage settled** — free bandwidth with the evidence deleted (W-08).
7. **Secure modes are opt-in**: escrow-PDA enforcement, session-PDA enforcement, finalized deposits, vault crediting, multisig settlement, and journal-as-source-of-truth all default off; a misconfigured deploy (e.g. `APP_ENV` unset) silently gets the weakest posture (W-09).

Around those sit 30+ medium/low issues: float64 money at every API boundary, non-idempotent P2P/withdrawal endpoints, TOCTOU on withdrawal destination, Redis metering that can lose billable bytes, reconciliation that does not count the queues where pending money actually lives, an auto-payout that sweeps a provider’s *entire* shared wallet, dead/broken EIP-712 code, unchecked transaction commits, and several 1,000-line files with triplicated wallet-linking logic.

**Bottom line:** keep this on devnet/capped testnet, fix the P0 list in [§13](#13-remediation-roadmap) (estimated 2–4 focused engineer-weeks), re-audit the payout/withdrawal state machines, and only then consider mainnet custody — ideally with the chain-authoritative flags turned on and proven under load.

---

## 2. System Map — What the Wallet System Actually Is

### 2.1 Components in scope

| Layer | Components (primary files) |
|---|---|
| HTTP API (`services/control-api`, Go/Gin/GORM) | `internal/api/wallet.go` (1,109 lines: get wallet, P2P, withdraw, limits, whitelist), `internal/api/crypto.go` (`/wallet/link`, `verifyCryptoDeposit`, admin crypto ops), `internal/api/linked_wallets.go` (parallel `/linked-wallets` CRUD + EVM verification), `internal/api/wallet_identity.go`, `internal/api/escrow*.go`, `internal/api/provider_earnings.go`, `internal/api/admin.go` (`processPayout`), `internal/api/compensation_outbox.go`, `internal/api/staking.go`, `internal/api/referral.go`, `internal/api/milestones.go` |
| Money core | `internal/models/wallet.go`, `wallet_money.go` (float↔lamports), `wallet_tx.go` (`Credit/DebitWalletLocked*`, `TransferP2PLocked`), `ledger_journal.go` (double-entry), `spending_limit.go`, `deposit_limits.go`, `transaction.go` (`PendingTransaction`), `withdrawal_payout.go`, `escrow.go`, `batch_payout.go` |
| Billing / settlement | `internal/billing/worker.go` (hourly Redis→ledger settlement, provider payout triggering, retry worker), `batch_payout.go`, `price.go` (SOL/USD feed), `aggregator.go`, `internal/settlement/intent.go` |
| Workers | `internal/worker/escrow_listener.go` (auto-deposit + escrow events), `withdrawal_payout_worker.go`, `escrow_reconciliation.go`, `escrow_cleaner.go`, anomaly detector, deletion worker |
| Treasury | `internal/treasury/treasury_manager.go` (hot/vault/cold liquidity), `reconciliation.go` (hourly + daily recon), `liquidity_manager.go`, `watchtower.go` |
| Solana client | `internal/solana/client.go` (oracle + hot keys, KMS/file), `verify.go` (deposit verification), `settlement.go` (`SendSOL`, escrow settle), `velocity.go` (outflow guard), `watcher.go` (WS + polling), `deposit_dest.go`, `deposit_vault.go`, `multisig_oracle.go` |
| On-chain | `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` (4,894 lines: escrow, session escrow, deposit vault, multisig oracle, governance…), `programs/session`, `programs/gateway-bond`, `programs/reputation` |
| Database | Postgres (Supabase-flavoured: `auth.users` + `profiles`). Wallet-relevant migrations: `000003*`, `000012`, `000028`–`000034`, `000042`–`000049`, `000080`, `000083`–`000084`, `000102`, `000108`–`000109`, `000114`, `000116`, `000124`, `000131`–`000133`, `000137`–`000139`, `000153`–`000155` |
| Frontend (`apps/web`) | `src/features/wallet/*` (deposit / withdraw / linked-wallets hooks & components), `src/lib/api/wallet.ts`, `src/lib/solana-message-sign.ts`, Solana wallet-adapter providers. Extension (`apps/extension`) does not move money directly. |
| Feature-flag plane | `internal/decentralization/mode.go` — `FULL_DECENTRALIZATION`, `PROXYHUB_REQUIRE_ESCROW_PDA`, `PROXYHUB_REQUIRE_SESSION_PDA`, `PROXYHUB_DEPOSIT_REQUIRE_FINALIZED`, `PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED`, `PROXYHUB_JOURNAL_AS_SOT`, `PROXYHUB_MULTISIG_SETTLE_ENABLED`, etc. |

### 2.2 The five money flows

1. **Deposit (on-chain → custodial).** User sends SOL from their linked wallet to the treasury address or deposit-vault PDA. Credited either (a) synchronously via `POST /v1/wallet/deposit/crypto` → `solana.VerifyTransaction` + `VerifyTransferAmount` (balance delta) + fee-payer == linked wallet check, or (b) asynchronously by the watcher → `handleNativeDeposit`. Dedup via `pending_transactions.reference` unique + ledger `tx_hash` partial-unique. Caps: single (default 10,000 SOL) and rolling-24h (default 50,000 SOL).
2. **Internal spend.** Usage billing (hourly worker debits buyer, credits provider for metered bytes at a SOL/USD-converted price), P2P transfer (`POST /v1/wallet/transfer`, book entry only), marketplace orders/escrows (custodial ledger **or** on-chain PDA depending on flags), staking, subscriptions, passes, referrals/milestones (credits).
3. **Withdrawal (custodial → on-chain).** `POST /v1/wallet/withdraw/sol` debits the internal balance, then either sends SOL immediately from the treasury hot key (`OracleClient.SendSOL`, velocity-guarded) or — if the hot wallet is thin even after a vault→hot top-up — enqueues a `withdrawal_payout_queue` row drained by `StartWithdrawalPayoutWorker`. Failures after debit rely on compensating credits + `compensation_outbox` retries.
4. **Provider payout.** When a provider’s custodial balance crosses 0.05 SOL after a usage settlement, the **entire** wallet balance is debited and queued for batch on-chain payout (`BatchPayoutProcessor`), with immediate-send and retry-queue fallbacks.
5. **Escrow release.** Buyer release / auto-release after challenge window (default 7 days) / jury dispute. With a PDA: oracle submits `settle_escrow` (single-sig by default; multisig path exists behind a flag). Without: custodial credit to the seller (blocked only if `PROXYHUB_REQUIRE_ESCROW_PDA` is on).

### 2.3 Trust boundaries & critical assets

- **Assets:** user custodial balances (DB liabilities), treasury hot key, oracle signing key (can settle escrows), deposit-vault PDA authority, reserve/cold keys, Redis metering counters (pre-ledger revenue), SOL/USD price feed.
- **Boundaries:** browser → control-api (Supabase JWT / API key); control-api → Postgres; control-api → Redis; control-api → Solana RPC (multiple public/private endpoints); control-api → KMS or keypair files; watcher (chain → DB credits, fully trusted input path); price feeds (CoinGecko/CMC → billing math).
- **Single points of trust today:** one oracle key settles escrows by default; one hot key pays all withdrawals/payouts; Postgres balances are authoritative unless `PROXYHUB_JOURNAL_AS_SOT` + `FULL_DECENTRALIZATION` are enabled; the API’s word is final for metered bytes unless usage-proof gating is enabled.

---

## 3. Findings Register (Summary Table)

Severity scale: **Critical** = direct fund loss/theft or insolvency risk exploitable today · **High** = fund loss under plausible preconditions (crash, session compromise, misconfiguration) or systemic control failure · **Medium** = bounded loss, accounting corruption, or defence-in-depth failure · **Low** = hardening / UX / minor correctness. IDs `W-xx` are referenced throughout.

| ID | Sev | Title | Primary location |
|---|---|---|---|
| W-01 | **Critical** | Batch-payout idempotency key is constant per provider (`sessionIDs=nil`) — second payout debited but silently never queued | `billing/worker.go` `queueProviderPayout`, `billing/batch_payout.go` `QueuePayout` |
| W-02 | **Critical** | Batch claiming deletes queue rows before batch records exist — crash/error window permanently loses debited payouts | `billing/batch_payout.go` `ProcessPendingBatches` / `processBatch` |
| W-03 | **High** | Withdrawal has no durable intent/state machine: debit→send and debit→enqueue are non-atomic; send is unconfirmed and untimed-out | `api/wallet.go` `withdrawSOL`, `solana/settlement.go` `sendInstructionAsPayer` |
| W-04 | **High** | 24h withdrawal cooldown + primary-address binding bypassed via `/linked-wallets` path | `api/linked_wallets.go`, `models/wallet.go` `WithdrawalDestination` |
| W-05 | **High** | Ethereum wallet linking overwrites the Solana `wallet_address` used for deposits/withdrawals/payouts | `api/crypto.go` `linkWallet`, `api/linked_wallets.go` `SetPrimaryWallet` |
| W-06 | **High** | Spending limit `0` = unlimited (code) vs “zero allowed” (design) — defeats trust-tier ceilings via `PUT /wallet/limits` | `models/spending_limit.go` `CheckSpendingLimit`, `api/wallet.go` `updateSpendingLimits` |
| W-07 | **High** | Deposit crediting proves fee-payer + recipient balance-delta, not transfer source; `confirmed` commitment by default | `solana/verify.go`, `api/crypto.go` `verifyCryptoDeposit` |
| W-08 | **High** | SOL price unavailable ⇒ usage cost = 0, metering key deleted, usage marked settled (silent free bandwidth) | `billing/price.go` `CostFromBytesUSD`, `billing/worker.go` `settleSession` |
| W-09 | **High** | Secure modes off by default; unknown/typo’d env values silently fall back to weak posture | `decentralization/mode.go` |
| W-10 | **High** | Provider auto-payout sweeps the *entire* shared wallet (buyer funds + earnings) at ≥0.05 SOL without opt-in | `billing/worker.go` `queueProviderPayout` / `triggerProviderPayout` |
| W-11 | Medium | No client idempotency keys on P2P transfer or withdrawal — retries/double-submits double-spend | `api/wallet.go` `transferP2P`, `withdrawSOL` |
| W-12 | Medium | Withdrawal destination/cooldown/whitelist checked on unlocked rows (TOCTOU); not re-derived inside the debit tx | `api/wallet.go` `withdrawSOL` |
| W-13 | Medium | Small withdrawals (≤10 SOL default) need only a JWT — no wallet signature, MFA, or step-up; threshold is DB-configurable | `api/wallet.go` `verifyWithdrawalSignature` |
| W-14 | Medium | Wallet-link signatures never expire (no timestamp/nonce in message; substring “binding” check) — replayable forever | `api/crypto.go` `linkWallet`, `apps/web/.../useWalletLinking.ts` |
| W-15 | Medium | `/linked-wallets` accepts *any* signed message (no user/domain/freshness binding); signatures stored & returned by API | `api/linked_wallets.go` `LinkWallet` |
| W-16 | Medium | Redis usage metering is read-then-delete non-atomically; key deleted inside uncommitted DB tx — billable bytes can vanish | `billing/worker.go` `SettleUsage` / `settleSession` |
| W-17 | Medium | Usage billing is post-paid hourly with no hold: insolvent buyers’ usage retries forever, no bad-debt path | `billing/worker.go` `debitBuyerWallet` |
| W-18 | Medium | Reconciliation doesn’t count the queues where pending money lives; loads all wallets; publishes all balances to NATS | `treasury/reconciliation.go` |
| W-19 | Medium | Dual balance (`balance_sol` float + `balance_lamports`) has three writers (Go, trigger, heuristic) and float round-trips | `models/wallet_money.go`, `wallet_tx.go`, migration `000116` |
| W-20 | Medium | Float64 (`number`) money at every API/TS boundary; withdrawal signature binds amount to only 6 decimals | all `*Request` structs, `solana-message-sign.ts` |
| W-21 | Medium | `GET /wallet` writes (auto-creates user incl. `auth.users` row + wallet), calls Solana RPC synchronously, fakes pagination | `api/wallet.go` `getWallet`, `lib/api/wallet.ts` `getTransactions` |
| W-22 | Medium | Unchecked `tx.Commit()` / `tx.Create()` on money paths — API can report success for uncommitted deposits | `api/crypto.go`, `worker/escrow_listener.go` |
| W-23 | Medium | Unchecked type assertions (`user_id.(uuid.UUID)`) panic on auth-context variation | `api/escrow.go`, `api/linked_wallets.go` |
| W-24 | Medium | Escrow auto-release can strand funds in `releasing`; dispute-vs-release race on `held` status | `api/escrow.go` `AutoReleaseExpiredEscrows` |
| W-25 | Medium | Custodial seller amount falls back to **full** escrow on any lookup error (fail-open overpay) | `api/escrow.go` `usageProportionalSellerAmount` |
| W-26 | Medium | Watcher cursor (`lastSlot`) is memory-only — deposits during downtime are missed; dedup TTL 10 min | `solana/watcher.go` |
| W-27 | Medium | Velocity guard burns hourly budget on failed sends; cap (50 SOL) contradicts API cap (10,000 SOL) | `solana/velocity.go`, `api/wallet.go` |
| W-28 | Medium | Single oracle key settles escrows by default; multisig off; plaintext keypair files permitted | `solana/client.go`, `decentralization/mode.go` |
| W-29 | Medium | Journal dual-write can silently no-op (missing table outside prod) and has no `(ref,type)` uniqueness | `models/ledger_journal.go` `PostBalancedJournal` |
| W-30 | Medium | Admin `processPayout` debits balances without sending money, four-eyes, or durable payout record | `api/admin.go` |
| W-31 | Low | Dead/broken code: EIP-712 verifier (non-standard struct hash + silent fallbacks), fiat stubs, unused helpers | `api/linked_wallets.go`, `api/wallet.go` |
| W-32 | Low | Error & info leakage: raw DB/RPC errors to clients, recipient enumeration via P2P 404, devnet strings hardcoded | `api/crypto.go`, `api/wallet.go` |
| W-33 | Low | Spending-record deletes erase limit history; `RecordSpending` failures “continue” past the limit system | `api/wallet.go`, `billing/worker.go` |
| W-34 | Low | Queue tables lack FKs; GDPR deletion breaks append-only audit; whitelist is near-decorative | migrations `000133`, `worker/deletion_worker.go`, `models/wallet.go` |
| W-35 | Low | Frontend: no double-submit guard in hooks, `parseFloat` money, no queued-withdrawal tracking UI | `apps/web/src/features/wallet/hooks/*` |

Counts: **2 Critical · 8 High · 20 Medium · 5 Low** (grouped findings; several contain multiple sub-issues detailed below).

---

## 4. Critical & High Findings — Detail

### W-01 · CRITICAL — Provider batch payout: constant idempotency key loses debited funds

**Evidence.**

- `billing/worker.go`, `queueProviderPayout()`: locks the provider wallet, sets `payoutAmount = wallet.BalanceSOL`, **debits the full balance** via `DebitWalletLocked`, commits, and only then calls `globalBatchProcessor.QueuePayout(providerID, walletAddress, payoutAmount, nil)` — note the final argument.
- `billing/batch_payout.go`, `QueuePayout(providerID, walletAddress, amountSOL, sessionIDs)`: builds the idempotency key as `sha256(providerID + ":" + walletAddress + ":" + join(sorted(sessionIDs)))`. With `sessionIDs == nil` the key is a **constant per (provider, wallet)** and does not include the amount or any payout nonce.
- Same function: “Skip if already queued or processed for these sessions” — if a `PendingPayout` with that key exists, it logs *“Payout already queued, skipping duplicate”* and **returns `nil` (success)**.

**Exploit / failure scenario (no attacker needed).** Provider crosses the threshold twice while the first payout is still sitting in `pending_payouts` (batch interval not yet elapsed, batch processor down, chain degraded…). The second settlement debits the provider’s (new) full balance, calls `QueuePayout`, gets a cheerful `nil`, logs “queued for batch processing” — and no queue row exists for that money. The SOL is gone from the user’s balance, never sent on-chain, and no retry/outbox row will ever resurrect it. Only a manual ledger-vs-chain reconciliation hunt finds it.

**Impact.** Silent, permanent loss of provider earnings; internal liabilities understate what users are owed; treasury appears to have a “surplus” that is actually stolen-by-bug user funds.

**Fix.** (1) Make debit + enqueue a **single DB transaction** (outbox pattern): insert the `PendingPayout` row inside the same tx as `DebitWalletLocked`. (2) Give every payout a unique reference (the ledger `ref` already generated, e.g. `payout-queue:<provider>:<uuid>`) and use *that* as the idempotency key — never derive it from a nullable session list. (3) `QueuePayout` must return an error (not `nil`) when it declines to enqueue, so callers restore the balance. (4) Add a uniqueness violation⇒restore test (§14).

---

### W-02 · CRITICAL — Batch claiming deletes payouts before any durable batch record exists

**Evidence.** `billing/batch_payout.go`, `ProcessPendingBatches()`: claims rows with `FOR UPDATE SKIP LOCKED` and **deletes them in the same transaction** (“Delete inside the same transaction — rows are gone before any other worker can see them”, P0-02). `processBatch()` *afterwards* creates the `BatchPayout` record and `BatchPayoutItem` rows with separate `db.DB.Create` calls, and only then calls the on-chain `batchFunc`.

**Failure scenarios.** Process crash / OOM / deploy / DB error on batch-or-items create after the claim transaction commits ⇒ the payouts exist nowhere: queue rows deleted, batch rows absent, provider wallets already debited upstream (W-01 flow). The careful P0-03 “persist `submitted` + txHash before marking complete” logic protects the *post-send* window but not this *pre-send* one. The same anti-pattern (delete-as-claim) also destroys the audit trail of what was queued, when, and for which sessions.

**Fix.** Never delete money-queue rows as a claiming mechanism. Use a status state machine on the row itself (`queued → claimed(batch_id, claimed_at, claim_token) → submitted(tx_hash) → completed/failed`), claim with `UPDATE … WHERE status='queued' … SKIP LOCKED RETURNING …`, create batch+items **in the claim transaction**, and add a reaper that returns stale `claimed` rows (no tx hash, claim older than N minutes) to `queued`. Delete only via archival policy long after completion.

---

### W-03 · HIGH — Withdrawals: non-atomic debit→pay, no durable intent, unconfirmed & untimed-out sends

**Evidence** (`api/wallet.go`, `withdrawSOL`):

1. Balance is debited in a DB transaction and committed.
2. **Direct path:** `sendSOLOnChainHook(ctx, …)` is called with `ctx := context.Background()` — no deadline, client disconnect does not cancel, a hung RPC hangs the HTTP handler/goroutine indefinitely.
3. `solana/settlement.go`, `sendInstructionAsPayer()`: builds, signs, `SendTransaction`, returns the signature. **No confirmation polling** (contrast `batch_payout.go` `waitForTxFinality`). A transaction that is broadcast but then dropped (blockhash expiry, fee/leader issues) is reported to the user as `"status":"success"` with a Solscan link to a tx that may never land — while their balance stays debited.
4. On success, the `tx_hash` is **not persisted** against the ledger debit (the `DebitWalletLocked` entry has no `TxHash`; the hash lives only in the HTTP response and a log line). A crash between broadcast and response leaves *no* durable record linking the debit to the on-chain transfer.
5. **Queued path:** when the hot wallet is thin, the code debits and commits first, *then* `db.DB.Create(&queued)` outside any transaction shared with the debit. A crash in between = debited, never queued, never auto-refunded. (The handled-error path does refund; the crash path cannot.)
6. The compensating-refund design itself is sound but entirely reactive: every failure mode depends on the same process surviving long enough to run compensation or enqueue to `compensation_outbox`.

**Impact.** Lost or duplicated-ambiguous withdrawals under crashes/deploys/RPC faults; support cannot prove from DB state alone whether a given debit was paid on-chain; users told “success” for transfers that never confirm.

**Fix.** Introduce a single withdrawal state machine used by *both* paths: in **one** transaction — lock wallet, check limits/destination, insert `withdrawal_payout_queue(status=requested, reference, destination, amount_lamports)`, debit wallet, insert ledger entry *with the reference* — then let the existing worker (or an inline fast-path that first claims the row `requested→paying`) perform the send with a bounded context, persist `tx_hash` + `submitted` **before** awaiting confirmation, poll to `confirmed/finalized`, then mark `completed`. On definite failure, refund *from the state machine* (idempotent on `reference`). The worker half of this (`withdrawal_payout_worker.go`) already exists — extend it to own 100% of withdrawals and delete the inline send.

---

### W-04 · HIGH — Withdrawal cooldown / address-binding bypass via the parallel `/linked-wallets` API

**Evidence.** There are two independent wallet-linking systems:

- `POST /v1/wallet/link` (`api/crypto.go`, `linkWallet`) — verifies a signature and maintains `wallets.primary_withdrawal_address`, `withdrawal_address_changed_at` (the 24 h cooldown anchor) and the whitelist.
- `POST /v1/linked-wallets` + `PUT /v1/linked-wallets/:id/primary` (`api/linked_wallets.go`) — verifies a signature (see W-15) and updates `linked_wallets` + `profiles.wallet_address`, but **never touches** `primary_withdrawal_address` / `withdrawal_address_changed_at` / whitelist.

`models.Wallet.WithdrawalDestination()` falls back to the linked address when no primary is set, and `withdrawSOL` only enforces the cooldown `if PrimaryWithdrawalAddress != nil && WithdrawalAddressChangedAt != nil && … < 24h`.

**Attack (session/JWT compromise — precisely the threat a cooldown exists for).** Attacker with a stolen session: (1) `POST /linked-wallets` with *their own* Solana wallet + valid self-signature; (2) `PUT /linked-wallets/:id/primary` (no signature required) — profile `wallet_address` now points at the attacker; (3) immediately `POST /wallet/withdraw/sol` — no primary/cooldown state exists for this path, destination resolves to the attacker’s wallet, funds leave. The 24 h cooling-off, whitelist, and “destination must match linked wallet” controls all pass vacuously. `SetPrimaryWallet`/`UnlinkWallet` additionally ignore DB errors (`db.DB.Save(&wallet)` unchecked), so partial updates are silent.

**Fix.** One linking service, one code path: route both APIs through `ensurePrimaryLinkedSolana` **plus** the withdrawal-routing maintenance from `crypto.go` (set primary + `changed_at=now` + whitelist handling on *every* primary change, regardless of entry point). Cooldown must be anchored on *any* change of effective withdrawal destination, computed from the destination actually used — fail closed (treat “no cooldown anchor but destination changed” as cooling down). Require a fresh wallet signature for primary changes. Deprecate one of the two endpoint families.

---

### W-05 · HIGH — Ethereum linking overwrites the Solana withdrawal/deposit identity

**Evidence.** `api/crypto.go` `linkWallet`, Ethereum branch: `user.WalletAddress = &req.WalletAddress` then `setProfileWalletAddress(...)` — the single `profiles.wallet_address` column is overwritten with a `0x…` address. `api/linked_wallets.go` `SetPrimaryWallet` does the same for any chain. That column is the identity used by: deposit sender verification (`verifyCryptoDeposit`), withdrawal destination (`withdrawSOL` → `WithdrawalDestination`), auto-deposit user resolution fallback (`escrow_listener.go`), and provider payout fallback (`resolveProviderWallet`, which returns the profile address without Solana validation).

**Impact.** After linking (or primary-ing) an Ethereum wallet: SOL deposits from the user’s real Solana wallet are rejected as “sender mismatch” (funds already sent on-chain are stranded until manual `ops.RecreditDeposits`), SOL withdrawals fail address parsing *after* security checks, and provider payouts resolve to an unpayable address — in `triggerProviderPayout` the wallet is debited first and the doomed send cycles through the retry queue to `failed_permanent`. At best a self-DoS footgun in the UI; at worst, combined with W-04, identity confusion across chains.

**Fix.** Split identities by chain (`wallet_address` ⇒ `solana_wallet_address` + `evm_wallet_address`, or always resolve via `linked_wallets(chain, is_primary, verified)`), reject non-Solana addresses anywhere a Solana pubkey is required *before* debiting, and make `SetPrimaryWallet` update only the column for its own chain. Since the product is SOL-only for money movement, consider removing EVM linking from fund-adjacent surfaces entirely.

---

### W-06 · HIGH — Spending-limit semantics inverted: `0` silently means “unlimited”, defeating trust-tier ceilings

**Evidence.**

- Design intent is documented twice: `models/wallet.go` (“When true, DailyLimit/WeeklyLimit/MonthlyLimit of 0 mean ‘zero allowed’ (not ‘unlimited’)”, P2-17) and `models/spending_limit.go` `CheckSpendingLimit` repeats it.
- Implementation contradicts it: every window is guarded by `if w.DailyLimit > 0 { … }` (same for weekly/monthly). A stored limit of exactly `0` **skips the check entirely**.
- `api/wallet.go` `updateSpendingLimits` only rejects values *above* the trust-tier maximum (`*req.Daily > maxLimits.Daily`). Setting `{"daily":0,"weekly":0,"monthly":0}` is accepted (DB checks from `000032` only require `>= 0`) and yields **unlimited** spending — above the tier ceiling the endpoint exists to enforce (new-user tier: 10/50/100 SOL). Negative values pass the handler too and only fail later at the DB check constraint as an opaque 500.
- Several wallet-creation paths create bare wallets without `InitializeWithDefaultLimits` (e.g. `escrow_listener.go` auto-deposit `Wallet{UserID: userID}`, `billing/worker.go` provider `FirstOrCreate(Wallet{UserID: providerID})`), leaving limits at DB/Go zero-values whose enforcement then depends on this same inverted logic and on whether GORM applies the `default:true` tag for `limits_enabled`.

**Impact.** The headline “spending limits protect compromised accounts” control can be switched off by the very session it is meant to constrain (no signature/step-up/cooldown on limit raises either — raising to tier max is instant; setting 0 removes the cap). Limits are currently a self-control convenience, not a security boundary, despite being presented as one (“Spending Limits (Security Feature)”).

**Fix.** Pick one semantics and enforce it in depth: recommended — `0` = **block all** when `limits_enabled` (as designed), implemented as `if spent+amount > limit` without the `>0` guard, *plus* handler validation (`0 < value ≤ tierMax`, reject ≤0 with 400), *plus* server-side tier ceilings re-checked at spend time (never trust stored values above tier max), *plus* a step-up (fresh wallet signature) and 24 h delay for limit *raises*/disables. Backfill/normalise existing zero-limit wallets explicitly and add tests for the `0` case (`spending_limit_test.go` currently covers within/exceeds/window-reset but not zero-semantics).

---

### W-07 · HIGH — Deposit verification proves the wrong thing (fee payer + balance delta), at weak commitment

**Evidence** (`solana/verify.go` + `api/crypto.go` `verifyCryptoDeposit`):

- `VerifyTransferAmount` computes `postBalances[i] − preBalances[i]` for the treasury/vault account index. It never inspects the instruction set: it does not prove a System-Program transfer **from** the claimed sender, for the credited amount, in this transaction.
- `GetTransactionSender` returns `AccountKeys[0]` — the **fee payer**. The handler then requires `feePayer == linkedWallet`. Fee payer ≠ funder in general Solana transactions (relayed/batched/CPI flows, anyone-can-pay-fee constructions, transactions where the treasury balance rises for reasons other than the fee payer’s transfer — rent reclaim, account closure, a third instruction in the same tx).
- Versioned (v0) transactions with address-lookup-tables expose loaded addresses outside `message.accountKeys` in `json` encoding; index-based `pre/postBalances` correlation against the truncated key list can mis-identify the recipient index or miss the recipient entirely.
- Commitment defaults to `confirmed`; `finalized` applies only when `PROXYHUB_DEPOSIT_REQUIRE_FINALIZED` is set or `APP_ENV ∈ {production,prod,staging}` (`decentralization.DepositRequireFinalized`). Crediting spendable balance on `confirmed` accepts rollback risk on a hostile/unstable cluster view, with 12 × 1.5 s RPC retries across possibly-public endpoints (a lying/compromised RPC that returns a fabricated `getTransaction` result is trusted wholesale — no cross-check of slot/blockhash continuity, no second-source quorum).
- If one transaction credits **both** vault and treasury, only the first matching candidate is credited (loop `break`s, single `PendingTransaction` per signature) — the remainder is silently stranded on-chain.
- The auto-deposit watcher path repeats the pattern more weakly: user resolution queries `linked_wallets` by **address only** (no `chain='solana'`, no `verified=true` filter), amount round-trips `uint64 → float64 SOL → lamports`, and the `PendingTransaction` insert result is ignored (W-22).

**Impact.** Mis-attributed or reversible deposits credit spendable custodial balance; attribution breaks precisely for the composed/relayed transactions a power user or attacker would craft; RPC trust is single-source.

**Fix.** Parse and verify the actual transfer: locate System-Program `Transfer` instructions (including inner instructions) where `source == linkedWallet && destination ∈ {treasury, vault}`, sum those lamports as integers (`uint64` end-to-end, no float), require `meta.err == nil`, require **`finalized`** for crediting (accept `confirmed` only into a *pending/non-spendable* state promoted later by the watcher/reconciler), handle v0/ALT accounts via `jsonParsed` or the solana-go typed decoder, credit *each* destination leg under one signature with per-leg references, and cross-check the tx against two independent RPC endpoints before crediting above a threshold.

---

### W-08 · HIGH — Price-feed outage silently makes bandwidth free and destroys the billing evidence

**Evidence.**

- `billing/price.go`: `hardcodedLastResort = 0.0` (stale $150 fallback deliberately removed, P0-20). `GetSOLPriceUSD()` returns `0` when live feeds, Redis last-known-good, and `EMERGENCY_SOL_PRICE_USD` are all unavailable/rejected.
- `CostFromBytesUSD`: `if solPrice <= 0 { return 0, costUSD, 0 }` — zero lamports.
- `billing/worker.go`: `debitBuyerWallet` returns the wallet ID with no debit when `costLamports <= 0`; `creditProviderWallet` likewise no-ops; `PostUsageJournal` no-ops on zero debit; then `settleSession` **deletes the Redis metering key**, marks usage receipts/manifests *settled*, marks the provider earning *paid*, and records a circuit-breaker *success*.

**Impact.** Any price-feed outage (or a >30% genuine SOL crash tripping the sanity deviation guard into repeated rejection) converts directly into unbillable, unrecoverable revenue loss — worse, the metering evidence is deleted and downstream artifacts claim settlement happened, so it cannot even be re-billed later. The failure is silent in user/provider balances (both see “nothing happened”).

**Fix.** Zero/unavailable price must be a **retryable settlement failure**, never a zero charge: abort the settle tx, keep the Redis key (or move bytes to a durable `unbilled_usage` table — see W-16), trip the circuit breaker, and alert. Price at *consumption* time (or snapshot price + timestamp onto the usage receipt when bytes are metered) so settlement never needs a live feed. Add a dead-letter path for usage that cannot be priced within N days, with manual ops pricing — anything except delete-and-forget.

---

### W-09 · HIGH — Secure-by-opt-in: every chain-authoritative control defaults off, typos fail open

**Evidence** (`decentralization/mode.go`): `RequireEscrowPDAEnabled` (default false), `RequireSessionPDAEnabled` (false), `DepositVaultCreditEnabled` (false), `RequireUsageProofBeforeSettle` (false), `MultisigSettleEnabled` (false), `JournalAsSoTEnabled` (false unless `FULL_DECENTRALIZATION`), `DepositRequireFinalized` (false unless prod/staging `APP_ENV`). The shared `envTruthy` helper returns the *default* for any unrecognised value — `PROXYHUB_REQUIRE_ESCROW_PDA=ture` in a compose file silently means “off”, with no startup log of effective security posture and no fail-fast on invalid values. Nothing at boot asserts “this process believes it is production, therefore X/Y/Z must be on”. (See §8 of `docker-compose*` sprawl: 20+ compose overlays make flag drift between environments likely.)

**Impact.** The system’s security story (“escrow PDAs required, finalized deposits, journal is source of truth”) is true only in environments someone remembered to flag. A fresh/mainnet deploy with a missed variable custodies funds with custodial settle paths, confirmed-commitment deposits, single-sig oracle settlement, and DB balances as truth — while docs/UI may claim otherwise.

**Fix.** Invert the defaults for anything money-authoritative and add a **startup posture gate**: when `APP_ENV=production` (or network=mainnet), refuse to boot (or refuse to enable deposit/withdraw/settle routes) unless the required flags are explicitly set; validate every security env var against an allowlist and crash on unknown values; log + expose (`/system/config/public` already has honesty metas — extend) the effective posture; pin a checked-in production env profile under test (§14).

---

### W-10 · HIGH — Provider auto-payout sweeps the provider’s entire wallet, including buyer funds

**Evidence.** `billing/worker.go`: `creditProviderWallet` signals payout when `providerWallet.BalanceSOL >= 0.05`; after commit, `queueProviderPayout` (and fallback `triggerProviderPayout`) set `payoutAmount = wallet.BalanceSOL` — the **whole** custodial balance. Buyer deposits and provider earnings share the single `wallets` row; there is no earnings sub-balance, holdback, user opt-in, schedule, or minimum-retained-balance. A user who is both buyer and provider and just deposited 5 SOL to buy bandwidth can have it swept on-chain to themselves (minus fees/velocity limits, plus tax/reporting confusion) because a 0.06 SOL earning landed — and if W-01/W-02 bite, swept *buyer* funds are lost by the payout bug too. Concurrent buyer spending races the sweep (both lock correctly, but the user-visible result is “my balance vanished into a payout I didn’t request”).

**Fix.** Track payable earnings separately from spendable balance (sub-ledger account per wallet — the journal’s account model can express this: e.g. `2100` spendable vs `2110` payable), pay out only the payable balance, make auto-payout opt-in with a user-set threshold/cadence (default manual “claim”), and never auto-sweep below a user-visible retained minimum.

---

## 5. Medium Findings — Detail

### W-11 · No idempotency keys on P2P transfer / withdrawal

`transferP2P` and `withdrawSOL` accept no `Idempotency-Key`; each generates a fresh server UUID per call (`wallet.go`). A client timeout, mobile retry, or double-click after the server committed but before the response arrived executes the transfer/withdrawal **twice** (P2P is irreversible by design; withdrawal debits twice and pays twice). The admin `processPayout` and pass-purchase handlers already implement client keys — money-moving user endpoints should too: require/accept `Idempotency-Key`, store `(user_id, key) → result` with a unique constraint, replay the stored result on retry. The 5/min rate limit is not a substitute.

### W-12 · Withdrawal TOCTOU: security checks on unlocked rows

`withdrawSOL` loads `users.wallet_address` and `wallets` *without* locks, derives `destAddress`, checks whitelist/cooldown/flags and (for large amounts) the wallet signature against that destination — then, inside the debit transaction, re-locks the wallet but **never re-derives or re-checks the destination**. A concurrent link/primary/whitelist change between check and debit sends funds to the previously-computed destination under stale security state. Fix: perform destination derivation + all checks **inside** the `FOR UPDATE` transaction on the locked rows (signature verification can stay outside, but re-verify `dest == signed-for-address` inside).

### W-13 · Session-only authorisation for withdrawals ≤ threshold

Below `large_withdraw_threshold_sol` (default 10 SOL, read from `system_configurations`), `withdrawSOL` requires only the Supabase JWT — no wallet signature, no MFA/step-up, no email confirmation. Combined with W-04/W-06, a hijacked session can re-point identity and drain up to spending-limit ceilings in ≤10 SOL chunks at 5 req/min. The threshold itself is mutable DB config with no audit requirement visible at the handler. **Sub-issues in the signature scheme** (`verifyWalletSignedMessage`): the Redis nonce is burned (`SetNX`) *before* signature verification (failed attempts consume the nonce; Redis outage fails all large withdrawals closed — correct but brittle); nonce parsing via `fmt.Sscanf("%d")` accepts trailing garbage; clock-skew window is ±5 min with second-granularity nonces (two legitimate large withdrawals in the same second collide). Fix: require wallet signature (or WebAuthn step-up) for *all* withdrawals above a small dust threshold, bind the signature to lamports + destination + user ID (see W-20), verify signature *before* burning the nonce (or burn on success with a short lock), and use random 128-bit nonces issued by the server (challenge-response like wallet login already does well).

### W-14 · Wallet-link signatures never expire

`POST /wallet/link` requires the signed message to merely *contain* the user ID and address as substrings (`strings.Contains`). The frontend message (`useWalletLinking.ts`) is `Link Wallet <addr> to ProxyHubb User <uid>` — no timestamp, nonce, domain, or expiry. A signature captured once (logs, analytics, phishing “sign to prove ownership” elsewhere with a crafted containing-message) is replayable forever to (re)link that wallet, resetting `withdrawal_address_changed_at`/primary state each time. `GenerateLinkingMessage` (with timestamp) exists in `linked_wallets.go` but is **dead code** — nothing calls it, and nothing validates timestamps anyway. Fix: server-issued single-use challenges (reuse the wallet-login challenge store: random nonce, 5-min TTL, consumed atomically), structured message (domain + user + address + nonce + expiry), exact-match validation — delete substring checks.

### W-15 · `/linked-wallets` verifies *a* signature over *any* message

`LinkWallet` accepts caller-supplied `message` + `signature` with **no required content at all** — any historical signature by that key over any string proves “ownership” forever (e.g. a signature the victim made for an unrelated dApp, if obtained). First-link wins the address (`already linked to another account` only protects already-linked wallets). The handler also: returns raw verification errors (`Verification error: %v`), uses unchecked `userID.(uuid.UUID)` assertions, race-prone “count==0 ⇒ primary” without a transaction, ignores errors on the legacy-profile update, and **stores** `verification_signature`/`verification_message` and returns full `LinkedWallet` rows (including those fields) from `ListLinkedWallets` — handing any future session-compromise a ready-made replay kit. Fix: same challenge flow as W-14 for every link path; never return signature material in APIs; wrap link+primary+profile updates in one transaction with proper error propagation.

### W-16 · Redis metering can lose billable bytes (non-atomic read/delete, delete-before-commit)

`SettleUsage` does `GET billing:session:*:pending` **before** acquiring the per-session settle lock, passes the possibly-stale `totalBytes` into `settleSession`, which deletes the Redis key **inside** the DB transaction (before commit). Consequences: (a) bytes `INCRBY`’d between GET and DEL are erased without billing; (b) DB rollback after DEL loses the bytes permanently; (c) two pods can read the same value and rely solely on a 2-minute Redis `SetNX` lock with **no owner token** — `releaseSettleLock` unconditionally `DEL`s, so a slow settler whose lock expired deletes the *next* owner’s lock. Fix: atomic `GETDEL` (or Lua `GET+DECRBY/-DEL`) *after* acquiring the lock, write the claimed bytes to a durable `usage_claims` row in the same DB tx as the debit (Redis becomes a cache, not the ledger), owner-tokened locks with compare-and-delete release, and re-queue the claim on tx failure.

### W-17 · Post-paid billing with no hold, no dunning, no bad-debt accounting

Custodial usage is consumed first and settled hourly. If the buyer cannot pay, `debitBuyerWallet` errors, the Redis key survives, and the same (growing) debt retries every hour forever; the circuit breaker counts these *business* failures toward tripping settlement for **everyone** (3 failures/60 s ⇒ 5-min global pause), and any single success resets the failure window. There is no pre-authorisation/hold for custodial sessions (session-intent/PDA paths mitigate only when enabled), no negative-balance/debt ledger (DB check forbids negative balances), no session cut-off tied to settlement failure in this worker, and no write-off policy. Fix: holds/reservations at session start decremented by metering (or enforce session-PDA funding), per-session failure classification (insufficient-funds must not trip the RPC circuit breaker), debt sub-ledger + dunning/cut-off, and alerting on ageing unbilled usage.

### W-18 · Reconciliation miscounts liabilities and leaks all balances

`treasury/reconciliation.go`: `calculateInternalLiabilities` (a) `Find`s **every** wallet into memory and sums `float64 BalanceSOL`; (b) adds “pending outgoing” from `pending_transactions WHERE type IN ('withdrawal','payout','batch_payout')` — but nothing writes those types anymore (writes are `crypto_deposit`); real in-flight money sits in `withdrawal_payout_queue`, `payout_retry_queue`, `pending_payouts`, `batch_payouts(submitted)`, `compensation_outbox`, held escrows and Redis metering — **none counted**; (c) backing = treasury hot + vault only (escrow PDA balances, in-flight top-ups ignored); so `DEFICIT`/`SURPLUS` signals are systematically wrong in exactly the incident conditions they exist for. The full per-user balance list is published to NATS (`proxy.treasury.v1.reconciliation`) — unnecessary financial-PII broadcast. Hourly `ReconcileUserWallets`/`ReconcileJournals` full-table `GROUP BY` scans will degrade with ledger growth, per-wallet journal drift currently *pages Critical* for expected historical dual-write gaps (alert fatigue; suppressible via env, which then suppresses real drift too), and a detected deficit only alerts — withdrawals/payouts continue (no automatic freeze via the existing `VelocityGuard.Freeze`/watchtower). Fix: SQL-side lamports sums (`SUM(balance_lamports)`), a liabilities query that unions every queue/hold table by status, escrow-PDA backing via RPC sampling, publish aggregates only, incremental/watermarked recon, and wire sustained deficit ⇒ automatic payout freeze + page.

### W-19 · Dual-balance model: three writers, float round-trips, resurrecting heuristic

`wallets` carries `balance_sol NUMERIC(20,9)` (surfaced as Go `float64`) **and** `balance_lamports BIGINT`. Writers: Go helpers derive SOL from lamports via `float64` division; the `000116` trigger re-derives lamports from `balance_sol` on every `UPDATE OF balance_sol`; `TransferP2PLocked` recomputes lamports from the float SOL value, discarding lamports precision; ledger trigger fills lamports from float amounts when zero. `EffectiveBalanceLamports()` arbitrates mismatches with a heuristic — including “if lamports==0 use SOL-derived”, which **resurrects a drained wallet** whose lamports correctly reached 0 while a stale float `balance_sol` survives (and vice versa masks drift the recon then “discovers” hourly). `NUMERIC(20,9)`→`float64` also caps exact integer lamports at 2^53 (≈9.0M SOL — not near-term, but the float path is used for fees/limits long before that). Fix: make lamports the *only* stored balance (drop/derive `balance_sol` as a generated/display value, remove the sync trigger and heuristic), convert all internal APIs to `int64` lamports (the `*Lamports` helpers already exist — finish the migration, delete float credit/debit overloads), and keep floats only at the JSON edge during a deprecation window.

### W-20 · Float money at the edges; signatures bind truncated amounts

Every request DTO uses `float64 amount` (`withdrawSOLRequest`, `p2pTransferRequest`, `cryptoDepositRequest`, admin payout…), frontend uses `parseFloat`/`number`, and the large-withdrawal signature message formats the amount with `%.6f` / `toFixed(6)` — a signature therefore authorises a *range* of lamports amounts (±500 lamports), not an exact debit, and JS `number` cannot represent lamports exactly for large values. Gin binding (`gt=0,lte=10000`) operates on the float before lamports conversion, so dust amounts can round to 0 lamports and trip the “must be positive” lamports guards as confusing 400/500s. Fix: accept amounts as decimal strings or integer lamports (`amount_lamports`) in APIs, parse with `big`/decimal, sign exact lamports + destination + reference, render SOL only for display.

### W-21 · `GET /wallet` is a write + RPC fan-out disguised as a read

`getWallet` auto-creates the `profiles` row (deriving username from email, taking `Role` from context), inserts an `auth.users` parent row, and creates the wallet — all on `GET`, with error paths that proceed after logging failures. It then runs ledger + pending-tx queries, merges/dedups in memory (`ledgerMap` keyed by `ReferenceID`, where empty references collide and suppress each other), and performs a **synchronous Solana RPC `GetBalance`** using the request context with no handler-level timeout/cache — RPC degradation directly degrades wallet page loads and ties up handlers. Frontend `getTransactions()` re-fetches the whole wallet and slices client-side, reporting `total = page length`. Fix: provision users/wallets at signup (idempotent upsert keyed by auth ID, tested under concurrency — keep the existing lock pattern there), make `GET` side-effect-free (404 + explicit `POST /wallet/init` if provisioning is ever missed), cache on-chain balance briefly (or fetch client-side via the existing `useSolanaBalances`), and paginate transactions server-side with a cursor.

### W-22 · Unchecked commits/creates on money paths

- `api/crypto.go` `verifyCryptoDeposit`: final `tx.Commit()` result ignored — commit failure still returns `200 {status:success, new_balance:…}` for a deposit that was not persisted. `linkWallet` ignores both `tx.Commit()` results similarly.
- `worker/escrow_listener.go` `handleNativeDeposit`: `tx.Create(&wallet)` and `tx.Create(&pendingTx)` results ignored (on Postgres a unique-violation aborts the tx and commit then fails — *probably* safe today, silently dependent on engine semantics, and the error is never logged with context).
- `api/linked_wallets.go`: `Save`/`Update` results ignored in primary/unlink flows; `billing/batch_payout.go` `processImmediate`/`processBatch` ignore several `Save` errors after on-chain sends (partially mitigated by `saveBatchWithRetry` for the batch header only).
Fix: check and propagate every write result on fund paths; prefer `db.Transaction(func(tx) error)` (already used well in `withdrawSOL`/billing) so commit errors cannot be dropped; add a lint rule (e.g. `errcheck` with GORM return types) to CI.

### W-23 · Panicking auth-context assertions

Escrow and linked-wallet handlers do `currentUserID.(uuid.UUID)` / `userID.(uuid.UUID)` unchecked (vs the safe `GetUserID(c)` helper used in wallet handlers). Any route mounted behind a different auth flavour (optional-auth group, API-key auth, extension-device restriction ordering — see the many groups in `main.go`) panics per-request (recovered only where a `recoverHandlerPanic` defer exists; escrow handlers lack it, so Gin recovery yields bare 500s and log spam — a cheap DoS/error-oracle). Fix: use `GetUserID` everywhere; add a grep gate for `.(uuid.UUID)` in handlers.

### W-24 · Escrow auto-release stranding + dispute race

`AutoReleaseExpiredEscrows` claims `held → releasing`, settles on-chain, then finalises in DB; if finalisation fails *after* a PDA settle, the escrow is deliberately left in `releasing` “for ops/reconcile” — but the claim query only ever selects `held`, so `releasing` rows are never re-driven automatically (funds settled on-chain, order never completes, seller/buyer stuck until manual SQL). Symmetrically, dispute creation requires `escrow.Status == held`, while auto-release checks dispute state *after* claiming `releasing` on a separately-read order — a buyer disputing during the claim window is rejected (“escrow not held”) and the release can still proceed if its block-reason read raced ahead of the dispute commit. Fix: reaper for stale `releasing` (verify on-chain escrow state, then finalise or revert), dispute creation allowed from `releasing` with precedence over release (conditional update `… WHERE status IN (held, releasing)` + auto-release re-check inside its finalise tx under row lock).

### W-25 · Fail-open custodial escrow maths

`usageProportionalSellerAmount` returns the **full** escrow amount on order-lookup failure, missing session, or non-positive bandwidth (“so as not to under-pay”) — i.e. data corruption pays out 100%. Arithmetic is float (`BandwidthGB * 1024³`, ratios), and the 10% platform-fee constant exists but is disabled by `escrowOnChainSkimsPlatformFee=false`, an easy flag to misalign with a future program upgrade (DB would skim or not opposite to chain). Fix: fail closed (pay 0 + park for ops review) on missing usage data for custodial releases, integer lamports maths mirroring the program’s formula with shared test vectors, and derive fee behaviour from the on-chain/program version actually used, recorded per-order at funding time.

### W-26 · Watcher forgets downtime; weak deposit dedup ageing

`solana/watcher.go` keeps `lastSlot` only in memory and initialises it to the current slot at startup: deposits landing while control-api is down/restarting are **not** backfilled (users must know to use manual verify; ops must run recredit). WS `LogsSubscribe` failure logs and gives up that goroutine (polling covers, at poll latency). Event dedup is Redis `SetNX` with a 10-minute TTL — redelivery after TTL relies on the DB unique checks discussed in W-22. `handleEscrowInitialized` blocks its handler goroutine sleeping up to 60 s in retries. Fix: persist the watcher cursor (slot + last signature per watched address) in Postgres/Redis, backfill `GetSignaturesForAddress` from cursor on boot, make dedup durable (the `pending_transactions` insert — *checked* — inside the credit tx is the dedup), and move retries to the reconciliation/outbox tables instead of sleeping in the event handler.

### W-27 · Velocity guard accounting burns budget on failure; caps contradict APIs

`VelocityGuard.Check` atomically *increments* the hourly counter before the send; failed/rejected downstream sends never decrement it, so RPC outages exhaust the 500 SOL/hour budget with phantom outflows and then block real payouts (which, in `withdrawSOL`, have already debited users and now churn through refunds). `RecordOutflow` exists for post-hoc recording and would double-count anything that also passed `Check` if both are used (withdrawal worker separately calls treasury `RecordOutgoingTransfer` — three overlapping outflow ledgers to keep consistent). Defaults also contradict product caps: guard single-transfer max 50 SOL vs API allowing 10,000 SOL withdrawals/transfers and 10,000 SOL single deposits — large legitimate withdrawals are guaranteed velocity rejections discovered only after debit. Fix: reserve-then-settle accounting (increment on broadcast-success, release on definite failure, expire reservations), one outflow ledger, and align API/guard/treasury caps from a single config source validated at boot.

### W-28 · Centralised signing trust by default; plaintext key files allowed

By default a single oracle key authorises `settle_escrow`/`settle_session_escrow` (the program’s multisig oracle — up to 5 signers, replay nonces — is only used when `PROXYHUB_MULTISIG_SETTLE_ENABLED` and the 0.1 SOL threshold route it there). `loadKeypair` happily loads **plaintext** JSON keypairs when `ORACLE_KEYPAIR_ENCRYPTION_KEY` is unset (KMS/HSM paths exist and BC-08 separation of oracle vs hot keys is enforced in staging/prod — good — but file permissions/ownership are not checked, `MockHSMSigner` fallbacks exist, and `SendSOLFrom` explicitly bypasses the velocity guard for “internal” moves, trusting every present/future caller). Compromise of the control-api host therefore equals compromise of escrow settlement + hot payouts up to velocity caps. Fix: multisig settle by default above dust (threshold at/near 0 for prod), KMS-only signing in prod (refuse plaintext key files when `APP_ENV=production`), permission checks (0600/owner) where files are allowed, velocity/reserve accounting on *all* platform-key sends with per-purpose sub-limits, and documented key rotation/runbooks with the freeze key tested.

### W-29 · Double-entry journal can silently diverge from the wallet ledger

`PostBalancedJournal` runs an `information_schema` existence query on **every** post (cost, W-§8) and *soft-skips* posting entirely when the table is missing outside staging/production — by design for tests, but it means pre-migration or wrong-schema deploys silently run single-entry while recon expects dual-write. There is no unique constraint on `(external_ref, entry_type)`: a caller retrying a whole money operation after an ambiguous commit can double-post journals even where the wallet ledger is protected (references are free-form strings — session UUIDs, reused withdrawal refs across debit/refund legs with different entry types, `JournalKind:"skip"` sites governed by a test allowlist rather than types). `PostUsageJournal` “absorbs residual into platform revenue” to force balance — masking upstream maths bugs as revenue. The DB deferred-balance trigger (`000131`) checks balance *per journal at commit* but cannot detect missing/duplicate journals. Fix: schema check once at boot (fail fast in every env that serves money routes), `UNIQUE(external_ref, entry_type)` (with namespaced refs per leg), typed journal intents instead of stringly `skip`, residual ⇒ error (never plug to revenue), and finish the `JOURNAL_AS_SOT` cutover so one system is authoritative instead of two drifting mirrors (see W-19).

### W-30 · Admin payout debits without paying

`POST` admin `processPayout` (`api/admin.go`) debits any provider’s custodial balance “for a manual admin payout” — but sends nothing on-chain, creates no payout-queue/batch record, takes a legacy `phone` field, auto-generates a fresh reference when the client omits the idempotency key (retries double-debit), and requires no second approver, amount cap beyond float binding, or reason code. Its response (`"status":"processed"`) asserts a payout that did not occur; reconciliation will count the vanished liability as treasury surplus. Any admin-key/JWT compromise (or malicious insider) can zero provider balances with only ledger text as evidence. Fix: route admin payouts through the same state machine as W-03 (durable payout row + on-chain send + confirmation), require client idempotency keys, four-eyes approval above a threshold, structured reason + audit-log entry (the `audit` package exists), and rename the response to reflect reality until then — or disable the endpoint.

---

## 6. Low Findings & Hardening Gaps

### W-31 · Dead and broken code that looks like security controls

- `verifyEIP712Signature` (`linked_wallets.go`) is never called, and is wrong anyway: `structHash = keccak256(JSON(message))` is not EIP-712 hashing (no type hashes/ABI encoding); every failure path falls back to `personal_sign` verification, so even if wired it would accept weaker proofs silently. `GenerateLinkingMessage`/`GenerateTransactionMessage` are likewise unused. Dead crypto code invites future copy-paste trust — delete or implement properly with test vectors.
- Fiat-era stubs remain routed/documented: `initiateDeposit`, `verifyDeposit`, `initiateWithdrawal`, `depositRequest{Email}`, `withdrawRequest`, `PendingTransaction.Phone`, frontend `WithdrawRequest{phone,network}`, Paystack-era comments. They fail closed (good) but confuse reviewers and API consumers about the real surface.
- `refundWalletSOL` (`wallet.go`) has no callers and, if revived, is non-idempotent (fresh UUID ref per call — retries double-refund). `TransactionSwap` constant, `computeSessionCost` wrapper, duplicate `globalBatchProcessor` registries (`billing` package vs `api/provider_earnings.go` interface that nothing uses to move money) all add audit noise.
- `getTreasuryAddress` hardcodes `"network":"devnet"` in its response regardless of configuration — clients/ops can be misled about which cluster funds are on.

### W-32 · Information leakage & error handling

Raw internal errors reach clients on money routes (`"Transaction already processed: " + err.Error()`, `"Failed to link wallet: " + err.Error()`, batch-settle `"Settlement failed: " + err.Error()`, on-chain `"details": txErr.Error()`), aiding schema/RPC fingerprinting. P2P returns 404 for unknown recipients vs success otherwise (account enumeration by email/username, no recipient confirmation step showing *who* you are paying — mistyped identifiers send irreversible funds to strangers). On-chain send errors are mapped to friendly text for users (good, `summarizeOnChainSendError`) — apply the same mapping discipline everywhere; log the detail, return a code. Add a P2P “confirm recipient” lookup (masked display name) and consider delayed/cancellable P2P above a threshold.

### W-33 · Limit-history erasure and “log and continue” past controls

Withdrawal/compensation refunds `DELETE` the corresponding `spending_records` rows instead of posting compensating negative records — history is rewritten, forensic reconstruction of limit decisions becomes impossible, and the unique index `(wallet_id, reference, type)` (`000102`) then permits re-recording the same reference. `RecordSpending` failures are logged-and-continued in P2P, withdrawal, and billing debit paths, so a DB fault silently disables limit accounting while money still moves (inside the same tx this should abort; outside, it must not be optional). `CheckSpendingLimit` computes windows (UTC day / Sunday-week / calendar month) that ignore `LimitWindowStart` entirely (field is write-only legacy), and `GetSpendingForWindow` costs 3 aggregate queries per check (see §8).

### W-34 · Schema & lifecycle gaps

`withdrawal_payout_queue` (`000133`) has no FKs on `user_id`/`wallet_id` (orphans survive user deletion; the deletion worker must remember every money table forever). GDPR deletion deletes append-only ledger rows via the `app.wallet_ledger_allow_mutate=gdpr_delete` GUC — legally understandable, but it destroys the conservation proof `ReconcileUserWallets` depends on (deleted users’ history can never be re-proven; consider crypto-shredding PII columns + retaining amount-only tombstones instead). The withdrawal whitelist adds little defence today: destination is already pinned to the linked wallet (`dest != *linkedAddress` ⇒ reject), so the whitelist can only DoS the one legal destination; meanwhile whitelist updates need no signature/cooldown and take effect instantly. Decide: either support *multiple* approved destinations properly (whitelist = the control, each addition signed + cooled-down) or remove the whitelist UI to avoid false assurance. Minor: `primary_withdrawal_address VARCHAR(44)` fits base58 pubkeys but leave headroom (`000058` already widened another wallet column once).

### W-35 · Frontend wallet weaknesses

Hooks rely on parent `processing` props/buttons for double-submit protection (`handleWithdrawSol`/`handleDepositSol` do not early-return if already processing); amounts are `parseFloat` throughout (W-20); a `202 processing` queued withdrawal has no status polling/link — users cannot distinguish queued vs paid vs refunded except by watching balance; deposit flow trusts `treasuryConfig` fetch (a compromised config endpoint could redirect deposits — pin/confirm the deposit address with a signed config or show-and-confirm full address with checksum emphasis; manual-verify flow accepts pasted signatures, fine server-side, but needs clearer “never paste signatures from strangers” UX); stale fiat types remain exported from `lib/api/wallet.ts`. None of these are exploitable without server cooperation, but all of them generate support/incident load on a money surface.

**Additional hardening notes (no ID — bundle into remediation):** `/wallet/link` (POST/DELETE) has no explicit rate limit while neighbouring money routes have 5–10/min; withdrawal-security reads/writes should be audit-logged (whitelist/primary changes currently are not visibly audit-logged at the handler); `UserFlag` freeze is checked on withdrawal but not uniformly on P2P/escrow-release/provider-payout paths (a frozen account can still P2P funds out to a clean account — verify intent); KYC status is not consulted by deposit/withdraw limits (caps are uniform and very large: 10k SOL single / 50k SOL daily defaults dwarf new-user spend tier 10 SOL/day — align caps with KYC/trust tiers for AML sanity); no sanctions/OFAC list screening on deposit senders or withdrawal destinations was found.

---

## 7. Errors & Correctness Bugs (Non-Security)

| # | Bug | Location / symptom |
|---|---|---|
| E-1 | Deposit can return HTTP 200 success with `new_balance` for an **uncommitted** credit | `crypto.go` ignored `tx.Commit()` (W-22) |
| E-2 | Dual-destination deposit tx credits only one leg; remainder stranded with success response for the credited leg only | `crypto.go` candidate loop `break` (W-07) |
| E-3 | `getWallet` transaction list: empty-`ReferenceID` ledger rows suppress pending attempts; merged list is **unsorted** across the two sources (ledger page then pending page) and capped weirdly (`limit` applies per-source, UI can receive up to 2×limit) | `wallet.go` `getWallet` |
| E-4 | Withdrawal signature `%.6f` vs lamports debit: amounts differing in the 7th–9th decimal place share a valid signature; dust `amount>0` rounding to 0 lamports errors deep in helpers | `wallet.go`, `wallet_money.go` (W-20) |
| E-5 | `EffectiveBalanceLamports` can resurrect drained balances / mask drift (heuristic arbitration) | `wallet_money.go` (W-19) |
| E-6 | Escrow auto-release `now := time.Now()` is captured *before* potentially 45 s on-chain settle; `released_at` predates settlement | `escrow.go` `AutoReleaseExpiredEscrows` |
| E-7 | `AutoReleaseExpiredEscrows` logs `time.Now()` (local) in queries vs UTC elsewhere (`HeldAt`/challenge use UTC) — release timing skew under non-UTC hosts; spending windows are UTC (correct), be consistent | `escrow.go`, `spending_limit.go` |
| E-8 | Batch `GetStats().SavingsPercent = 30.0` is a hardcoded estimate returned as data | `batch_payout.go` |
| E-9 | `calculatePriority(int(amountSOL))` truncates: 0.99 SOL and 0.01 SOL queue identically (priority 1); priority mainly rewards size, starving small providers under load | `batch_payout.go` |
| E-10 | Payout retry policies disagree: batch requeue abandons at 5, retry worker at 8, withdrawal queue at 40, compensation outbox (check its cap in code) — same money, different dead-letter behaviour per path | `batch_payout.go`, `worker.go`, `withdrawal_payout_worker.go` |
| E-11 | `handleNativeDeposit` creates wallets **without** default spending limits; `verifyCryptoDeposit`’s wallet-creation branch keys off `err.Error() == "record not found"` string matching (brittle vs wrapped errors — use `errors.Is`) | `escrow_listener.go`, `crypto.go` |
| E-12 | Mojibake (double-encoded UTF-8) in log/comment strings (`escrow_listener.go`, `escrow.go` audit comment) — log parsers/alerts matching on text will miss; indicates files edited across encodings | `worker/escrow_listener.go`, `api/escrow.go` |
| E-13 | `treasuryAddress` in `escrow_listener.go` is captured from env at package init (stale after config change; only used in a log line today — delete) | `worker/escrow_listener.go` |
| E-14 | `withdrawSOL` preflight does up to three sequential RPC balance reads + a possible 45 s vault top-up **inside the HTTP request** before debiting; duplicate client retries during this window race each other (see W-11) | `wallet.go` |
| E-15 | Provider-earnings `recordProviderEarning` recomputes gross SOL with its own float formula (bandwidth×price, multiplier, fee) separately from billing’s lamports cost — dashboard “earnings” can disagree with actual wallet credits by rounding/multiplier | `provider_earnings.go` vs `billing/price.go` |

---

## 8. Bottlenecks & Performance Analysis

Ordered by expected pain at growth (all are “works on testnet, hurts at scale” — none block today’s devnet use):

1. **Every money movement writes 4–5×**: wallet row update + `wallet_ledger_entries` insert + journal header + 2–3 journal lines (+ spending record + information-schema lookup per journal post, W-29). With `FOR UPDATE` on the wallet row held across all of it — and, in `debitBuyerWallet`, across a **price-feed call** (`GetSOLPriceUSD()` for the description string can hit the network under lock on cache expiry). Hot wallets (platform-fee earners, popular providers) serialise hard. *Fix:* lamports-only single write path (W-19), cache the journal-schema check at boot, move price lookup outside the tx (snapshot first), consider async journal projection from the append-only ledger *if* journal-as-SoT is abandoned — but not both (W-29).
2. **Hourly batch settlement is a sequential Redis `SCAN(0, count=0)`** over `billing:session:*:pending`, settling one session at a time (each: session+listing preload, order gate lookup, 3 spending SUMs, 2 wallet txs, journal, artifact updates, possible on-chain session settle at 45 s timeout). Throughput is O(sessions) serial DB+RPC latency; a backlog (outage, breaker pause) has no parallelism, prioritisation, or progress checkpoint within the hour. *Fix:* bounded worker pool with per-wallet ordering, `SCAN` with cursor+count, move metering claims to Postgres (W-16) and settle with `SKIP LOCKED` claims like the payout workers already do.
3. **Spending-limit checks = 3 aggregate scans per debit** (`GetSpendingForWindow`) over `spending_records(user_id, created_at)` with no rollup/caching; deposit daily-cap adds a 4th SUM over the ledger per deposit. *Fix:* materialised rolling counters (per wallet/day buckets incremented in the money tx) or a single conditional-aggregate query; index `wallet_ledger_entries(wallet_id, type, created_at)` if not present for deposit sums.
4. **`GET /wallet` synchronous RPC + multi-query merge** (W-21) and **withdrawal preflight RPC chain** (E-14): wallet-page and withdrawal latency inherit public-RPC latency/rate-limits; no caching, no request coalescing. Deposit verification similarly holds an HTTP handler up to ~18 s+ of RPC retries (12×1.5 s + request time, `verify.go`) — under a deposit burst this exhausts handler/DB pools while holding *no* locks yet still DoSing the API tier. *Fix:* short-TTL balance cache, async deposit verification (202 + watcher/webhook completion — the watcher path already exists), per-endpoint RPC budgets/circuit breakers shared with treasury code.
5. **Reconciliation full scans hourly** (W-18): `GROUP BY wallet_id` over the entire (append-only, ever-growing) ledger + archive, plus per-journal balance `GROUP BY`, plus loading all wallets. Needs watermark/incremental verification (verify ledgers by created-at partitions, keep running checksums per wallet updated in the money tx).
6. **Escrow auto-release serial 45 s on-chain calls** in batches of 50 in a 15-min ticker (worst case >30 min per batch, overlapping ticks rely on `SKIP LOCKED` claims — correct but throughput-capped); `handleEscrowInitialized` sleeps in-handler (W-26). *Fix:* bounded concurrency with per-order idempotence (outbox already models this), metrics on queue age.
7. **Lock ordering is correct in P2P but lock *hold time* is long**: `transferP2P` begins a tx, does recipient lookup + an **unlocked** sender-profile read via the global `db.DB` (separate connection — can deadlock/starve small pools: tx holds one conn waiting while the side query needs another), spending check (3 SUMs), spending record, dual ledger+journal writes — all under two wallet locks with a 30 s context. The billing credit path `FirstOrCreate` under `FOR UPDATE` and provider-score writes add contention on popular providers. *Fix:* do all reads inside the tx (or before locking), keep locked sections to balance mutation + inserts only.
8. **Single-instance assumptions in process**: in-memory circuit-breaker failure list (Redis only for the pause deadline), in-memory price cache per pod (pods can bill the same bytes at different SOL prices around cache expiry — fairness/accounting jitter), `treasury` top-up mutex is process-local (multi-pod top-ups rely on chain balance re-reads). Acceptable at 1 pod; document or distributed-lock before horizontal scaling (settle-lock shows the pattern — with owner tokens, W-16).

---

## 9. Bad Code & Maintainability Analysis

The wallet code carries visible scar tissue from at least three audit/remediation waves (P0/P1/P2, BE-CRIT, DB-01/02/03, BC-xx tags). The fixes are mostly real, but the accretion pattern is now itself a risk:

1. **Triplicated identity logic.** Wallet linking exists as (a) `crypto.go linkWallet`, (b) `linked_wallets.go LinkWallet/SetPrimary/Unlink`, (c) wallet-login in `auth.go`, glued by (d) `wallet_identity.go ensurePrimaryLinkedSolana` — each with different side effects on the four places identity lives (`profiles.wallet_address`, `linked_wallets`, `wallets.primary_withdrawal_address`, whitelist/cooldown). W-04/W-05 are direct consequences. *Target:* one `WalletIdentityService` owning all four stores transactionally; HTTP handlers become thin adapters.
2. **Quadruplicated refund/compensation logic.** “Credit back + delete spending record + log/alert (+maybe outbox)” is hand-copied in `withdrawSOL` (×2), `withdrawal_payout_worker.failAndRefundWithdrawal`, `compensation_outbox.applyWithdrawalCompensation`, and three restore paths in `billing/worker.go`. They already differ in details (alerting, outbox enqueue, spending-record handling). *Target:* one `RefundWithdrawal(tx, ref, reason)` / `RestorePayout` helper, idempotent by reference, used everywhere.
3. **God files.** `wallet.go` 1,109 lines (routes, wallet provisioning, P2P, withdrawal incl. treasury preflight, limits CRUD, whitelist, on-chain send helpers, error summariser), `billing/worker.go` 837 lines (circuit breaker + settlement + payouts + retries + latency lookup), `solana/lib.rs` 4,894 lines for the whole program, `treasury_manager.go` 745 lines. Every change risks unrelated money paths; reviewers cannot hold these files in mind. Split by flow (deposit/withdraw/p2p/limits; settle/payout/retry) behind the existing helpers.
4. **Stringly-typed money.** Ledger `Type`, journal `JournalKind`, queue statuses, and entry kinds are raw strings scattered across packages (`"withdrawal_failed_refund"`, `"payout_restore"`, `"deposit_auto"`, `"skip"`…) with only some modelled as constants; recon/reporting queries hardcode the same strings (and, per W-18, some that no longer exist). Introduce a single `moneykind` registry (Go consts + DB CHECK constraints) and generate recon queries from it.
5. **Global mutable wiring.** `globalBatchProcessor` (twice, different packages), `globalSendSOL` function pointer, package-level `rpcEndpoint` mutated on successful verify (`verify.go` — data race under concurrent deposits: tests with `-race` should catch this), `treasuryAddress` init-captured env, `sendSOLOnChainHook`/`SendSOLTestHook` test hooks in production binaries. Prefer explicit dependency structs constructed in `main.go`; at minimum guard `rpcEndpoint` with `atomic.Value`.
6. **Inconsistent error discipline.** The codebase ranges from exemplary (`withdrawSOL` compensation + outbox + alerts) to ignored returns (W-22), string-matched errors (`err.Error() == "record not found"`, `strings.Contains(err.Error(), "insufficient SOL balance")` in `admin.go`), `log.Printf` mixed with structured `logging.*` in the same flows (`escrow.go`), and panics as control flow via type assertions (W-23) papered over by per-handler `recover` defers in only some handlers. Adopt sentinel errors (`ErrInsufficientBalance`, `ErrSpendingLimit` already typed — extend), `errors.Is/As`, one logging facade, and delete recover-defers in favour of not panicking.
7. **Config sprawl.** Money limits live in: Gin binding tags, Go consts (10,000 / 50 / 500 / 0.05…), env vars, `system_configurations` DB rows, trust-tier tables, frontend props. They already disagree (W-27). Single `MoneyLimits` config loaded/validated at boot, echoed in `/system/config`, shared with the frontend from the API (frontend threshold prop must come from server, not build-time).
8. **Frontend type drift.** `lib/api/wallet.ts` still models fiat-era requests; `getTransactions` fabricates pagination; lamports fields returned by the API (`balance_lamports`, `available_lamports`) are ignored by UI maths. Generate TS types from the Go DTOs/OpenAPI (Scalar reference already ships in `apps/docs`) and fail CI on drift for wallet DTOs.

---

## 10. Threat Model (STRIDE)

Scope: custodial wallet + deposit/withdraw/payout/escrow paths. Likelihood (L) and Impact (I) scored 1–5 for a public mainnet deployment *as currently defaulted*; finding IDs link mitigations.

| STRIDE | Threat scenario | L | I | Findings |
|---|---|---|---|---|
| **S**poofing | Stolen JWT session re-links attacker Solana wallet (own signature is valid) and withdraws with no cooldown via `/linked-wallets` | 4 | 5 | W-04, W-13, W-15 |
| | Replay captured link signature (no expiry/nonce) to re-point identity | 3 | 4 | W-14, W-15 |
| | Lying Solana RPC returns fabricated deposit tx; single-source trust credits balance | 2 | 5 | W-07 |
| **T**ampering | Crafted multi-instruction tx where fee-payer ≠ funder mis-attributes deposit credit | 3 | 4 | W-07 |
| | Session holder sets spending limits to 0 (= unlimited) then drains beyond tier ceiling | 4 | 4 | W-06 |
| | Direct DB/app-role tampering with ledger — **mitigated**: append-only triggers + REVOKE UPDATE/DELETE/TRUNCATE (`000116/137/138`) | 2 | 5 | §12 |
| **R**epudiation | Withdrawal “success” with tx hash only in logs/HTTP response; admin debit with no payout record — user/platform cannot prove payment | 4 | 3 | W-03, W-30 |
| | Spending-record deletion rewrites limit history | 3 | 2 | W-33 |
| **I**nfo disclosure | All user balances published to NATS each recon; stored link signatures returned by API; raw DB errors to clients | 3 | 2 | W-18, W-15, W-32 |
| | P2P recipient enumeration (404 oracle) | 4 | 1 | W-32 |
| **D**enial of service | Price-feed outage ⇒ free usage (economic DoS on platform) + evidence deletion | 3 | 4 | W-08 |
| | 3 insolvent buyers trip global settlement breaker; velocity budget burned by failed sends blocks payouts | 4 | 3 | W-17, W-27 |
| | Sync RPC in `GET /wallet`, 18 s deposit verifies, untimed-out withdrawal sends exhaust handlers | 4 | 3 | W-21, W-03, §8 |
| | Watcher downtime ⇒ deposits invisible until manual verify | 3 | 2 | W-26 |
| **E**levation of privilege | Admin payout endpoint debits arbitrary wallets without disbursement/approval trail (insider / admin-key theft) | 2 | 5 | W-30 |
| | Single oracle key settles any escrow; host compromise = escrow + hot-wallet compromise up to velocity caps | 2 | 5 | W-28 |
| | `GET /wallet` fallback creates profile with context-supplied role (verify middleware always sanitises role claims) | 2 | 4 | W-21 |

**Top attack chains to test after remediation:** (1) session theft → relink → limit-zero → chunked withdrawals; (2) RPC/response forgery → deposit credit → P2P laundering to clean account → withdraw; (3) provider double-threshold race → batch-payout fund disappearance (bug, no attacker); (4) crash-injection (kill -9 between debit and send/enqueue at each money boundary) → prove exactly-once via recon.

---

## 11. Scoring

Weighted per audit framework (0–100 per domain). Scores reflect **default configuration**; enabling the full decentralisation flag set correctly would raise AuthZ/Data scores but does not fix W-01/W-02/W-03/W-08.

| Domain | Weight | Score | Rationale (one line) |
|---|---|---|---|
| Secrets & credentials | 20% | 62 | KMS paths + key separation exist; plaintext files allowed, single-key trust by default (W-28) |
| Input validation | 15% | 58 | Binding caps present; float money, negative limits, substring checks, raw error leakage (W-06/14/20/32) |
| Authentication & authorisation | 15% | 55 | JWT + wallet-login challenge is solid; money authorisation (signatures, cooldowns, idempotency) bypassable (W-04/11/13) |
| Data / ledger protection | 15% | 66 | Append-only ledger + double-entry + locks are real; dual-write drift, queue atomicity gaps (W-02/19/29) |
| Resilience | 10% | 48 | Outbox/compensation exist; crash windows, price-zero, watcher amnesia, untimed-out sends (W-03/08/26) |
| Monitoring & reconciliation | 10% | 52 | Hourly recon + alerts exist but miscount liabilities and never auto-freeze (W-18) |
| Supply chain / on-chain | 10% | 60 | Program has multisig/replay design; off by default, monolith unaudited here, RPC single-trust (W-07/09/28) |
| Compliance (AML/KYC/privacy) | 5% | 40 | No KYC-tiered caps or screening found; NATS balance broadcast; GDPR-vs-ledger tension (W-18/34) |
| **Weighted total** | 100% | **≈57** | **Blocked (partial): fix P0s before real-value custody** |

Verdict bands: 90–100 approved · 70–89 approved with reservations · 50–69 blocked pending fixes · 0–49 redesign. This wallet system needs **fixes, not a redesign** — the ledger skeleton is worth keeping.

---

## 12. What Is Done Well (Positive Controls)

Credit where due — preserve these during remediation; several are better than typical for this stage:

- **Locked money helpers as the norm.** `Credit/DebitWalletLocked(Lamports)` + `LockWalletForUpdate` are used at the overwhelming majority of call sites (30+ audited) with ledger + journal writes inside the caller’s transaction; P2P locks both wallets in UUID order (deadlock-free) with a 30 s bound; wallet auto-creation serialises on the user row.
- **Append-only money tables enforced in the database**, not just by convention: mutation-blocking triggers, `REVOKE UPDATE/DELETE/TRUNCATE` from the app role, archive-table parity (`000116`, `000137`, `000138`).
- **Double-entry journal with a deferred balance trigger** (`000124` + `000131`) and hourly journal-vs-wallet drift reconciliation, including per-wallet drift reporting.
- **Integer lamports retrofit** under the float API (`wallet_money.go`) with unit tests for dust/affordability edges.
- **Deposit defences that many systems lack:** on-chain amount taken from chain (not the request body — request amount only caps), sender-binding attempt, single + daily caps enforced on *verified* amounts in both sync and watcher paths, unique `pending_transactions.reference` + partial-unique ledger `tx_hash`.
- **Prior criticals actually fixed**, with regression-minded comments/tests: internal P2P no longer pays out of treasury (BE-CRIT-01), provider double-pay via earnings rows closed (BE-CRIT-02 + `markProviderEarningPaid`), mandatory velocity guard (fail-closed when uninitialised/Redis down), batch `submitted`-before-`completed` + finality poll, settle lock across pods, escrow-PDA fail-closed gates *when enabled*.
- **Compensation/outbox patterns** for withdrawal refunds and escrow settles with idempotent `(kind, reference)` enqueue; alerting on refund failure rather than silent drops.
- **Wallet-login challenge done right** (random + blockhash nonce, 5-min TTL, atomic single-use consume across Redis/memory) — reuse this pattern for linking/withdrawal authorisation (W-13/W-14).
- **Separation of payout vs oracle keys** (BC-08) with KMS options, encrypted keypair support, treasury hot/vault/cold liquidity management with top-up cooldowns and queue-aware draining.
- **Test presence on money paths** is non-trivial: `wallet_test.go`, `wallet_phase2_test.go`, `wallet_withdrawal_security_test.go`, `crypto_test.go` (double-spend, sender mismatch, cap cases), `concurrency_test.go`, `worker_test.go`, `wallet_money_test.go`, `spending_limit_test.go`, escrow gate tests. Gaps are listed in §14 — the harness to add them exists.

---

## 13. Remediation Roadmap

### P0 — Before any real-value (mainnet) custody

| # | Action (finding) | Effort |
|---|---|---|
| P0-1 | Single-transaction debit+enqueue for provider payouts; per-payout UUID idempotency; decline⇒error+restore (W-01) | S |
| P0-2 | Replace delete-as-claim with status state machine + stale-claim reaper; batch+items created in claim tx (W-02) | M |
| P0-3 | Unify all withdrawals behind `withdrawal_payout_queue` state machine created *in* the debit tx; bounded sends, persist tx-hash at `submitted`, confirm before `completed`; delete inline send (W-03) | M |
| P0-4 | One wallet-identity service: every primary/link change sets cooldown/whitelist state; chain-split identity columns; challenge-based linking (W-04, W-05, W-14, W-15) | M |
| P0-5 | Fix limit-0 semantics + handler validation + spend-time tier ceilings; normalise existing wallets (W-06) | S |
| P0-6 | Deposit verification v2: instruction-level transfer proof, integer lamports, finalized-to-spend, dual-leg handling (W-07) | M |
| P0-7 | Price-unavailable ⇒ settlement failure (never zero-charge/delete); price snapshot at metering time (W-08, W-16) | S–M |
| P0-8 | Production posture gate at boot + strict env validation; secure defaults for money flags (W-09) | S |
| P0-9 | Client idempotency keys on `/wallet/transfer` and `/wallet/withdraw/sol` (W-11) | S |
| P0-10 | Check every commit/create result on money paths; `errors.Is` for not-found; CI errcheck gate (W-22) | S |

### P1 — Before scale / public launch

- Lamports-only balances & APIs (decimal-string/lamports at edges); delete dual-write heuristic and float helpers (W-19, W-20). Finish journal-as-SoT **or** demote journal to projection — one truth (W-29).
- Earnings sub-balance; opt-in auto-payout with thresholds; sweep only payable funds (W-10).
- Durable metering claims in Postgres; owner-tokened locks; settlement worker pool; failure classification so insolvency ≠ RPC breaker (W-16, W-17, §8).
- Reconciliation rewrite: lamports SQL sums, all queues/holds in liabilities, escrow backing, aggregates-only publishing, deficit⇒auto-freeze (W-18).
- Withdrawal authorisation: signature/step-up for all non-dust withdrawals, server challenges, exact-lamports binding; destination checks under lock (W-12, W-13).
- Watcher durable cursor + boot backfill; `releasing`-escrow reaper; dispute precedence fix (W-24, W-26).
- Velocity reserve/settle accounting; single limits config; admin payout via state machine + four-eyes or disable (W-27, W-30).
- `GET /wallet` side-effect-free + provisioning at signup; server-side tx pagination (W-21).

### P2 — Hardening & quality

- Multisig settle default-on in prod; KMS-only prod signing; key-file permission checks; rotation runbooks + freeze drills (W-28).
- Fail-closed custodial escrow maths in lamports with program-shared vectors (W-25); delete dead crypto/fiat code (W-31); sentinel errors + single logging facade; split god files; money-kind registry (§9).
- KYC/trust-tiered deposit/withdraw caps, screening hooks, audit-log all withdrawal-security changes, uniform freeze enforcement (P2P/payouts), whitelist redesign-or-remove decision (W-34, §6 notes).
- Frontend: lamports-aware amounts, double-submit guards, queued-withdrawal status UI, generated DTO types (W-35, §9).
- Incremental reconciliation with per-wallet checksums; queue-age/slo metrics & dashboards for every money queue (depth, oldest age, dead-letters) (§8 — `QueueDepthStats` is a start; replicate for batch/retry/outbox).

**Suggested sequencing:** P0-1/P0-2/P0-5/P0-10 first (days, highest loss-prevention per line), then P0-3/P0-4 (the two state-machine/identity refactors), P0-6/P0-7/P0-8/P0-9 in parallel. Re-run §14 tests + a focused re-audit of the three payout/withdraw/deposit flows before changing network/caps.

---

## 14. Testing Gaps & Recommended Tests

Existing coverage is respectable on happy paths and several historic bugs. Missing/weak — in priority order:

1. **Crash-injection (fault) tests** — kill/rollback between every debit and its externalisation (batch enqueue, batch claim→create, withdrawal debit→queue, debit→broadcast, broadcast→persist-hash, settle debit→Redis-delete) asserting *exactly-once* money outcome via ledger+journal+queue inspection. This suite would have caught W-01/W-02/W-03/W-16.
2. **Idempotency/replay tests** — duplicate `QueuePayout` with a pending row after debit (W-01 regression); duplicate P2P/withdraw submissions with same client key (W-11); deposit signature submitted via HTTP *and* watcher concurrently; compensation applied twice.
3. **Identity/cooldown matrix tests** — link/primary/unlink via *each* endpoint family × chain, asserting cooldown, destination, and deposit-sender behaviour after each transition (W-04/W-05 regressions); expired/replayed/cross-user link signatures rejected (W-14/W-15).
4. **Limit-semantics tests** — stored 0, negative, above-tier values; bare-wallet creation paths; limit raise without step-up rejected after P1 (W-06).
5. **Deposit adversarial fixtures** — fee-payer≠funder tx, dual-leg (vault+treasury) tx, v0/ALT tx, failed (`meta.err`) tx, rent-only balance increase, confirmed-then-dropped tx: assert no spendable credit (W-07). The mock-RPC harness in `crypto_test.go` extends naturally.
6. **Price-outage settlement test** — feed down ⇒ settle aborts, bytes retained, nothing marked settled/paid (W-08 regression).
7. **Concurrency stress** — parallel P2P A↔B, withdraw+spend same wallet, settle+payout same provider, auto-deposit+manual-verify same signature; run with `-race` (also catches `rpcEndpoint` mutation, §9) and assert conservation: `Σ wallets == Σ ledger == −Σ journal 2100`.
8. **Posture/config tests** — boot matrix over env combinations asserting prod refuses insecure defaults and typo’d values (W-09); limits-config single-source assertions (API cap ≤ velocity cap etc., W-27).
9. **Reconciliation truth tests** — seed each queue/hold state and assert liabilities/backing include it; deficit ⇒ freeze asserted (W-18).
10. **On-chain integration (local validator)** — escrow/session settle amounts vs custodial formulas with shared vectors (W-25); deposit-vault withdraw authority matrix; multisig threshold routes. (Anchor/program-local tests exist sporadically; wallet-flow-level E2E against `docker-compose.local-solana.yml` was not evidenced.)

---

## Appendix A — File & Endpoint Inventory

### A.1 Wallet HTTP surface (all under `RequireAuth` in `main.go` protected group unless noted)

| Method & path | Handler | Money effect |
|---|---|---|
| `GET /v1/wallet` | `getWallet` | Read (+ provisioning writes today, W-21) |
| `POST /v1/wallet/transfer` (5/min) | `transferP2P` | Custodial debit+credit |
| `POST /v1/wallet/deposit/crypto` (5/min) | `verifyCryptoDeposit` | Custodial credit from on-chain tx |
| `POST /v1/wallet/withdraw/sol` (5/min) | `withdrawSOL` | Debit + on-chain pay/queue |
| `POST`/`DELETE /v1/wallet/link` (no explicit limit) | `linkWallet` | Identity / withdrawal routing |
| `GET`/`PUT /v1/wallet/limits`, `POST /wallet/limits/reset` | spending-limit handlers | Limit config |
| `GET /v1/wallet/withdrawal-security`, `PUT …/whitelist` | whitelist handlers | Withdrawal routing |
| `GET /v1/wallet/security-flags` | `getMySecurityFlags` | Read |
| `GET/POST /v1/linked-wallets`, `PUT /:id/primary`, `DELETE /:id` | `linked_wallets.go` | Identity (parallel system, W-04) |
| `GET /v1/escrow/:orderId`, `POST …/release`, `POST …/dispute` (+ disabled legacy jury/resolve ⇒ 410) | `escrow.go` | Escrow settle/dispute |
| `GET /v1/provider/earnings[/summary|/history]` | `provider_earnings.go` | Read (earnings created internally) |
| Admin: `POST /payouts/...` batch routes, `processPayout`, `POST /crypto/batch-settle`, `POST /crypto/emergency-pause` (admin role) | `admin*.go`, `crypto.go` | Payouts / settlement / pause |
| Public: `POST /auth/wallet/challenge` + wallet login | `auth.go` | Auth (challenge done well, §12) |

### A.2 Money tables (Postgres)

`wallets`, `wallet_ledger_entries` (+`_archive`), `ledger_accounts`, `ledger_journals`, `ledger_journal_lines`, `spending_records`, `pending_transactions`, `withdrawal_payout_queue`, `pending_payouts`, `batch_payouts`, `batch_payout_items`, `payout_retry_queue`, `compensation_outbox`, `escrow_transactions`, `escrow_milestones`, `escrow_disputes`, `provider_earnings`, `reconciliation_history`, `escrow_reconciliation_events`, `linked_wallets`, `usage_receipts`, `settlement_manifests`, `session_intents` (+ usage ledger), `user_flags`. Redis: `billing:session:*:pending` metering, settle locks, circuit-breaker + velocity counters, auth/withdrawal nonces, watcher dedup.

### A.3 Largest wallet-critical files (audit reading order)

`solana/lib.rs` (4,894) · `api/wallet.go` (1,109) · `billing/worker.go` (837) · `api/crypto.go` (765) · `treasury_manager.go` (745) · `api/escrow.go` (577) · `treasury/reconciliation.go` (558) · `billing/batch_payout.go` (437) · `api/compensation_outbox.go` · `solana/watcher.go` · `solana/client.go` · `models/wallet_tx.go` + `ledger_journal.go` (small but load-bearing — read first).

---

## Appendix B — Money Invariants Checklist

Use as acceptance criteria for remediation (each should be provable by a query/test at any instant):

| # | Invariant | Holds today? |
|---|---|---|
| I-1 | No balance goes negative (DB CHECK + locked helpers) | ✅ Yes (`000032/000042`) |
| I-2 | Every balance change has exactly one ledger entry and one balanced journal | ⚠️ Mostly — journal can soft-skip/double-post (W-29) |
| I-3 | `wallet.balance == Σ ledger amounts == −Σ journal(2100)` per wallet | ⚠️ Checked hourly, drift tolerated/alerted (W-18/W-19) |
| I-4 | Every debit destined off-ledger has a durable payout intent **before** externalisation | ❌ No (W-01/W-02/W-03) |
| I-5 | Every on-chain payout has a persisted tx hash joinable to its debit | ❌ Withdrawals: no (W-03); batches: yes post-`submitted` |
| I-6 | Deposits credit exactly the lamports provably transferred from the linked wallet, once | ⚠️ Once: mostly; provably-from: no (W-07) |
| I-7 | Metered bytes are billed exactly once or visibly dead-lettered, never silently dropped | ❌ No (W-08/W-16) |
| I-8 | Withdrawal destination changes always incur cooldown before next withdrawal | ❌ No (W-04) |
| I-9 | Stored spending limits never exceed tier ceilings in effect | ❌ No — 0 = unlimited (W-06) |
| I-10 | Treasury+vault+escrow backing ≥ liabilities incl. all queues/holds, continuously known | ❌ Not measured correctly (W-18) |
| I-11 | Retries of any money API/worker are safe (idempotent by durable key) | ⚠️ Workers mostly; user APIs no (W-11) |
| I-12 | Secure posture in prod is explicit, validated at boot, and observable | ❌ No (W-09) |

---

## Appendix C — Audit Limitations

- **Static review only.** No services were run, no database/chain state inspected, no dynamic/fuzz/penetration testing performed, and the existing test suite was read but not executed for this report. Findings are code-evidenced; exploitability statements assume the reviewed code is what is deployed (verify image digests / deployed program IDs separately).
- **Solana program** (`lib.rs`, session/bond/reputation programs) received a *wallet-interface* review (authority model, settle entry points, vault) — not a full Anchor program audit (account-validation, PDA-seed, arithmetic, upgrade-authority review). A dedicated program audit is required before mainnet regardless of this report.
- **Out of scope:** edge-gateway/provider-node metering integrity beyond its billing interface, Supabase/auth configuration, infra/K8s/compose security, frontend XSS/session storage beyond wallet hooks, SDKs, governance voting, social features. Several adjacent audit docs cover those areas.
- **Environment truth unknown:** effective production flag values, RPC providers, key custody (file vs KMS) in the live deployment, and treasury balances were not verified — W-09 exists precisely because they matter and are not derivable from code.
- Line references use file + symbol names (line numbers drift quickly in this codebase); all quotes were taken from the working tree on 2026-10-25.

---

*End of report. Companion prior art: [Billing / Wallet / Escrow Audit](10_BILLING_WALLET_ESCROW_AUDIT.md) · [Baseline 2026-10-25](../audits/BASELINE_2026-10-25.md) (verify link targets on review — filenames per repo listing at audit time).*

---

## Addendum A — P0 Remediation Status (2026-10-26)

All §13 P0 items implemented and verified via Docker Go 1.25 + Postgres 16 (`go build ./...`, scoped `go vet`, `go test ./internal/api/... ./internal/billing/... ./internal/worker/... ./internal/models/... ./internal/solana/... ./internal/decentralization/... -count=1`):

| Item | Status | Key change |
|---|---|---|
| P0-1 | Done | `queueProviderPayout` debit + `PendingPayout` in one tx, per-payout UUID, `EnqueuePayoutTx` (migration 000156) |
| P0-2 | Done | Batch payout state machine `queued→claimed→completed\|failed`, stale-claim reaper, no delete-as-claim |
| P0-3 | Done | Durable `withdrawal_payout_queue` row in debit tx; 200 only on confirmed, 202 submitted; refund only on proven chain failure; worker confirmation sweep |
| P0-4 | Done | Challenge-based linking (`POST /v1/wallet/link/challenge`, single-use), unified identity service, chain-split ETH/Solana, signature-required set-primary with cooldown |
| P0-5 | Done | Limit 0 = zero allowed, tier-clamped `EffectiveLimits`, settings API rejects ≤0 (migration 000158) |
| P0-6 | Done | Deposit proof v2: jsonParsed instruction-level System Transfer proof (top + CPI inner), integer lamports, fee-payer signer == linked wallet == transfer source, v0/ALT bounds-checked, multi-leg crediting |
| P0-7 | Done | Price outage fails settlement (`ErrSOLPriceUnavailable`, metering retained); consumption-time SOL price snapshot per session |
| P0-8 | Done | `ValidateSecurityPosture` boot gate: strict flag parsing (typos fatal), production requires explicit finalized deposits, emergency price, provider lease; effective posture logged |
| P0-9 | Done | `Idempotency-Key` on transfer + withdraw (migration 000157), frontend wired |
| P0-10 | Done | Money-path commit/create errors checked (deposit commit, escrow listener creates); `errors.Is(gorm.ErrRecordNotFound)`; no errcheck config exists in repo — recommend adding one to CI |

Verification notes: 30+ new regression tests pass. Pre-existing failures (proven identical on clean HEAD, not regressions): billing `TestEvaluateEscrowCustodialGate_*` (2), worker `TestPurgeUserAccount_*` (missing test-DB relations), API 16 failures (orders/sessions/messaging/KYC/config incl. `TestWithdrawSOL_SpendingLimitExceeded` expecting 400 vs handler 403). Unverified: frontend `tsc`; full-repo vet beyond touched packages; live-chain deposit/withdrawal against a real RPC. P1/P2 items remain open.



