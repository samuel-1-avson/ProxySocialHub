# 11 — Blockchain & Smart Contract Audit

**Chains:** Solana only (live). EVM path decommissioned (`services/relayer` exits 1; ETH deposits return "not implemented" — `crypto.go:441-444`).

| Item | Value |
|------|-------|
| proxyhub program | `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7` (Anchor.toml, compose) |
| session program | `tmzUysj3y6TFrkVZ3yfQB2DSSXPjq1VQhhufryrbKEy` (legacy ID) — **unsafe; undeployed by policy** (see docs/custody-split.md) |
| reputation program | `PHub1111…` placeholder — stub |
| Default cluster | devnet (compose), mainnet-beta (prod compose) |
| **Program-ID drift** | dev compose + web default use `9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2` (BC-10) |

## 1. Component Inventory

| Component | Status | Notes |
|-----------|--------|-------|
| proxyhub Anchor program | **Partial-secure; payout binding fixed this audit** | escrow, multisig oracle, staking, registry, KYC attestation, governance, jury, price oracle, ZK batch anchor, channels |
| session Anchor program | **Unsafe to deploy** | BC-03/04 below |
| reputation program | Stub/disconnected | fake ID, no token CPI, `_proof_data` unused |
| control-api Solana oracle (Go) | Implemented | RPC client w/ failover, SettleEscrow, SendSOL, watcher, attestations, velocity guard, KMS option |
| Deposit/withdraw API | Implemented | `crypto.go`, `wallet.go` |
| Treasury reconciliation | Implemented | hourly worker + history table |
| zk-prover (Halo2 HTTP) | Scaffold | on-chain verifies oracle ed25519 over root, **not** Halo2 proofs |
| Frontend Solana (wallet adapter, escrow UX) | Production path | devnet helpers at repo root are dev-only |

## 2. Smart Contract Findings (each verified by direct read)

### BC-01 — Escrow settle payout accounts unconstrained — **FIXED (source), redeploy required**
- **Severity:** Critical. **Confidence:** Confirmed (static + handler trace).
- `SettleEscrow` (lib.rs:3415): `buyer`/`seller` were `/// CHECK` with no binding; handler allows authority = buyer OR seller OR admin (lib.rs:2094-2097) → **a buyer could settle and pass their own account as the seller recipient**, stealing the payout; a compromised oracle could redirect anything.
- Same defect in `SettleEscrowMultiSig` (lib.rs:3272).
- **Fix applied:** `#[account(mut, address = escrow.buyer)]` / `address = escrow.seller` on both structs. Go oracle already passes real escrow buyer/seller (`settlement.go:262-286`, `multisig_oracle.go:377+`) → backward compatible, fail-closed. `cargo check` passes (anchor 0.32.1).

### BC-02 — Jury verdict payout accounts unconstrained + jury/escrow mismatch — **FIXED (source)**
- **Severity:** Critical. `ExecuteJuryVerdict` (lib.rs:3339) had unconstrained `escrow`, `buyer`, `seller`: a caller could pair a resolved jury with an arbitrary escrow and arbitrary recipients.
- **Fix applied:** `constraint = escrow.key() == jury.escrow` + address binding on both payout accounts.

### BC-03 — Session program: `complete_session` any signer as "oracle"
- **Severity:** Critical (if deployed). `CompleteSession.oracle: Signer` (session/src/lib.rs:507-509) has **no constraint**; anyone can finalize any session and force the payout split (f64 math at ~279-335 compounds it). Payout accounts *are* bound (`address = session.buyer/provider`), so theft is limited to timing/ratio manipulation.
- **Remediation (not applied — structural):** add `Config` PDA (`seeds=[b"config"]`, fields `admin`, `treasury`) + `initialize_config`; constrain `oracle` via `address = config.admin`; replace f64 with u64 lamport math.

### BC-04 — Session program: `slash_gateway` any "admin", arbitrary treasury
- **Severity:** Critical (if deployed). `SlashGateway.admin: Signer` and `treasury: UncheckedAccount` unconstrained (session/src/lib.rs:565-578) → anyone can slash a gateway's stake **to their own account**. Direct theft.
- **Remediation (not applied):** same Config PDA; `admin: Signer` + `address = config.admin`; `treasury: UncheckedAccount` + `address = config.treasury`.

### BC-05 — `submit_usage_proof` / `write_kyc_attestation` lack admin binding
- **Severity:** High. Any fee-paying signer can anchor fake usage proofs / forge KYC attestations (contrast: `register_provider` checks `oracle == state.admin`). Add `require!(oracle.key() == state.admin)` or `address = program_state.admin`. **Remediation planned, not applied** (needs client-side signer alignment review).

