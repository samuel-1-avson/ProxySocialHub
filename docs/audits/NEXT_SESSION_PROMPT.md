# Prompt for the next session

Paste everything below the line into a new chat started in `C:\Users\samue\OneDrive\Desktop\projects\ProxySocialHub`.

---

You are continuing a security-hardening effort on the ProxyHubb / ProxySocialHub monorepo (GitHub: samuel-1-avson/ProxySocialHub, default branch `main`). Earlier sessions turned an audit into a plan and implemented Phase 0, Phase 1 and part of Phase 2. Read these first, in this order:

1. `docs/audits/IMPLEMENTATION_PLAN.md`. Section 13 is the progress tracker, section 2 lists corrections C1-C25 (audit claims that were wrong, stale or only partly right; do not re-implement those), section 3 lists decisions D1-D7 (all running on their defaults), and sections 5-10 describe each work item (Phase 0 to Phase 5) with a "done when" test.
2. `docs/audits/BASELINE_2026-10-25.md` (what passed and failed before any change).
3. `docs/adr/0016-provider-payout-single-path.md`.
4. The source audit, `docs/audits/COMPLETE_SYSTEM_ARCHITECTURE_AND_TECHNICAL_AUDIT.md`, only when a plan item points at it.

## What is already on main

PRs 38, 40, 41, 42 and 43 are merged. Main now has: the proxyhub program compiling with `cargo check` and `cargo test --lib` required in CI; ten program instructions bound to `program_state.admin`; `claim_bandwidth_rewards` with a per-epoch receipt PDA; real-signer counting in `multi_sig_pause_vote`; u128 fail-closed payout math; legacy `settle_escrow` admin-only; the P2P treasury drain closed (migration 000154); one payout path per session (ADR 0016); the reserve-refill signer fix; escrow confirm checks (migration 000155); session credential fixes; API key and `pt_` token scoping; the edge-gateway WebSocket bridge guarded and metered; IPv6 SSRF; removal of `~/Downloads` config adoption; wallet-login challenge single use; admin auth (empty secret refused, revocable sessions, logout); API key rate limit; WebSocket hub NATS subscription; outbox row leasing and a per-session billing lock. Nothing is deployed anywhere.

## What is left, in the order I suggest

**A. Finish Gate G0 (Phase 1)**
1. P1-SC-5, the rest: CI does not run the Anchor suite. Add a CI job that builds the program and runs `services/solana-programs/proxyhub/tests/**/*.ts` plus `tests/w9a_soak.rs` (it needs a prebuilt `proxyhub.so`), with no `|| true`, and make it required. `docs/audits/verification-tools/Dockerfile.anchor` and `run-anchor-tests.sh` are a working local recipe (Solana 2.3.0, Anchor 0.32.1, Node 24.10, Rust 1.89).
2. P1-SC-6: regenerate the IDL, diff it against the committed one, and list every Go and TypeScript call site for each instruction whose accounts changed. I only updated `internal/solana/review.go`. Check the rest: `lock_session_commitment`, `create_proposal`, `open_dispute_onchain`, `initiate_jury_dispute`, `update_program_config`, `stake_provider`, `unstake_provider` now require the signer to equal `program_state.admin`, so confirm the control-api oracle key IS the program admin on devnet. `claim_bandwidth_rewards` and `log_spending_event` have no Go callers. Redeploying devnet (`services/solana-programs/proxyhub/deploy-proxyhub-devnet.ps1`) needs my keys and my explicit go-ahead; prepare everything and ask. Deploy order: control-api first, then the program upgrade.
3. Housekeeping: the plan's header still says "implemented on branch hardening/day-1" and G0 is not ticked; update them and `BASELINE_2026-10-25.md` once the above is done.

**B. Things only I can do (remind me, do not attempt)**
- PREP-3: check whether any build runs publicly or holds real funds.
- P1-CP-2 step 4: reconcile sessions that were already paid more than once (ledger credits of type `provider_earning`, `pending_payouts` keyed by `sha256(provider:wallet:session)`, and claims, against treasury outflows). It needs production data. You can write the read-only SQL and the comparison script.
- Set `ADMIN_JWT_SECRET` before deploying (an empty one now answers 503), and decide whether to enable `ENABLE_PROVIDER_CLAIM` (the claim endpoints stay off; they send treasury SOL without debiting a balance, so remove them or rebuild them as a withdrawal from the provider balance before enabling).

**C. Open on-chain items (plan corrections C22 and C23)**
- `cast_jury_vote_onchain` accepts any signer and an unchecked dispute account. Votes are not read by any on-chain payout, but an indexer counting them can be spoofed.
- `initialize_multisig_oracle`, `initialize_insurance_pool`, `initialize_price_oracle` are first-caller-wins; matters on a fresh deploy.
- `settle_escrow_mutual_receipt` multiplies `bandwidth_limit_gb` by 2^30, but control-api writes limits in micro-GiB (`EscrowUnitsPerGiB`), so the byte limit is about a million times too large for those escrows. Ask me which unit that receipt format should use before changing it.

