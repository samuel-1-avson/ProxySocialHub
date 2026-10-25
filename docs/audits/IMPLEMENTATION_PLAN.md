# ProxyHubb Implementation Plan

- **Source**: [COMPLETE_SYSTEM_ARCHITECTURE_AND_TECHNICAL_AUDIT.md](COMPLETE_SYSTEM_ARCHITECTURE_AND_TECHNICAL_AUDIT.md) (2026-10-25)
- **Plan date**: 2026-10-25 · **Status**: v1.1. Phase 0 and the Day-1 items are implemented on branch `hardening/day-1`, one commit per work item; results are in [BASELINE_2026-10-25.md](BASELINE_2026-10-25.md). The decisions in section 3 are running on their defaults.
- **Goal**: take the repo from "not production ready" (audit score 4.43/10) to a safe public testnet, then to a mainnet-ready state.
- **How to use this file**: work top to bottom. Every work item has an ID, the audit finding it closes, the files it touches, and a "done when" test. Tick the box in section 13 when an item is merged.

Effort labels are the audit's: XS ≤ 2h, S ≈ 1 day, M ≈ 2-3 days, L ≈ 2 weeks, XL ≈ 3+ weeks. Treat week numbers as relative sizing; they assume dedicated engineers.

---

## 1. Summary

| Phase | When | What | Gate it unlocks |
|---|---|---|---|
| 0 Prep | Day 0-1 | Toolchains, baseline test run, containment check, branch rules | none |
| 1 P0 hotfix | Days 1-5 | Close every fund-drain, free-bandwidth, host-compromise finding | **G0** P0s closed, internal testing safe |
| 2 Stabilize | Weeks 2-3 | Go↔Anchor sync, multi-pod metering, auth/rate-limit, WS hub | **G1** private testnet |
| 3 Clients and data | Weeks 4-5 | Extension, web, SDKs, DB hygiene, honest CI | **G2** public testnet |
| 4 Consolidate | Weeks 6-8 | Split monoliths, unify ingress, delete dead code | none (risk reduction) |
| 5 Crypto and infra | Weeks 9-12+ | Real ZK circuit, Squads multisig, infra hardening, external audit | **G3** mainnet |

Critical path: PREP-1 → P1-SC-1 → P1-SC-2/3 → P1-SC-6 (IDL) → P2-ABI-1 → G1. Everything else can run in parallel (section 12).

---

## 2. Corrections to the audit

I checked the audit's headline findings against the code before planning. Most hold. These do not, or need adjusting. Work from this list, not from the audit's wording, where they differ.

| # | Audit says | Code shows | Effect on the plan |
|---|---|---|---|
| C1 | Fix `BC-CRIT-01` by replacing `InvalidCalculation` with `EscrowError::CalculationOverflow` | `CalculationOverflow` is **not** in `EscrowError` ([lib.rs:16-83](../../services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs)). The two uses are at lib.rs:3191 and :3193. | The one-line fix would not compile. Add the variant, appended at the **end** of the enum (Anchor error codes are positional, so inserting mid-enum renumbers every later code). See P1-SC-1. |
| C2 | `models.Session` has no `AfterFind` hook (`BE-CRIT-04`) | `AfterFind` exists at [session.go:87](../../services/control-api/internal/models/session.go) (added in commit `fcfc7b7`). | The stated root cause is wrong. What may still be broken: no `AfterCreate`/`AfterSave`, so the struct holds ciphertext right after a create; `WHERE credentials_user = ?` lookups against random-nonce ciphertext; decrypt failures silently blank the credential. Reaper/terminate symptoms must be reproduced before fixing. See P1-CP-5. |
| C3 | `transferP2P` calls `go settleP2POnChain` and `EnqueueP2PSettleOutbox` | The call is `EnqueueP2PSettle` plus `ProcessCompensationOutboxOnce` at [wallet.go:558-570](../../services/control-api/internal/api/wallet.go). The outbox handler at compensation_outbox.go:483 also calls `settleP2POnChain`. | The drain is real, but deleting the enqueue is not enough: rows already queued as `p2p_settle` will still send SOL. See P1-CP-1. |
| C4 | Anchor is 0.30.1 | `Anchor.toml` pins 0.32.1 and `anchor-lang = 0.32.1`. | Install 0.32.1. `Anchor.toml` also lists a second program (`session`) that the audit does not mention. |
| C5 | Overflow bug is in three settle functions | The same `checked_mul(...).unwrap_or(0)` pattern is also in `compute_session_escrow_payout` (:763), `calculate_session_price` (:2400), `slash_provider_insurance` (:2583). | Sweep all six sites. See P1-SC-3. |
| C6 | Remove `~/Downloads` auto-adoption | Four call sites ([daemon_ctrl.rs:26](../../services/provider-node/src/daemon_ctrl.rs), [doctor.rs:33](../../services/provider-node/src/doctor.rs), [interactive.rs:15](../../services/provider-node/src/interactive.rs), [main.rs:617](../../services/provider-node/src/main.rs)). Web and docs pages tell users to download a config file. | Removing the feature breaks the onboarding flow unless it is replaced with an explicit import command and the copy is updated. See P1-DP-3. |
| C7 | Go and Anchor results are static analysis only | Confirmed on this machine: `go`, `anchor`, `solana`, `psql` are not installed. `cargo 1.98.1`, `node 24.20`, and a running Docker daemon are present. | No Go or Anchor change can be verified until PREP-1 is done. |