### BC-06 — Multisig settle doesn't bump oracle nonce — **RESOLVED 2026-08-08**
- **Severity:** Medium (was). Program now `checked_add`s multisig nonce after settle; amount-gated `escrow_multisig` path live; control-api release / auto-release / usage / outbox all route through `SettleOrderEscrow(Usage)`. Evidence: `docs/ops/evidence/BC06_multisig_settle_20260808T152500Z.md`, `BC06_multisig_settle_ext_20260808T155500Z.md`.

### BC-07 — Deposit confirmation = `confirmed`, not `finalized`
- **Severity:** Medium. `verify.go:84`. Reorg can theoretically reverse a credited deposit. Use `finalized` (or N-confirmation wait) for the credit path.

### BC-08 — Custodial oracle hot wallet doubles as deposit treasury — **RESOLVED 2026-08-08**
- **Severity:** High (ops, was). Live gcp-testnet: deposit vault PDA ≠ hot ≠ oracle ≠ cold; GCP KMS fail-closed for oracle+hot; align-to-oracle script gated. Evidence: `docs/ops/evidence/BC08_custody_split_20260808T162345Z.md` (and S7 pack).

### BC-09 — Real keypair files on local disk (not git-tracked)
- **Severity:** High (ops). `treasury-keypair.json` (229B), `infra/oracle-keypair.json` (227B) contain real 64-byte keypairs; root `oracle-keypair.json` is an empty placeholder; `jwt.txt` holds token material. All gitignored (`*keypair*.json`, `*.txt` patterns) — **no keys committed to git** (verified `git ls-files`). Rotate any key that ever secured funded accounts; move to secret manager.

### BC-10 — Program ID defaults diverge across stacks — **RESOLVED 2026-07-30**
- **Severity:** Medium (was). Preflight checks for the redeploy found: `2yDR…Dd7` **never existed on devnet** (account not found); `9MrpH…Faob2` exists but is **not a program**. All 16 repo references (declare_id!, Anchor.toml, 4 compose files, control-api `client.go`, web `solana.ts` + Dockerfile, env examples, e2e scripts, load tests) now uniformly use the new deployment ID `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`, and the patched build + 38/38 localnet suite were re-verified under that ID.

### BC-11 — Reputation / on-chain ZK verification incomplete — **PARTIAL 2026-08-08 (Sprint A)**
- **Severity:** Medium. Sprint A: stable Halo2 SRS + `/v1/verify` + verify-before-submit + reputation crate rebuild (oracle-gated, not deployable). On-chain still Ed25519 over Merkle root — **not** Groth16. See `docs/ops/BC11_GROTH16_PATH.md`, `docs/ops/evidence/BC11_sprintA_*.md`.

### BC-12 — Relayer dead but present
- **Severity:** Low. Archive or remove from deploy docs.

### BC-13 — admin-cli destructive DB drop unguarded — **RESOLVED 2026-08-08**
- **Severity:** Medium (ops, was). `CleanupDb` now requires `PROXYHUB_ALLOW_DESTRUCTIVE_ADMIN` + `PROXYHUB_CONFIRM_DROP_TABLES=DROP_TABLES` and refuses `APP_ENV=production|prod`. Evidence: `docs/ops/evidence/BC13_admin_cli_cleanup_guards_20260808T155500Z.md`.

## 3. Off-chain ↔ On-chain Trace (verified)

```
deposit: user → treasury addr → POST /v1/wallet/deposit/crypto {tx}
  → RPC getTransaction (confirmed) → unique reference → CreditSOL ✅
withdraw: POST /v1/wallet/withdraw/sol → lock+debit+ledger → oracle.SendSOL → compensate on fail ✅
escrow: frontend funds PDA → release → oracle settle_escrow (accounts: oracle/escrow/buyer/seller/state)
  → watcher/indexer → explorer ✅ (payout binding fixed)
metering: OFF-CHAIN only (correct) → periodic submit_usage_proof / submit_zk_batch (sparse anchoring) ✅
```

**RPC outage impact:** deposits/withdrawals/escrow init/settle/watcher stall; credited balances and active proxy sessions continue until payout/settlement needed. Failover helper exists; no queued retry for settle (fire-and-forget in `usage.go`).

**Reorg handling:** confirmed-level credit (BC-07); unique tx-hash dedup; reconciliation events unique `(source,event_type,escrow_pda,tx_signature)`. No multi-confirmation wait, no dropped/replaced-tx handling beyond watcher rescan.

## 4. Blockchain Necessity Assessment

On-chain is **load-bearing only for money movement and escrow** — appropriate. High-frequency metering is off-chain (correct). Recommend keeping it that way: periodic verifiable settlement (batched proofs) rather than per-session on-chain writes; reputation/ZK are not yet real and should not be marketed as such.
