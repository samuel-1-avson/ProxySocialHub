# ProxyHubb Layer 2 Blockchain — Progress Report
**Date:** 2026-04-01  
**Branch:** `main`  
**Go version:** 1.26.0  
**Report purpose:** Continuation handoff — summarises every change made across all sessions so a new chat can pick up exactly where this one left off.

---

## Table of Contents

1. [What ProxyHubb Is](#1-what-proxyhubb-is)
2. [Architecture Overview](#2-architecture-overview)
3. [Pre-Session State — What Was Broken](#3-pre-session-state--what-was-broken)
4. [Session Fixes — Groundwork (Pre-L2)](#4-session-fixes--groundwork-pre-l2)
5. [Full Supabase Removal](#5-full-supabase-removal)
6. [Ethereum Relayer Decommission](#6-ethereum-relayer-decommission)
7. [L2 Phase 2 — PHB Token Activation](#7-l2-phase-2--phb-token-activation)
8. [L2 Phase 3 — State Channels](#8-l2-phase-3--state-channels)
9. [L2 Phase 4 — ZK Proof of Service](#9-l2-phase-4--zk-proof-of-service)
10. [Governance Executor Fix](#10-governance-executor-fix)
11. [What Phase 5 Requires](#11-what-phase-5-requires)
12. [Full File Change Index](#12-full-file-change-index)
13. [Known Remaining Issues](#13-known-remaining-issues)
14. [How to Resume in a New Chat](#14-how-to-resume-in-a-new-chat)

---

## 1. What ProxyHubb Is

ProxyHubb is a **decentralised bandwidth marketplace** built on Solana.

- **Buyers** pay for HTTP/SOCKS5 proxy bandwidth in SOL (and soon PHB tokens).
- **Providers** run `provider-node` (Rust), register on-chain, serve traffic through the Edge Gateway, and earn SOL.
- **Settlement** uses Solana Anchor programs: escrow PDAs lock buyer funds; usage proofs trigger release to providers.
- **Goal:** Become a true **Layer 2 blockchain on Solana** — state channels for off-chain micropayments, ZK-proof batching for settlement, PHB as native L2 token.

### Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Go 1.26 + Gin |
| Blockchain | Solana + Anchor (Rust) |
| Edge Gateway | Rust + Tokio |
| Provider Node | Rust |
| Frontend | Next.js 16 + React 19 |
| Database | PostgreSQL (self-hosted) + Redis |
| Message Bus | NATS JetStream |
| Auth | Self-hosted JWT + Ed25519 wallet challenge |
| Storage | IPFS (proposals/governance) |

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        BUYER CLIENTS                             │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP/SOCKS5
┌──────────────────────▼───────────────────────────────────────────┐
│              EDGE GATEWAY (Rust/Tokio)                           │
│  • SOCKS5/HTTP tunnel   • Session metering (bytes/sec)          │
│  • GeoIP routing        • Circuit breaker                        │
│  • Signed usage proofs every 15 min                              │
└──────────────────────┬───────────────────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼───────────────────────────────────────────┐
│              CONTROL API (Go/Gin)                                 │
│  Sessions │ Billing │ Escrow │ KYC │ Governance │ Explorer        │
│  ZK Aggregator │ State Channels │ PHB Staking                    │
└──────┬──────────────┬──────────────────────────┬─────────────────┘
       │              │                          │
┌──────▼──────┐ ┌─────▼──────┐        ┌──────────▼──────────────┐
│  PostgreSQL │ │   Redis    │        │  SOLANA ORACLE CLIENT   │
│  (self-     │ │  (cache +  │        │  • Escrow PDAs          │
│  hosted)    │ │  pub/sub)  │        │  • Usage proofs          │
└─────────────┘ └────────────┘        │  • State channels        │
                                      │  • ZK batch roots        │
                                      │  • PHB token balances    │
                                      └──────────┬───────────────┘
                                                 │ RPC
                                      ┌──────────▼───────────────┐
                                      │   SOLANA L1 (Mainnet/    │
                                      │   Devnet)                │
                                      │   Anchor Program:        │
                                      │   proxyhub               │
                                      └──────────────────────────┘
       ┌──────────────────────────────────────────────────────────┐
       │           PROVIDER NODES (Rust)                          │
       │  • Register on-chain    • Heartbeat every 30s            │
       │  • Serve SOCKS5 traffic • Submit bandwidth proofs        │
       └──────────────────────────────────────────────────────────┘
```

---

## 3. Pre-Session State — What Was Broken

These issues were identified in a prior system analysis and were the starting point for this session:

### Critical (C-series)
| ID | Issue | Status |
|----|-------|--------|
| C-01 | Incomplete payment execution (circle pool, dispute settlement) | Partially addressed |
| C-02 | SOL price division-by-zero risk | **Fixed** (±20% bounds check on emergency price) |
| C-03 | TODO milestone rewards not gated on real usage | **Fixed** |
| C-04 | Circle pool capacity used hardcoded DB value | **Fixed** (on-chain ProviderRegistry) |
| C-05 | Payout retry ignores unsettled escrow | **Fixed** (escrow settlement check before retry) |

### High (H-series)
| ID | Issue | Status |
|----|-------|--------|
| H-01 | Multisig oracle not enforced in billing | Noted — enforced at Solana program level |
| H-02 | Escrow PDA not verified on-chain | Partially addressed via oracle checks |
| H-03 | Settlement finality not confirmed before marking complete | **Fixed** (IsEscrowSettled check) |
| H-04 | Batch payout idempotency hash missing wallet address | Prior session fix |
| H-05 | User ban check was a `return true` TODO | **Fixed** |

### Medium (M-series)
| ID | Issue | Status |
|----|-------|--------|
| M-08 | Channel deposit not verified before opening | **Fixed** (on-chain SOL balance check) |

---

## 4. Session Fixes — Groundwork (Pre-L2)

### 4a. ORACLE-002 — SOL Price Bounds Check
**File:** `services/control-api/internal/billing/price.go`

Added ±20% deviation check on the emergency SOL price env var against the in-process cache. If the emergency price deviates more than 20% from `cachedSOLPrice`, the function returns 0 (forces circuit-break) rather than accepting a potentially manipulated price.

### 4b. REP-004 — Milestone Rewards Gated on On-Chain Usage
**File:** `services/control-api/internal/api/milestones.go`

`claimMilestoneReward` now queries all escrow-backed orders for the user, calls `oracle.SumUsageProofBytes()` per escrow, and rejects with HTTP 403 if the total on-chain bytes are below `milestone.ThresholdGB * 1024³`.

### 4c. REP-005 — Circle Pool Uses ProviderRegistry On-Chain
**Files:**
- `services/control-api/internal/api/circle_pool.go`
- `services/control-api/internal/solana/provider_registry.go`

`getCirclePoolStatus` and `distributeRevenue` now read capacity from the on-chain `ProviderRegistry` PDA (`TotalBandwidthServed`) with DB `ContributedBandwidthGB` as fallback.

### 4d. FIN-002 — Escrow Settlement Verified Before Payout Retry
**File:** `services/control-api/internal/api/admin_payouts.go`

`retryFailedPayout` calls `oracle.IsEscrowSettled()` for any escrow linked to the provider's session. Returns HTTP 409 if any linked escrow is not yet settled.

### 4e. User Ban Check Fixed
**File:** `services/control-api/internal/models/user.go`

```go
// Before (broken):
func (u *User) IsActive() bool {
    return true // TODO: Check Supabase ban status
}

// After (correct):
func (u *User) IsActive() bool {
    return u.Status != UserStatusBanned && u.Status != UserStatusSuspended
}
```

### 4f. M-08 — Channel Deposit On-Chain Verification
**File:** `services/control-api/internal/billing/channel_service.go`

`OpenChannel` now:
1. Resolves the buyer's linked Solana wallet
2. Calls `oracle.GetBalance(ctx, pubkey)` to check on-chain SOL balance
3. Falls back to DB wallet balance if oracle is unavailable or wallet not linked
4. Rejects with an error if balance < `initialDeposit`

**Important fix within this session:** Method was initially written as `oracle.GetSOLBalance()` (does not exist). Corrected to `oracle.GetBalance()` (defined at `client.go:424`).

---

## 5. Full Supabase Removal

ProxyHubb was partially dependent on Supabase for:
- Auth middleware (third-party JWT validation + user sync)
- A second database connection (`SUPABASE_DATABASE_URL`) for social features
- Frontend WebSocket token lookup

**All Supabase dependencies have been removed. The system is now fully self-hosted.**

### Files Changed

| File | Change |
|------|--------|
| `services/control-api/internal/middleware/supabase.go` | Removed Supabase Auth API call (step 3 of auth chain). Auth now: local JWT → provider CLI token only. |
| `services/control-api/internal/middleware/provider_token_auth.go` | `SUPABASE_JWT_SECRET` → `JWT_SECRET` |
| `services/control-api/internal/middleware/circuitbreaker.go` | Removed `"supabase"` circuit breaker entry |
| `services/control-api/internal/config/config.go` | Removed `SupabaseURL`, `SupabaseAnonKey`, `SupabaseServiceKey` from `AuthConfig` |
| `services/control-api/internal/config/secure.go` | Removed Supabase startup validation block |
| `services/control-api/internal/db/social.go` | Replaced 170-line split-DB implementation with 15-line stub: `Social()` returns `DB` directly |
| `services/control-api/main.go` | Removed Supabase circuit breaker; `InitSocial("")` is now a no-op |
| `apps/web/src/lib/websocket.tsx` | Token lookup: `supabase.auth.getSession()` → `localStorage.getItem('proxyhubb_token')` |
| `apps/web/src/lib/supabase/client.ts` | Replaced with no-op stub |
| `apps/web/src/lib/supabase/server.ts` | Replaced with no-op stub |
| `apps/web/package.json` | Removed `@supabase/ssr` and `@supabase/supabase-js` |
| `docker-compose.yml` + `.dev.yml` + `.full.yml` + `.secure.yml` | All `SUPABASE_*` env vars removed |
| `.env` | Supabase section (14 lines + live keys) replaced with comment |

### Auth Chain (Post-Removal)
```
Request
  │
  ▼
1. ValidateToken(JWT_SECRET)  ← self-hosted JWT
  │  success → proceed
  │  fail ↓
2. validateProviderToken()    ← provider node CLI token
  │  success → proceed
  │  fail → 401
```

---

## 6. Ethereum Relayer Decommission

### Why
The Ethereum relayer (`services/relayer/`) ran alongside Solana, creating two financial truth sources:
- Two sources of financial truth (Solana escrow + Ethereum marketplace contract)
- ETH gas costs incompatible with bandwidth micropayment economics
- Zero user-facing benefit

### What Was Done

**`services/relayer/main.go`** — Replaced entire implementation with a tombstone:
```go
func main() {
    log.Println("ERROR: The Ethereum relayer has been decommissioned.")
    log.Println("All payouts now route through the Solana oracle (control-api).")
    log.Println("Remove this service from your deployment. It does nothing.")
    os.Exit(1)
}
```

**`services/control-api/internal/governance/executor.go`** — Treasury transfers for non-SOL currencies previously queued to `pending_relayer`. Now they return an explicit error:
```go
if transfer.Currency != "SOL" {
    db.DB.Model(&txRecord).Update("status", "failed_unsupported_currency")
    return fmt.Errorf("treasury transfers only support SOL; currency %q is not supported (Ethereum relayer decommissioned)", transfer.Currency)
}
```

### Remaining Ethereum References (Intentional — Keep)
- `linked_wallets.go` + `crypto.go` + `crypto/signer.go` — ETH wallet linking for **identity** (users proving ownership of an ETH address). Multi-chain identity is fine; only payments are Solana-exclusive.
- `models/blockchain.go` — `ChainEthereum` enum value, needed for identity records.

---

## 7. L2 Phase 2 — PHB Token Activation

**Goal:** Wire `PHB_TOKEN_MINT` (SPL token) into governance and staking so the system starts using PHB as a governance/stake token.

### 7a. Config
**File:** `services/control-api/internal/config/config.go`

Added `PHBTokenMint string` to `BlockchainConfig`. Loaded from `PHB_TOKEN_MINT` env var (already exists in `.env` but was empty/unused).

### 7b. Governance — PHB Minimum to Propose
**File:** `services/control-api/internal/api/governance.go`

`createProposal` now requires ≥ 100 PHB on-chain balance to create a governance proposal (when `PHB_TOKEN_MINT` is set):
```
100 PHB = 100_000_000_000 raw units (9 decimals)
```
Uses `oracle.GetTokenBalance(ctx, walletPK, mintKey)`.

### 7c. Governance — PHB Voting Weight
**File:** `services/control-api/internal/api/governance.go`

`castVote` now adds PHB on-chain balance to voting power:
```
votingPower = 1.0 (base)
           + staked SOL (capped 10,000)
           + PHB balance in tokens (capped 10,000)
```

### 7d. PHB Staking Endpoints
**File:** `services/control-api/internal/api/staking.go`

Two new routes added:
- `POST /staking/phb/stake` — verifies PHB on-chain, records `StakingPosition(Currency='PHB')`, boosts node quality score (1 PHB = 0.5 quality points)
- `POST /staking/phb/unstake?position_id=...` — clears position, reduces quality score

**Verification:** PHB balance checked via `oracle.GetTokenBalance()` before accepting stake. Tokens remain in the user's wallet until Phase 5 (on-chain vault escrow via Solana program).

---

## 8. L2 Phase 3 — State Channels

**Goal:** SOL deposits for off-chain micropayments are now custodied by the Solana program PDA, not just tracked in the DB.

### 8a. Solana Program — New Instructions
**File:** `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs`

Added two Anchor instructions:

#### `open_channel`
```
PDA seeds: ["state_channel", session_id (16 bytes)]
Accounts:  buyer (signer), provider_wallet, channel PDA, system_program, program_state
Effect:    Transfers deposit_lamports from buyer to the channel PDA vault
```

#### `close_channel`
```
Accounts:  oracle (signer/admin), channel PDA, provider_wallet, buyer, system_program, program_state
Effect:    Pays earned_lamports to provider; refunds remainder to buyer
```

Added `ChannelPDA` account struct (130 bytes):
```
session_id(16) + buyer(32) + provider(32) + deposit(8) + spent(8) +
nonce(8) + opened_at(8) + expires_at(8) + is_closed(1) + bump(1)
```

### 8b. Oracle Client — Channel Methods
**File:** `services/control-api/internal/solana/channel.go` *(new file)*

- `GetChannelPDA(sessionID)` — derives the on-chain PDA
- `OpenChannelOnChain(ctx, sessionID, buyer, provider, deposit)` → `(sig, pda, err)`
- `CloseChannelOnChain(ctx, sessionID, provider, buyer, nonce, earned)` → `(sig, err)`
- `IsChannelOpen(ctx, sessionID)` → `(bool, err)` — checks PDA is_closed byte
- `buildAndSendInstruction(ctx, data, accounts)` — shared TX builder (reused by ZK batch too)

### 8c. Channel Service — On-Chain Integration
**File:** `services/control-api/internal/billing/channel_service.go`

`OpenChannel` now fires a goroutine after DB creation to lock SOL on-chain:
```
DB channel created → goroutine → OpenChannelOnChain → persist onchain_pda + onchain_tx_sig
```
Non-fatal: if on-chain lock fails, the channel still works off-chain (graceful degradation).

New `CloseChannel(channelID, finalState)` method:
1. Verifies buyer's Ed25519 signature on the final state
2. Marks channel closed in DB
3. Fires goroutine to call `CloseChannelOnChain` — pays provider, refunds buyer

### 8d. Channel API — Close Endpoint
**File:** `services/control-api/internal/api/channel.go`

Added `POST /channels/close` endpoint. Authorization: only buyer or provider of that channel may call it.

### 8e. Model + Migration
**File:** `services/control-api/internal/models/state_channel.go`

Added `OnchainPDA string` and `OnchainTxSig string` fields.

**File:** `services/control-api/migrations/20260401_l2_phase4_zk_batch.up.sql`

`ALTER TABLE state_channels ADD COLUMN IF NOT EXISTS onchain_pda VARCHAR(44), onchain_tx_sig VARCHAR(88)`

---

## 9. L2 Phase 4 — ZK Proof of Service

**Goal:** Replace N individual `submit_usage_proof` Solana TXes with a single Merkle-root commitment TX per batch window. This is the core L2 scaling mechanism.

### Architecture

```
Edge Gateway
  │ signed usage proofs (every 15 min per session)
  ▼
POST /zk/batch/submit
  │
  ▼
zk.Prover.GenerateBatchProof(leaves)
  │  Each leaf = SHA-256(session_id ‖ bytes ‖ start ‖ end ‖ buyer_sig ‖ provider_sig)
  │  Root = Merkle tree root over all leaves
  ▼
oracle.SubmitZKBatch(ctx, {root, count, bytes, window})
  │  One Solana TX: seeds=["zk_batch", root]
  ▼
ZKBatchPDA on-chain (immutable, tamper-proof)
  │
  ▼
DB: usage_proofs.status = "on_chain", zk_batches record created
```

### 9a. ZK Prover
**File:** `services/control-api/internal/zk/prover.go` *(new file)*

- `Prover.GenerateBatchProof([]ProofLeaf)` — deterministic SHA-256 Merkle tree
- `VerifyLeafInclusion(batch, leaf)` — dispute resolution / audit inclusion proof
- **Upgrade path noted:** Replace `computeLeaf` / `merkleRoot` with Poseidon hash (ZK-friendly) + Halo2 proof generation in Phase 5. `BatchProof.Proof []byte` field is reserved for this.

**Tests:** `services/control-api/internal/zk/prover_test.go` — 5 tests, all passing:
```
TestGenerateBatchProof_Single        PASS
TestGenerateBatchProof_Multiple      PASS
TestVerifyLeafInclusion              PASS
TestGenerateBatchProof_Empty         PASS
TestMerkleRoot_Deterministic         PASS
```

### 9b. ZK Batch Model
**File:** `services/control-api/internal/models/zk_batch.go` *(new file)*

```go
type ZKBatch struct {
    BatchRoot    string        // hex [32]byte — unique index
    SessionCount uint32
    TotalBytes   uint64
    PeriodStart  time.Time
    PeriodEnd    time.Time
    OnChainTxSig string
    ProofBytes   []byte        // nil until Phase 5 Halo2 integration
    Status       ZKBatchStatus // pending | submitted | confirmed | failed
}
```

### 9c. Solana Program — `submit_zk_batch` Instruction
**File:** `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs`

```
PDA seeds: ["zk_batch", batch_root (32 bytes)]
Accounts:  oracle (signer), zk_batch PDA, system_program, program_state
Stores:    batch_root, session_count, total_bytes, period_start, period_end, submitted_at
```

`ZKBatchPDA` size: 77 bytes. Using `init` (not `init_if_needed`) — duplicate submissions are rejected at PDA creation (idempotency).

### 9d. Oracle Client — ZK Batch Methods
**File:** `services/control-api/internal/solana/zk_batch.go` *(new file)*

- `GetZKBatchPDA(batchRoot)` — PDA derivation
- `SubmitZKBatch(ctx, params)` → `(sig, pda, err)`
- `IsZKBatchAnchored(ctx, batchRoot)` — idempotency check before submission
- `ZKBatchRootHex(root)` — hex encoding helper

### 9e. ZK Aggregator (Fully Rewritten)
**File:** `services/control-api/internal/billing/zk_aggregator.go`

Previous version called `SubmitUsageProof` once per session (N TXes).  
New version:
1. Fetches all `signed` proofs (up to 50)
2. Builds `ProofLeaf` for each (decodes base58 signatures)
3. Calls `GenerateBatchProof` → single Merkle root
4. Idempotency check via `IsZKBatchAnchored`
5. Calls `SubmitZKBatch` → **1 TX for the whole batch**
6. DB transaction: marks all proofs `on_chain`, creates `ZKBatch` audit record

New `SubmitBatchDirect(ctx, batch, rootHex)` method — called inline by the API endpoint for immediate settlement.

### 9f. ZK Reputation Endpoints (501 Stubs Replaced)
**File:** `services/control-api/internal/api/zk_reputation.go`

Previous: two endpoints returning `501 Not Implemented`.  
Now:

| Endpoint | Description |
|---|---|
| `POST /zk/batch/submit` | Edge gateway submits signed proof batch; server generates root, persists ZKBatch, triggers async on-chain settlement |
| `GET /zk/batch/:root` | Returns ZKBatch DB record by hex root |
| `GET /reputation/telemetry` | User's on-chain settlement history (joined from usage_proofs + sessions) |

### 9g. Migration
**File:** `services/control-api/migrations/20260401_l2_phase4_zk_batch.up.sql`

Creates `zk_batches` table with unique index on `batch_root`.

---

## 10. Governance Executor Fix

**File:** `services/control-api/internal/governance/executor.go`

Previously, non-SOL governance treasury transfers (USDC, TAO) were queued with status `pending_relayer`. Since the relayer is decommissioned, those transfers would silently stall forever.

**Fix:** Non-SOL transfers now fail immediately with `failed_unsupported_currency` status and a clear error message. Governance proposals must use SOL for treasury transfers.

---

## 11. What Phase 5 Requires

Phase 5 is **Full L2** — ProxyHubb as a sovereign Layer 2 on Solana. These items are not yet started.

### 11a. Real Halo2 ZK Proofs (Replace Phase 4 Commitments)
**What:** The current `zk/prover.go` uses SHA-256 Merkle roots (commitment scheme, not ZK). Phase 5 replaces these with actual Halo2 proofs.

**How:**
1. Write a Halo2 circuit in Rust (`services/zk-prover/`):
   ```rust
   // Circuit: prove knowledge of N (session_id, bytes, sigs) such that
   // Poseidon(leaves) == public_root, without revealing individual sessions
   circuit BandwidthBatch {
       private: leaves: [ProofLeaf; N]
       public:  root: [u8; 32], total_bytes: u64
   }
   ```
2. Compile to WASM or expose as a gRPC service
3. Call from `zk_aggregator.go` to populate `BatchProof.Proof`
4. Add on-chain Halo2 verifier to Anchor program (uses Solana's `alt_bn128` syscall)

**Files to create:**
- `services/zk-prover/` — Rust crate with `halo2_proofs` dependency
- `services/control-api/internal/zk/halo2_client.go` — gRPC client to the prover

### 11b. PHB as L2 Gas Token
**What:** PHB SPL token becomes the fee currency for all L2 operations.

**How:**
1. Activate `PHB_TOKEN_MINT` in `.env` with the deployed mint address
2. Update `session.go` — charge session fees in PHB (via `GetTokenBalance` + ATA transfer)
3. Update `escrow.go` — accept PHB deposits in addition to SOL
4. Add Anchor instruction: `initialize_phb_vault` — PHB ATA escrow for the program
5. Governance quorum denominated in PHB (replace SOL stake quorum)

**Files to modify:**
- `services/control-api/internal/api/session.go`
- `services/control-api/internal/api/escrow.go`
- `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` (new `initialize_phb_vault`, `deposit_phb`, `release_phb` instructions)

### 11c. PHB On-Chain Vault for Staking
**What:** Current PHB staking is a DB commitment only (tokens stay in wallet). Phase 5 locks them in a Solana vault.

**How:**
1. Add `stake_phb` Anchor instruction — moves PHB from staker's ATA to program vault PDA
2. Add `unstake_phb` Anchor instruction — 7-day cooldown, then releases from vault
3. Update `staking.go` to call the on-chain instruction instead of just recording DB position

**Files to modify:**
- `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs`
- `services/control-api/internal/api/staking.go`
- `services/control-api/internal/solana/` (new `phb_vault.go`)

### 11d. ProxyHubb Sequencer
**What:** A sequencer orders bandwidth transactions before they reach Solana L1, enabling higher throughput.

**How:**
1. Create `services/sequencer/` (Go service)
2. Sequencer receives signed state channel updates from the Edge Gateway
3. Batches them (N updates → 1 on-chain settlement per epoch)
4. Providers stake PHB to become sequencer validators; earn sequencer fees
5. Sequencer publishes epoch roots to Solana via `submit_zk_batch`

**New service:** `services/sequencer/main.go`

### 11e. L1 ↔ L2 Bridge (SOL ↔ PHB)
**What:** Users move SOL from Solana L1 into the L2 (where it's represented as a balance in the state channel system) and withdraw back.

**How:**
1. Add `bridge_deposit` Anchor instruction — locks SOL on L1, emits event
2. Sequencer sees the event, credits buyer's L2 balance
3. Add `bridge_withdraw` Anchor instruction — burns L2 credit, releases SOL from L1 vault
4. Frontend bridge UI in `apps/web/`

### 11f. Provider-as-Validator
**What:** Providers who stake ≥ minimum PHB become L2 validators — they validate state channel transitions and earn additional validator fees.

**How:**
1. Add `register_validator` Anchor instruction (requires PHB stake ≥ threshold)
2. Validators sign off on each epoch's ZK batch before the sequencer submits it
3. Slashing: if validator signs invalid batch, PHB stake is slashed via `slash_validator`
4. Extend `provider-node/` CLI to include validator keypair signing

---

## 12. Full File Change Index

### New Files Created This Session

| File | Purpose |
|------|---------|
| `services/control-api/internal/solana/channel.go` | On-chain state channel open/close/query |
| `services/control-api/internal/solana/zk_batch.go` | On-chain ZK batch root submission |
| `services/control-api/internal/zk/prover.go` | Merkle batch proof generation |
| `services/control-api/internal/zk/prover_test.go` | ZK prover unit tests (5 passing) |
| `services/control-api/internal/models/zk_batch.go` | ZKBatch DB model |
| `services/control-api/migrations/20260401_l2_phase4_zk_batch.up.sql` | zk_batches table + state_channels columns |

### Modified Files This Session

| File | What Changed |
|------|-------------|
| `services/control-api/internal/billing/channel_service.go` | On-chain lock goroutine in OpenChannel; new CloseChannel method |
| `services/control-api/internal/billing/zk_aggregator.go` | Full rewrite — batch proof path replacing per-session calls |
| `services/control-api/internal/api/channel.go` | Added POST /channels/close endpoint |
| `services/control-api/internal/api/staking.go` | Added PHB stake/unstake endpoints |
| `services/control-api/internal/api/governance.go` | PHB min-balance to propose; PHB vote weight |
| `services/control-api/internal/api/zk_reputation.go` | Replaced 501 stubs with real ZK batch endpoints |
| `services/control-api/internal/config/config.go` | Added PHBTokenMint to BlockchainConfig; removed Supabase fields |
| `services/control-api/internal/config/secure.go` | Removed Supabase startup validation |
| `services/control-api/internal/middleware/supabase.go` | Removed Supabase Auth API call |
| `services/control-api/internal/middleware/circuitbreaker.go` | Removed supabase circuit breaker |
| `services/control-api/internal/middleware/provider_token_auth.go` | JWT_SECRET env var rename |
| `services/control-api/internal/db/social.go` | Simplified to use main DB |
| `services/control-api/internal/models/user.go` | Fixed IsActive() ban check |
| `services/control-api/internal/models/state_channel.go` | Added OnchainPDA, OnchainTxSig fields |
| `services/control-api/internal/governance/executor.go` | Non-SOL treasury transfers fail explicitly |
| `services/control-api/main.go` | Removed Supabase circuit breaker, simplified InitSocial |
| `services/relayer/main.go` | Replaced with decommission tombstone |
| `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` | Added: open_channel, close_channel, submit_zk_batch instructions + ChannelPDA, ZKBatchPDA structs |
| `apps/web/src/lib/websocket.tsx` | Token from localStorage instead of Supabase session |
| `apps/web/src/lib/supabase/client.ts` | No-op stub |
| `apps/web/src/lib/supabase/server.ts` | No-op stub |
| `apps/web/package.json` | Removed @supabase/* packages |
| `docker-compose.yml` (+ .dev, .full, .secure) | Removed all SUPABASE_* env vars |
| `.env` | Removed Supabase section |

---

## 13. Known Remaining Issues

These were identified earlier but not yet addressed. Tackle in the next session if time allows before Phase 5.

### Low Priority (L-series)

| ID | Issue | File | Fix |
|----|-------|------|-----|
| L-01 | Circuit breaker pause state not persisted to Redis | `internal/middleware/circuitbreaker.go` | Save state to Redis key on state change; reload on startup |
| L-02 | No cascade deletes for follows/notifications when user is deleted | DB schema | Add `ON DELETE CASCADE` to social FK constraints |
| L-03 | Stale node cleanup (nodes that haven't heartbeated in 24h remain `is_healthy=true`) | `internal/worker/` | Add periodic worker that sets `is_healthy=false` for nodes with `last_heartbeat < NOW() - 24h` |
| L-04 | Response time estimation is hardcoded in listing social | `internal/api/listings.go` | Pull from real session latency metrics |
| L-05 | Notification deduplication missing | `internal/api/notifications.go` | Add unique constraint on (user_id, type, reference_id) |

### Cargo Build Issue (Pre-existing, Not Introduced Here)

```
error: failed to select a version for `solana-instruction`
anchor-lang v0.32.1 → solana-instruction ^2  (selects 2.3.3)
anchor-spl  v0.32.1 → spl-token-2022 v8 → solana-zk-sdk v2.2.0 → solana-instruction =2.2.1
```

This is a known upstream incompatibility between `anchor-lang 0.32.1` and `anchor-spl 0.32.1` on current Solana toolchain. **This was pre-existing before any changes in this session.** Fix: pin `anchor-spl` to a compatible version or wait for Anchor 0.32.2.

---

## 14. How to Resume in a New Chat

### Context to Give the New Chat

Copy and paste the following as your first message:

---

> I'm working on the ProxyHubb project at `f:/project/proxyhubb`. This is a decentralised bandwidth marketplace being upgraded to a Layer 2 blockchain on Solana.
>
> **Completed work (do not redo):**
> - All Supabase dependencies removed — system is fully self-hosted
> - Ethereum relayer decommissioned — all payments via Solana oracle
> - L2 Phase 2: PHB token activated in governance (100 PHB min to propose, PHB vote weight) and staking (PHB stake endpoints)
> - L2 Phase 3: State channels — `open_channel` and `close_channel` Anchor instructions added to `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs`; Go oracle client in `services/control-api/internal/solana/channel.go`; billing service closes channels on-chain
> - L2 Phase 4: ZK batch proof — `submit_zk_batch` Anchor instruction, `zk/prover.go` Merkle tree, `solana/zk_batch.go` oracle client, `billing/zk_aggregator.go` rewritten for batch, `/zk/batch/submit` API endpoint
> - All builds pass: `cd services/control-api && go build ./...` exits clean
> - ZK prover tests: 5/5 passing
>
> **Next task — L2 Phase 5:**
> The detailed plan for Phase 5 is in `f:/project/proxyhubb/PROXYHUBB_L2_PROGRESS_REPORT.md` section 11.
> Please start with **Phase 5a: Real Halo2 ZK Proofs** — create the `services/zk-prover/` Rust crate and wire it into the aggregator.
>
> Key files to read first:
> - `services/control-api/internal/zk/prover.go` (current SHA-256 implementation to replace)
> - `services/control-api/internal/billing/zk_aggregator.go` (calls prover — needs Halo2 wired in)
> - `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` (Anchor program — needs Halo2 verifier instruction)
> - `PROXYHUBB_L2_PROGRESS_REPORT.md` (this file — full context)

---

### Build Verification Commands

```bash
# Verify control-api builds clean
cd f:/project/proxyhubb/services/control-api && go build ./...

# Run ZK prover tests
cd f:/project/proxyhubb/services/control-api && go test ./internal/zk/... -v

# Check for any remaining Supabase references (should be only no-op stubs)
grep -rn "SUPABASE_URL\|supabase.auth" f:/project/proxyhubb --include="*.go" --include="*.ts" | grep -v stub | grep -v vendor

# Confirm relayer tombstone
head -5 f:/project/proxyhubb/services/relayer/main.go
```

### Environment Variables to Set for PHB Activation

```env
# Set this to your deployed SPL token mint address to activate PHB
PHB_TOKEN_MINT=<your_mint_address>

# These should already be set
JWT_SECRET=<your_secret>
DATABASE_URL=<your_postgres_url>
ORACLE_PRIVATE_KEY=<base58_ed25519_keypair>
SOLANA_RPC_URL=<mainnet_or_devnet_rpc>
```

---

*Report generated: 2026-04-01 | ProxyHubb L2 — Phase 4 complete, Phase 5 ready to begin*