Found while implementing Day 1:

| # | Audit says | Code shows | Effect |
|---|---|---|---|
| C8 | Both gateway and provider are exposed to `::ffff:127.0.0.1`; flip `GATEWAY_DNS_REBIND_CHECK` to true | `edge-gateway` `is_private_ipv6` already rejects IPv4-mapped addresses ([policy.rs:113](../../services/edge-gateway/src/policy.rs)). Only `provider-node` was missing it. The gateway's DNS check is off by default on purpose, to keep hostname resolution on the provider side; `docker-compose.prod.yml` already sets it true. The provider resolves hostnames itself and checks every resulting address (handler.rs `resolve_allowed_target`). | The provider-side fix closes the hole. The gateway default was **left unchanged**. |
| C9 | Add an explicit import command | `provider-node config install --from <file>` already existed (it only refused to overwrite without `--force`). | P1-DP-3 extended that command instead of adding a new one. |
| C10 | n/a | The repo's Go tests need more than `AutoMigrate`: on unmodified HEAD, 6 packages fail in a plain container for environment reasons. | A green Go baseline needs the SQL migrations applied to the test database (see BASELINE section 2). Until then, compare before/after. |

Found while implementing Days 2-3:

| # | Audit says | Code shows | Effect |
|---|---|---|---|
| C11 | `SessionReaper` terminates every non-order session every 5 minutes | Not reproducible: `reap()` reads sessions with `Find`, `AfterFind` decrypts, and it skips empty usernames. `TestReap_KeepsSessionsWithLiveRedisKeyAndReapsGhosts` passes on the unmodified code. | No reaper change. The test stays as a regression guard. |
| C12 | `createOrder` returns `"ENC:..."` to buyers | Not reproducible: the response re-reads the session (`orders.go:519-521`), and `getOrderCredentials` decrypts before building the response. | No change. |
| C13 | `terminateSession` leaves the Redis key because `AfterFind` is missing | The real cause is different: `db.Model(&s).Updates(...)` runs `BeforeSave`, which re-encrypts the **in-memory** struct, and `DeleteSession(session.CredentialsUser)` then targets the ciphertext. Reproduced by `TestSessionCredentials_PartialUpdateDoesNotLeaveCiphertextInStruct`. | Fixed with an `AfterSave` hook (BE-CRIT-04). |
| C14 | Usage and metering lookups by `credentials_user` fail | Confirmed: AES-GCM uses a random nonce, so an encrypted username can never match an equality query (`usage.go`, `metering_spill_drain.go`). | Username is now stored as-is (decision D4); legacy rows are rewritten at startup. |
| C15 | `gatewaySessionHydrate` does 501 queries (`BE-HIGH-09`) | Stale: `hydrateGatewaySession` reads the indexed `session_gateway_cache` table by username hash. | Drop BE-HIGH-09 from P2-CP-1. |
| C16 | n/a | **Regression I introduced in PR #38**: removing `settleP2POnChain` left `wallet.go` without `JournalKind:"skip"`, so `TestJournalSkipSitesAllowlisted` (`internal/models`) failed. I had run `internal/api`, `solana` and `treasury` only. | Fixed in commit `4a77a58`. From now on the whole `go test ./...` is compared with the clean baseline before every push. |
| C17 | `confirmEscrow` and the session-intent confirm miss amount and bandwidth checks | Confirmed. The session-escrow PDA is derived from the session id, so PDA **reuse** only applies to the legacy per-pair order escrow. | Binding check and unique index apply to orders only. |
| C18 | `bridge_ws` should share the CONNECT pipeline | CONNECT is one ~1,000-line inline function with no integration tests. | `destination_guard.rs` carries the same decisions; CONNECT was left untouched. Moving it onto the guard is Phase 4. |

Every other P0 in the audit was reproduced by reading the code: `claim_bandwidth_rewards` has no authority check and no per-provider receipt (lib.rs:3175-3228); `transferFromReserve` sends to `treasuryAddr` via the oracle client (treasury_manager.go:573); `updateAPIKey` applies permissions and rate limit unvalidated (apikeys.go:267-271); `bridge_ws` never calls destination validation or `usage_tracker` (websocket.rs); `is_public_ipv6` has no IPv4-mapped check (handler.rs:442); `SETUP_SEED = 0x5052_4F58_5948_5542` (groth16-prover/src/lib.rs:18); `|| true` at proxyhubb-ci.yml:689.