**D. Phase 2 (Gate G1)**
- P2-ABI-1: Go↔Anchor sync (event names and discriminators in `internal/solana/watcher.go`, account offsets in `escrow_reader.go` and `program_config.go`, `client.go` ParseUint). Prefer generating bindings from the IDL; add golden fixtures serialized by the Anchor tests. Needs P1-SC-6.
- P2-ABI-2: `gateway-bond` `resolve_slash` partial-slash bug, with a LiteSVM test.
- P2-DP-1 to P2-DP-5 (Rust edge-gateway and provider-node, plus the control-api WAF whitelist): cross-pod forwarding keeps auth and metering on the ingress pod, WAL ownership lock, tunnel registry keyed by `node_id`, TrafficShaper busy loop, client IP trust.
- Not yet run: the multi-pod compose smoke test `docker-compose.j2-multipod.yml`.

**E. Smaller follow-ups I know about**
- `admit_ws_connection` and WebSocket metering have no automated test (they need a full `AppState`).
- JWTs minted before P1-CP-6 stay unrestricted until they expire (up to 30 days); admin tokens minted before the admin-auth change have no `jti` and cannot be revoked individually.
- `CheckAPIKeyRateLimit` still does check-then-add in separate Redis calls, so a burst can overshoot the limit.
- Treasury reserve refill has no RPC-level test; escrow confirm handlers need a live oracle and are not exercised.

**F. Phases 3-5** (clients and data, consolidation, ZK/Squads/infra/external audit) are in plan sections 8-10. Do not start them before G0 and G1 are closed unless I say so.

## How to work (this is what held up in earlier sessions)

- Plan first, then small batches. One branch per batch off `origin/main` (name it `hardening/<topic>`), one commit per work item, `git commit -s` (CI has a DCO check and fails without `Signed-off-by`), then a draft PR against `main`. Ask me before pushing or opening a PR; after I say yes, do it. I turn on Auto-fix per PR when I want it.
- Do not stage `apps/extension/package-lock.json` or `services/provider-node/Cargo.lock`. Those are my own uncommitted changes.
- Every fix needs a test that fails on `main` and passes on the branch. Prove the fail-on-main half with a throwaway worktree (`git worktree add --detach <dir> origin/main`, copy only the new test in, run it). If a test cannot fail on main (it calls code that does not exist there, or needs state), say so in the PR rather than implying it did.
- Before pushing, run the whole `go test -p 1 ./...` for control-api and compare the set of failing test names with a clean run of `main`. About 29 tests already fail on `main` (packages api, billing, governance, marketplace, notifications, worker); a regression once slipped through because I ran only the packages I had touched. Regenerate this baseline from a clean `main` at the start rather than trusting a number.
- Verify claims in the audit before fixing them. About a quarter did not reproduce or were stale; record those as new rows in plan section 2 instead of coding around them.
- Every PR description ends with a "Not done / not covered" list. Report failures and skipped steps plainly.
- Write multi-line files with the Write tool. A long Python heredoc through the Bash tool hung once. Windows LF/CRLF warnings from git are harmless.
- Sourcery bot comments on PRs are an upsell notice, not review feedback.

## Verification tooling (all local, all Docker)

Docker images and the Anchor image were pruned on this machine after the last session, so check what exists before relying on it.

- Go (control-api): `docs/audits/verification-tools/run-go-tests.ps1 -Src <repo or worktree> -Out <folder> -DbName <db> [-Pkg ./internal/x/ -Filter Name]`. It runs `go vet ./...` then `go test -v -p 1` in `golang:1.25` against Postgres. Create the network and database once:
  `docker network create phub-test`, then `docker run -d --name phub-test-pg --network phub-test -e POSTGRES_PASSWORD=testpw postgres:16-alpine`, then `docker exec phub-test-pg psql -U postgres -c "CREATE DATABASE <name>"`. Use a separate database per concurrent run; the tests truncate tables. Volumes `phub-gomod` and `phub-gocache` speed up repeat runs. Redis is miniredis in the tests, so no Redis container is needed.
- Anchor: `docker build -f docs/audits/verification-tools/Dockerfile.anchor -t phub-anchor-env docs/audits/verification-tools` (about 25 minutes, mostly compiling `anchor-cli`). Then `docker run --rm -v "<proxyhub dir>:/src:ro" -v "<out dir with run-anchor-tests.sh>:/out" -e MOCHA_GLOB='tests/**/*.ts' phub-anchor-env bash /out/run-anchor-tests.sh`. The build inside the container is not cached, so a run takes about 25 minutes. Run the whole glob: `tests/zz_access_control.ts` depends on state created by the earlier test files (the full suite was 72 passing).
- Rust: `cargo test` in `rust:1.89-trixie` with volumes `phub-cargo` and `phub-rust-target` for `services/edge-gateway` and `services/provider-node`. Native Windows `cargo test` of the proxyhub program fails (openssl-sys needs perl), so use the Linux container for the program's `cargo check --manifest-path services/solana-programs/proxyhub/programs/proxyhub/Cargo.toml` and `cargo test --lib`.
- Frontend and extension tests were not part of the earlier batches; start from `docs/audits/BASELINE_2026-10-25.md` for how they ran.

First step: read the files above, run `git fetch` and confirm `main` contains PRs 38-43, then tell me which of A1-A3 you will start with and what you need from me for A2. Do not start coding before that.