Not yet re-verified (take on trust until the item's own test runs): the P1+ findings in the audit's summary table, `BE-CRIT-02` (triple payout), `BE-CRIT-03`, and the claims about `SessionReaper` and `terminateSession` behaviour. Each of those items starts by writing the failing test.

---

## 3. Decisions needed

Defaults are what I will assume if you do not answer. None blocks Phase 0.

| ID | Question | Default | Blocks |
|---|---|---|---|
| D1 | Is any build of this running anywhere public, or holding real SOL (mainnet or funded treasury)? | Devnet/testnet only, no real funds (`Anchor.toml` shows only localnet/devnet) | PREP-3 urgency |
| D2 | Canonical provider payout path | Credit `wallets.balance_sol` once per session through the ledger; pay out only via the existing audited withdrawal pipeline; retire the direct `SendSOL` paths | P1-CP-2 step 2 |
| D3 | What to do with the ZK path before Phase 5 | Keep `PROXYHUB_ZK_ONCHAIN_GROTH16=false`, treat ZK as non-functional, do not advertise it | none until Phase 5 |
| D4 | Session username storage | Plaintext `credentials_user` (it is a public identifier, `u_<hex>`), encrypted `credentials_pass`; no hash column | P1-CP-5 |
| D5 | Legacy `settle_escrow` | Restrict to admin now, delete during Phase 4 | P1-SC-4 |
| D6 | Devnet redeploy | Upgrade in place; no layout change to existing accounts (new `EpochClaimReceipt` is a new account type) | P1-SC-6 |
| D7 | Custody model (audit 38.1: internal wallet vs on-chain escrow) | Decide before Phase 4; Phases 0-3 keep both | Phase 4 |

---

## 4. Ground rules

1. **Test first.** For each finding, write a test that fails on `main`, then fix it. If the test passes before the fix, the finding is not reproducible: record that in section 2 and skip the fix.
2. **One work item per PR**, branch `hardening/<item-id>`, no mixed refactors. Exception: P1-SC-1 and the CI line change ship together.
3. **No red merges.** A PR may not add `|| true` or `continue-on-error`. When a work item makes a job pass, remove that job's bypass in the same PR (section 11.2).
4. **Compile-verify what you touch.** Go changes are not "done" until `go test ./...` has run in `services/control-api` (locally after PREP-1, or in the `golang:1.25` container). Anchor changes need `cargo check` plus the Anchor tests.
5. **Migrations**: reserve numbers up front (section 12) so parallel branches do not collide. Every migration that adds a constraint ships with a pre-check query for existing violations.
6. **Devnet only** until G3. Keep the previous program binary before each upgrade.
7. **Supersede false-confidence docs** (PREP-5) so nobody quotes them while the work is in flight.

---

## 5. Phase 0: Prep (Day 0-1)

**PREP-1 Toolchains** (S)
- Install Go 1.25.0 (matches `services/control-api/go.mod`), Anchor 0.32.1 via `avm`, and a matching Solana CLI. Check `services/solana-programs/proxyhub/rust-toolchain.toml` for the Rust pin.
- Run `npm ci` in `apps/web` (missing `node_modules` blocks its typecheck).
- Fallback if installs are a problem: Docker daemon is running. Use a `golang:1.25` container for Go, and the existing `build-anchor-docker.ps1` / `test-anchor-local-docker.ps1` in `services/solana-programs/proxyhub/` for Anchor.
- Done when: `go version`, `anchor --version`, `solana --version` work, or the container commands are written into this file.

**PREP-2 Baseline** (S)
- Run and record in `docs/audits/BASELINE_2026-10-25.md`: `cargo test` for `edge-gateway` (audit: 192 pass), `provider-node` (29), `programs/gateway-bond` (1), `services/admin-cli`, `groth16-prover` (1), `zk-prover` (3); `npm test` and `tsc --noEmit` in `apps/extension`; `go test ./...` in `services/control-api` (78 `_test.go` files under `internal/api`); `cargo check` on `proxyhub` (expected to fail at lib.rs:3191).
- Done when: the file lists pass/fail counts per component, so later regressions are visible.

**PREP-3 Containment check** (XS, no code, depends on D1)
- If anything is publicly reachable or funded: disable `POST /v1/wallet/transfer` and `POST /v1/provider/claim/confirm` at the proxy/WAF or by flag, confirm `PROXYHUB_ZK_ONCHAIN_GROTH16` is false, and review oracle/treasury key custody.
- Quantify prior exposure: count wallet ledger entries of type `p2p_sent` that carry a `tx_hash` (wallet.go:1162 writes it on on-chain success) and compare to platform treasury outflows.
- Done when: written answer to "has any real value already leaked?" in the baseline file.

**PREP-4 Branch layout** (XS): create `hardening/` branch prefix, decide merge order from section 12.

**PREP-5 Supersede misleading docs** (XS): add a "superseded by the 2026-10-25 audit" banner to `docs/reports/PROXYHUBB_FULL_SYSTEM_REPORT.md` and `docs/security/WHITEBOX_SECURITY_AUDIT_REPORT.md`, and a header note in `testing/fuzz_adversarial_suite.ts`, `testing/test_depin_ecosystem.ts`, `testing/test_security_hardening.mjs` stating they do not exercise production code.

---

## 6. Phase 1: P0 hotfix (Days 1-5)

Three tracks on disjoint directories. Inside each track, do items in the order listed.

### Track SC: Solana program `proxyhub`

Path: `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs`. Tests live in `services/solana-programs/proxyhub/tests/` (`critical_escrow_governance.ts` already exists).

**P1-SC-1 Make it compile** (XS) · `BC-CRIT-01` · dep PREP-1
- Append `CalculationOverflow` to the end of `EscrowError`; switch lib.rs:3191 and :3193 to it.
- Remove `|| true` at `.github/workflows/proxyhubb-ci.yml:689` in the same PR. **Found while doing this:** simply dropping `|| true` still leaves the job red, because `tests/w9a_soak.rs` needs a prebuilt `proxyhub.so` that CI never builds ("proxyhub.so missing"). The step is now split into a required `cargo check` of the program and `cargo test --lib`. The soak test moves to the Anchor build job (P1-SC-5).
- Done when: `cargo check --manifest-path services/solana-programs/proxyhub/programs/proxyhub/Cargo.toml` exits 0 and the CI job is required. **Done**, verified in a `rust:1.89-trixie` container.

**P1-SC-2 Close unauthenticated instructions** (S-M) · `BC-CRIT-02..05` · dep SC-1
- `claim_bandwidth_rewards`: require `oracle` == `program_state.admin` (or a Merkle proof against an on-chain epoch root); add a per-provider `EpochClaimReceipt` PDA, seeds `[b"epoch_claim", epoch_id_le, provider]`, created with `init` so a second claim fails; keep the pool above rent-exempt minimum.
- `multi_sig_pause_vote`: count signers from `ctx.remaining_accounts` where `is_signer` and key is in `oracle.signers`, distinct, at least the threshold; reuse `require_multisig_threshold` (~lib.rs:1938). Stop trusting the `approvals: Vec<Pubkey>` argument.
- `update_program_config`, `stake_provider`, `unstake_provider`: `constraint = oracle.key() == program_state.admin` on config; `provider_wallet: Signer` on stake/unstake; credit lamports to `provider_wallet` only (today they go to `oracle`, lib.rs:2535-2538).
- Sweep: build a table of every instruction context that has a `Signer` named oracle/authority/admin, and the constraint binding it. Audit-listed contexts to check: ~lines 1401, 1584, 3350, 3514, 3660, 3682, 3784, 3817, plus `initiate_jury_dispute`. Put the table in the PR.
- Done when: each instruction has a negative Anchor test (non-admin, wrong signer, double claim, single signer passing M pubkeys) that fails on `main` and passes after.

**P1-SC-3 Fail-closed settlement math** (XS) · `BC-HIGH-01` · dep SC-1
- Use `u128` checked arithmetic and return `CalculationOverflow` instead of `unwrap_or(0)` in: `settle_escrow_multisig` (~:2011), `settle_escrow_mutual_receipt` (~:2171), `settle_escrow` (~:2699), `compute_session_escrow_payout` (:763), `calculate_session_price` (:2400), `slash_provider_insurance` (:2583).
- Done when: a property test over amounts and byte counts up to `u64::MAX` shows `payout <= amount` and `payout + refund == amount`, and the audit's example (1 SOL, 20 GB) pays the seller the proportional amount, not 0.

**P1-SC-4 Legacy `settle_escrow`** (XS) · `BC-CRIT-08` · decision D5
- Restrict to `state.admin` (buyer/seller can no longer pick `bandwidth_used_gb`).
- Done when: buyer and seller calls fail with `Unauthorized`.

**P1-SC-5 Negative-test suite** (S, runs alongside SC-2..4): one test per fix above, in Anchor TS tests, plus Rust unit tests for the math. CI runs them (no bypass).

**P1-SC-6 Devnet redeploy and IDL** (S) · dep SC-2..5, decision D6
- Build, regenerate the IDL, diff it against the committed one. List every instruction whose signature or accounts changed (expect `unstake_provider`, `stake_provider`, `claim_bandwidth_rewards`, `multi_sig_pause_vote`) and every Go/TS call site for them.
- Upgrade devnet in place using `deploy-proxyhub-devnet.ps1`; keep the old `.so`.
- Done when: devnet program matches the repo, and the call-site list is handed to P2-ABI-1.

### Track CP: control-api (Go)

Path: `services/control-api`. Needs PREP-1 for verification.

**P1-CP-1 Stop the P2P treasury drain** (XS + care) · `BE-CRIT-01`
- Delete the enqueue block at wallet.go:558-570 (`EnqueueP2PSettle`, `ProcessCompensationOutboxOnce`). Internal transfers must only change `wallets` and ledger rows.
- Neutralize the `p2p_settle` handler at compensation_outbox.go:435-485 so it cancels rather than sends, and add a migration that marks existing pending `p2p_settle` rows cancelled. Keep the `p2p_refund` path for rows that already sent.
- Done when: a transfer test using the `sendSOLOnChainHook` mock sees zero on-chain sends, and a test with a legacy queued `p2p_settle` row also sends nothing.

**P1-CP-2 One provider payout path** (M) · `BE-CRIT-02` · decision D2
1. Same day: gate `POST /v1/provider/claim/prepare` and `/confirm` (provider_claim.go) so they return 503 unless `ENABLE_PROVIDER_CLAIM` is `true` or `1`. This stops the manual third payout immediately. **Done** (default off; the dashboard's claim button will show an error until the flag is set).
2. Short ADR (`docs/adr/0016-provider-payout-single-path.md`): which of `settleSession` (billing/worker.go:560-758), `recordProviderEarning` (provider_earnings.go:183-205), `confirmProviderClaim` stays, and how `ProviderEarning.Status` transitions.
3. Implement: one ledger credit per session guarded by an idempotency key on the session id; remove the duplicate `QueuePayout`; mark `ProviderEarning` rows paid or superseded.
4. Reconciliation script for sessions already paid more than once.
- Done when: run session → terminate → call claim pays the provider exactly 1× net earnings, and repeating terminate does not credit again.

**P1-CP-3 Reserve refill signs with the reserve key** (XS) · `BE-CRIT-05`
- Fix treasury_manager.go:573: build and sign the transfer with `reserveKey`, recipient `treasuryAddr`; reject `from == to`. Check whether `internal/solana` already has a "send from arbitrary key" helper before adding one.
- Done when: a test in `treasury_split_test.go` asserts signer == reserve pubkey and destination == `treasuryAddr`.

**P1-CP-4 Validate escrows on confirm** (S) · `BE-CRIT-03`
- In `confirmEscrow` (orders_confirm_escrow.go:173-208), `confirmSessionEscrow` (sessions_session_escrow.go:240-260) and `confirmSessionIntentEscrow` (session_intent_escrow.go:220-256): require `escrow.Amount >=` the required lamports, `escrow.BandwidthLimitGB >= order.BandwidthGB`, `Amount > 0`, and the canonical PDA address.
- Migration: unique partial index on `orders(escrow_pda)` where non-empty. **First** run a query for existing duplicates and resolve them, or the migration will fail.
- Done when: unit tests show an underfunded escrow and a reused `escrow_pda` both return 400.

**P1-CP-5 Session credentials** (S) · `BE-CRIT-04` · see correction C2 · decision D4
1. Write failing integration tests for each claimed symptom: wallet-path `createOrder` response (orders.go:520), `activateDevOrder`, `finalizeSandboxBuy`, `terminateSession` deleting the Redis key, `SessionReaper` leaving a live session alone, the lookups at usage.go:615 and metering_spill_drain.go:171.
2. Fix only what fails. Likely: restore plaintext after create/save (an `AfterCreate`/`AfterSave`, or stop mutating the struct and encrypt at the column boundary); log and surface decrypt errors instead of blanking the field; store the username in plaintext (D4) with a backfill migration for rows already encrypted.
3. Check in `main.go` that `CredentialEncryptFn`/`CredentialDecryptFn` are set before any DB access.
- Done when: all of those tests are green; symptoms that never reproduced are recorded in section 2.

**P1-CP-6 API key and token escalation** (S) · `BE-HIGH-01`, `BE-HIGH-02` (audit marks both P0)
- `updateAPIKey` (apikeys.go:267-271): apply the same `validPermissions` check that create uses (:114); only an admin role may grant `"admin"`; cap `RateLimitPerMin`.
- `pt_` provider tokens: allow-list routes (lease, node heartbeat) in middleware/supabase.go:153-161; give the JWT minted by `POST /v1/provider/auth` a `token_use: provider_node` claim that user routes reject.
- Done when: tests in `security_test.go` show a normal user cannot self-grant admin and a `pt_` token cannot call `/v1/wallet/withdraw/sol`.

### Track DP: edge-gateway and provider-node (Rust)

Verify with `cargo test` in each crate (works today).

**P1-DP-1 Secure and meter `bridge_ws`** (S) · `DP-CRIT-01`
- Path: services/edge-gateway/src/proxy/websocket.rs:87-396. Before opening the provider stream: `validate_destination` and DNS validation, session/node port and domain ACLs, `select_provider_route`, `ensure_session_intent_may_activate`. On close: `usage_tracker.record` and `authenticator.report_usage` with both directions.
- Extract the shared steps into a helper that HTTP CONNECT also calls, rather than copying them (full unification is Phase 4).
- Done when: tests show a WebSocket upgrade to a private IP or port 22 returns 403, and a valid one increments the usage tracker.

**P1-DP-2 IPv6 SSRF** (XS) · `DP-CRIT-02`
- `is_public_ipv6` (services/provider-node/src/proxy/handler.rs:442): if `ip.to_ipv4_mapped()` is `Some`, return `is_public_ipv4`. Also reject `2001:db8::/32` and `100::/64` (audit), and the embedded-IPv4 forms NAT64 `64:ff9b::/96` and 6to4 `2002::/16`.
- ~~Set the default of `GATEWAY_DNS_REBIND_CHECK` to true~~ Not done, see C8. Also added: 0.0.0.0/8 is no longer treated as public (it is what `::2`-style IPv4-compatible addresses decode to).
- Done when: unit tests show `::ffff:127.0.0.1`, `::ffff:192.168.1.1`, `::ffff:169.254.169.254` are not public. **Done**: 3 tests in `proxy::handler`, which failed before the fix.

**P1-DP-3 Remove `~/Downloads` config adoption** (XS code, S with UX) · `DP-CRIT-03` · see C6
- Remove the four call sites, then delete `config_adopt.rs`.
- Extend the existing `provider-node config install --from <path>` (see C9): it now prints `control_api_url`, the gateway list, `use_tls`, `tls_skip_verify` and `allowed_ports` (never credentials) and asks `[y/N]` when run from a terminal; `--yes` skips the prompt, piped input (`--from -`) does not prompt.
- Update the pages that currently describe the download flow: `apps/web/src/components/provider/ProviderNodeConnectPanel.tsx`, `apps/web/src/lib/provider-config.ts`, `apps/web/src/app/dashboard/provider/cli/page.tsx`, `apps/web/src/components/ProviderSetupGuide.tsx`, `apps/docs/content/provider/cli.mdx`, `docs/PROVIDER_CLI_AND_NODE_MANUAL.md`.
- Done when: `start` ignores a planted `provider-evil.toml` in `~/Downloads`, and the import command works end to end.

### Phase 1 exit: Gate G0

- [ ] `proxyhub` compiles in CI with no bypass; all SC negative tests pass
- [ ] P2P transfer, claim confirm, reserve refill, escrow confirm covered by passing tests
- [ ] Session credential tests green (or findings recorded as not reproducible)
- [ ] WS bridge, IPv6, config-adopt tests pass
- [ ] Baseline file updated; no component regressed versus PREP-2

---

## 7. Phase 2: Stabilize (Weeks 2-3) → Gate G1

Dep: Phase 1. Tracks are independent.

**P2-ABI-1 Go↔Anchor sync** (S-M) · `BC-HIGH-06` · dep P1-SC-6
- Fix in `services/control-api/internal/solana/`: event names/discriminators in watcher.go:284-381 (`EscrowInitialized`, etc.), `UsageProofSubmitted` size 92, escrow_reader.go:64 status offset (audit: 96, code reads 80), program_config.go:118 offset 34, client.go:936 `strconv.ParseUint`, HSM `PublicKey()` helpers.
- Update every call site on the list from P1-SC-6.
- Prefer generating Go bindings from the IDL (audit 38.2) over fixing offsets by hand. Add golden fixtures: account bytes serialized by the Anchor tests, parsed in Go tests.
- Done when: Go tests parse real Anchor-serialized `Escrow`, `ProgramConfig` and event logs.

**P2-ABI-2 `gateway-bond` partial slash** (S) · `BC-HIGH-04`: fix `resolve_slash` (programs/gateway-bond/src/lib.rs:196) so a partially slashed operator can still `request_unbond`/`withdraw_bond`; add a LiteSVM test.

**P2-DP-1 Cross-pod forwarding** (S) · `DP-HIGH-01`: keep buyer auth, ledger reservation, 100 MB quota and metering on the ingress pod; flush the bytes after the HTTP 101 (internal_forward.rs:99-217, main.rs:1436-1485).
**P2-DP-2 WAL double-billing** (S) · `DP-HIGH-02`: per-pod WAL ownership plus `SET lock:wal:<id> NX EX 60` before draining orphans (metering.rs:374-522).
**P2-DP-3 Registry** (S) · `DP-HIGH-06/07`: key tunnels by `node_id` not `node_{user_id}` (tunnel.rs:355, :607); `touch()` must not overwrite Geo/Quality (directory.rs:100-157).
**P2-DP-4 TrafficShaper** (S) · `DP-HIGH-03`: replace the wake-and-pend busy loop with a `tokio::time::Sleep` (qos.rs:53-133).
**P2-DP-5 Client IP trust** (S) · `DP-HIGH-05`: use the TCP peer address; honor `x-forwarded-for` only from configured trusted proxies; remove the blanket RFC1918 WAF whitelist (control-api middleware/waf.go:61).

**P2-CP-1 Auth and queue fixes** (S total)
- `BE-HIGH-03` delete `memStore` entry on SIWS login (auth.go:155). `BE-HIGH-04` reject empty `ADMIN_JWT_SECRET`, check the JTI blocklist, protect `/v1/admin/logout`. `BE-HIGH-05` unique `ZADD` member in `CheckAPIKeyRateLimit` (redis.go:405).
- `FOR UPDATE SKIP LOCKED` in compensation_outbox.go and billing/worker.go.
- `BE-MED-01` start the `ws.Hub` NATS subscription from `main.go` after `nats.Init()` (ws/hub.go:62-65).
- ~~`BE-HIGH-09` replace the 501-query `gatewaySessionHydrate`~~ Not needed, see C15.

**Acceptance**: `docker-compose.j2-multipod.yml` smoke test shows one billing per byte across pods; Go tests for each auth/rate-limit fix.

**Gate G1 (private testnet)**: G0 + P2-ABI-1 + P2-CP-1 + P2-DP-1/2 done; devnet program redeployed and indexed correctly end to end (create escrow → confirm → use → settle).

---

## 8. Phase 3: Clients, data, honest CI (Weeks 4-5) → Gate G2

- **P3-FE-1** extension `onAuthRequired`: only answer when `details.challenger.host` and port match the stored proxy (apps/extension/src/sw.ts:57-80); persist the pairing session in `chrome.storage.local`; call `enableWebRTCProtection()` on startup recovery; remove fake P2P labels (`FE-HIGH-01`).
- **P3-FE-2** web: fix `initializeTokenEscrow` expiry (`now + duration`) and `raiseDispute` PDA seeds (apps/web/src/lib/solana.ts:569, :716-724); wire `ReviewModal` to `createReview`; fix `/community/forum/new`; hide or remove the mocked `/depin` (`DePINPortal.tsx`) and `/api/proxy/test`; consolidate the four API client layers into `src/lib/api/` (`FE-HIGH-02`).
- **P3-SDK-1** Python: `body=` → `payload=` (client.py:478, :496); Go SDK timeouts and `url.PathEscape`; `phubb1.` fallback in buyer SDKs; SHA-256 verification and strict `version` regex in `sdks/provider-*` (`SDK-HIGH-01`).
- **P3-DB-1** `GDPRDeletionWorker` (anonymize or unhook append-only ledger references); automated monthly partition worker for `explorer_transactions` (partitions stop at 2026-09-01 in migration 000101, so this is already due); migration loader skips non-`.up.sql` files (migrate.go:41), fix naming or loader.
- **P3-API-1** bring `docs/openapi.yaml` in line with registered routes (audit: 140+ missing, 3 dead paths).
- **P3-TEST-1** replace the three mock scripts in `testing/` with tests that call production code (Anchor tests, Go integration tests); add CI jobs for `apps/extension` and `sdks/*`.
- **P3-CI-1** clear the remaining bypasses (section 11.2).
- **P3-INFRA-1** fix Docker healthchecks (`wget --spider` → GET), K8s `tls.pem` mapping, `config/gcp/Caddyfile` stub, add docs host (`INFRA-MED-01`).

**Gate G2 (public testnet)**: G1 + all of Phase 3 + zero unexplained CI bypasses + the load/chaos suites added in commit `bb1aa26` pass against staging.

---

## 9. Phase 4: Consolidate (Weeks 6-8)

Behavior-preserving only. One module per PR, tests green before and after.

- Split `proxyhub/src/lib.rs` (5,379 lines) into `state/`, `instructions/{escrow,session_escrow,staking,governance}.rs`, `errors.rs`; delete the duplicate gateway staking instructions (lib.rs:2925-3092) now that `programs/gateway-bond` owns that.
- Split `control-api/internal/api/` (180+ files) into domain packages with injected dependencies instead of `init.go` globals; port `RequestSizeLimiter`/`ContentTypeValidator` from `main_secure.go` into `main.go`.
- Unify `edge-gateway` HTTP, WS, SOCKS5, HTTP/3 around one `authorize_and_bridge_stream()`; add eviction tasks for the security `DashMap`s.
- Delete: `cli/`, `sdks/node/`, `services/control-api/main_secure.go`, `docker-compose.full.yml`, `docker-compose.secure.yml`, `infra/docker-compose/docker-compose.yml`, `WalletConnect.tsx`, `legacy-social-api.ts`, `@polkadot/*`, `@moonpay/moonpay-js`, `pg` from `apps/web/package.json`.
- Decide custody model (D7) and remove the losing payment generation.

Exit: no dead-code warnings in `edge-gateway`/`provider-node`; all four ingress protocols pass the same SSRF, quota and drain tests.

---

## 10. Phase 5: Crypto, governance, infra, audit (Weeks 9-12+) → Gate G3

- **Real ZK** (XL, `BC-CRIT-07`): one BN254 Groth16 circuit constraining a Poseidon Merkle root over `(session_id, bytes_up, bytes_down, seq, gateway_sig_hash)` plus byte-sum conservation; retire `services/zk-prover` (Halo2); run an external MPC setup; delete `SETUP_SEED`. Negative R1CS test: a mutated byte count must fail synthesis.
- **Reputation program** (`BC-HIGH-05`): enable `onchain-groth16` only after the above; verify the `ZKBatchPDA` discriminator; record consumed batch roots; fix `stake_tokens` (transfers 0).
- **Squads v4** (`main.go:893-905` is a log-only stub): real multisig proposals for treasury operations. Mainnet runbook already exists at `docs/operations/MAINNET_DEPLOYMENT_RUNBOOK.md`.
- **Infra**: non-root `USER` in all Dockerfiles, remove `cron &&` from `edge-gateway/Dockerfile`, remove remaining workflow bypasses, trim 16 compose files to the ones actually used.
- **External audit**: independent smart-contract and ZK review, plus a penetration test, before any mainnet deploy. Budget and schedule this in Phase 3 because auditors book weeks ahead.

**Gate G3 (mainnet)**: Phases 0-5 done, audit sign-off, soak/chaos pass on staging, multisig/HSM treasury live.

---

## 11. Cross-cutting

### 11.1 Verification commands

| Component | Command (run from repo root unless noted) |
|---|---|
| proxyhub compile | `cargo check --manifest-path services/solana-programs/proxyhub/programs/proxyhub/Cargo.toml` |
| proxyhub tests | Anchor tests in `services/solana-programs/proxyhub/tests/` via `anchor test`, or `test-anchor-local-docker.ps1` |
| gateway-bond | `cargo test --manifest-path programs/gateway-bond/Cargo.toml` |
| edge-gateway / provider-node | `cargo test --manifest-path services/<crate>/Cargo.toml` |
| control-api | `go test ./...` from `services/control-api` |
| extension | `npm test` and `npx tsc --noEmit` from `apps/extension` |
| web | `npm run typecheck`, `npm run validate:routes` from `apps/web` (after `npm ci`) |
| multi-pod | `docker compose -f docker-compose.j2-multipod.yml up` smoke script |

### 11.2 CI bypass ratchet

20 lines currently use `continue-on-error` or `|| true`: `proxyhubb-ci.yml` 8, `security.yml` 7, `cli-dist-release.yml` 4, `deploy-gcp-testnet.yml` 1. Turning them all off now would make CI red for unrelated reasons. Instead: P1-SC-1 removes the first (:689); each later item removes the bypass for the job it makes pass; P3-CI-1 handles whatever is left and documents any that are deliberate.

### 11.3 Deploy safety

- Backup Postgres before any migration that adds a constraint; run the pre-check query first.
- On-chain: devnet only, keep the prior `.so`, confirm upgrade authority before each upgrade.
- Feature-flag anything with money movement (claim confirm, P2P settle) so it can be turned off without a deploy.

---

## 12. Execution order and parallelism

Tracks SC, CP, DP touch different directories and can run in parallel (separate worktrees or sessions). Within CP, items touch different files, but migrations must be numbered in advance. Reserve the next free numbers after the current highest in `migrations/` (audit says 000153; confirm) as: CP-1 cancel `p2p_settle` rows, CP-4 unique `escrow_pda` index, CP-5 credential backfill, CP-2 earnings status.

Suggested order for one person working serially:

1. Day 0: PREP-1..5.
2. Day 1: SC-1 (+CI line), CP-1, CP-3, DP-2, DP-3 code, CP-2 step 1. All are hours each, and they close the cheapest, highest-value holes.
3. Day 2: CP-5 (tests first), CP-4.
4. Day 3: DP-1, CP-6, DP-3 UX and docs.
5. Days 4-5: SC-2, SC-3, SC-4, SC-5, SC-6; CP-2 steps 2-4.
6. Then Phase 2 → 3 → 4 → 5 in order.

---

## 13. Progress tracker

| ID | Item | Closes | Effort | Status |
|---|---|---|---|---|
| PREP-1 | Toolchains | n/a | S | ◐ Go runs in Docker; Anchor and Solana CLI not installed yet (needed for SC-2) |
| PREP-2 | Baseline run | n/a | S | ☑ see BASELINE_2026-10-25.md |
| PREP-3 | Containment check | n/a | XS | ◐ repo side done; ledger exposure and live deployment need someone with access |
| PREP-4 | Branch layout | n/a | XS | ☑ `hardening/day-1` |
| PREP-5 | Supersede misleading docs | n/a | XS | ☑ |
| P1-SC-1 | Compile fix + CI line | BC-CRIT-01 | XS | ☑ `cargo check` is now a required CI step; checked on Linux with Rust 1.89 |
| P1-SC-2 | Auth constraints | BC-CRIT-02..05 | S-M | ☐ |
| P1-SC-3 | u128 settlement math | BC-HIGH-01 | XS | ☐ |
| P1-SC-4 | Legacy settle_escrow | BC-CRIT-08 | XS | ☐ |
| P1-SC-5 | Negative tests | all SC | S | ☐ |
| P1-SC-6 | Devnet redeploy + IDL | n/a | S | ☐ |
| P1-CP-1 | P2P treasury drain | BE-CRIT-01 | XS | ☑ migration 000154 |
| P1-CP-2 | Single provider payout | BE-CRIT-02 | M | ◐ step 1 (kill switch) done; steps 2-4 open |
| P1-CP-3 | Reserve refill | BE-CRIT-05 | XS | ☑ builder unit-tested; no RPC-level test |
| P1-CP-4 | Escrow confirm checks | BE-CRIT-03 | S | ☑ migration 000155 (fails loudly if live duplicates exist); handlers need a live oracle and are not exercised |
| P1-CP-5 | Session credentials | BE-CRIT-04 | S | ☑ real causes were C13 and C14; reaper and createOrder claims not reproducible (C11, C12) |
| P1-CP-6 | API key / pt_ token | BE-HIGH-01/02 | S | ☑ JWTs minted before the change stay unrestricted until they expire (up to 30 days) |
| P1-DP-1 | WebSocket bridge | DP-CRIT-01 | S | ☑ guard unit-tested; `admit_ws_connection` and metering have no automated test (needs an `AppState`) |
| P1-DP-2 | IPv6 SSRF | DP-CRIT-02 | XS | ☑ |
| P1-DP-3 | Config adoption | DP-CRIT-03 | XS-S | ☑ |
| **G0** | P0s closed | | | ☐ |
| P2-ABI-1 | Go↔Anchor sync | BC-HIGH-06 | S-M | ☐ |
| P2-ABI-2 | gateway-bond slash | BC-HIGH-04 | S | ☐ |
| P2-DP-1..5 | Multi-pod, registry, shaper, IP trust | DP-HIGH-01/02/03/05/06/07 | S each | ☐ |
| P2-CP-1 | Auth, queue, WS hub, hydrate | BE-HIGH-03/04/05/09, BE-MED-01 | S | ☑ BE-HIGH-03/04/05 and BE-MED-01 fixed with tests that fail on main (rate limit lets 150 of 150 through at a limit of 100; an empty-secret admin token is accepted). Outbox claims use `FOR UPDATE SKIP LOCKED` plus a lease; billing settlement takes a per-session Redis lock instead (the pending bytes live in Redis, so a row lock does not apply). BE-HIGH-09 dropped (C15). The multi-pod compose smoke test was not run. |
| **G1** | Private testnet | | | ☐ |
| P3-FE-1 / FE-2 | Extension, web | FE-HIGH-01/02 | S, M | ☐ |
| P3-SDK-1 | SDK fixes | SDK-HIGH-01 | S | ☐ |
| P3-DB-1 / API-1 | DB hygiene, OpenAPI | n/a | M | ☐ |
| P3-TEST-1 / CI-1 | Real tests, CI honesty | n/a | M | ☐ |
| P3-INFRA-1 | Healthchecks, K8s, Caddy | INFRA-MED-01 | S | ☐ |
| **G2** | Public testnet | | | ☐ |
| Phase 4 | Consolidate | tech debt | L | ☐ |
| Phase 5 | ZK, Squads, infra, external audit | BC-CRIT-07, BC-HIGH-05 | XL | ☐ |
| **G3** | Mainnet | | | ☐ |
