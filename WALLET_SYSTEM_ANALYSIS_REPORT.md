# ProxyHubb Wallet System Analysis Report

**Date:** 2026-03-14
**Scope:** Full wallet subsystem — models, API handlers, billing engine, Solana integration, linked wallets, payout retries, and escrow settlement
**Status:** Production-critical review

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram (Textual)](#2-architecture-diagram)
3. [Component Breakdown](#3-component-breakdown)
   - 3.1 Wallet Model & Database Schema
   - 3.2 Wallet API Endpoints
   - 3.3 Billing & Settlement Engine
   - 3.4 Solana Oracle & On-Chain Settlement
   - 3.5 Linked Wallets
   - 3.6 Payout Retry System
   - 3.7 Escrow & Disputes
   - 3.8 Price Oracle
4. [How the Wallet System Works End-to-End](#4-end-to-end-flow)
5. [What Is Wired Correctly](#5-what-is-wired-correctly)
6. [Issues, Bugs, and Cons](#6-issues-bugs-and-cons)
7. [Recommendations & Enhancements](#7-recommendations-and-enhancements)
8. [Priority Matrix](#8-priority-matrix)

---

## 1. System Overview

ProxyHubb operates a **custodial multi-currency wallet** for every registered user. This wallet tracks three currency balances internally:

| Field | Column | Purpose |
|---|---|---|
| `BalanceSOL` | `balance_sol` | Primary currency. Used for proxy billing, provider earnings, and on-chain payouts |
| `BalanceGHS` | `balance` | Legacy fiat currency (Ghana Cedi). Received via Paystack MoMo. Being phased out |
| `BalanceUSDT` | `balance_usdt` | Stablecoin reference balance. Present in schema but not fully active in code |

Wallets are **custodial**: ProxyHubb holds funds on behalf of users in a treasury account. On-chain transfers (SOL withdrawals, provider payouts) are executed by an **oracle keypair** that signs transactions on behalf of the platform.

---

## 2. Architecture Diagram

```
User (Browser / App)
        │
        ▼
  [Next.js Frontend]
        │ REST API calls
        ▼
  [Control API — Gin/Go]
        │
  ┌─────┴──────────────────────────────────────────────────┐
  │                    WALLET SUBSYSTEM                     │
  │                                                         │
  │  api/wallet.go          ←── User-facing CRUD           │
  │  api/linked_wallets.go  ←── Blockchain wallet linking  │
  │                                                         │
  │  billing/worker.go      ←── Hourly settlement          │
  │  billing/aggregator.go  ←── Usage aggregation          │
  │  billing/price.go       ←── SOL price oracle           │
  │                                                         │
  │  solana/settlement.go   ←── On-chain escrow ops        │
  │  solana/activator.go    ←── Escrow event listener      │
  │  solana/client.go       ←── Oracle RPC client          │
  └─────────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
  [PostgreSQL]               [Redis]
  - wallets                  - billing:session:*:pending
  - wallet_ledger_entries    - session:*:latency
  - payout_retry_queue       - provider earnings cache
  - linked_wallets           - rate limits
  - blockchain_state_cache
        │
        ▼
  [Solana Devnet / Mainnet]  ←── Oracle sends SOL on-chain
  [Paystack API]             ←── GHS MoMo withdrawals
  [CoinGecko API]            ←── Live SOL/USD pricing
```

---

## 3. Component Breakdown

### 3.1 Wallet Model & Database Schema

**File:** `services/control-api/internal/models/wallet.go`
**Migrations:** `000001_init_supabase.up.sql`, `000003_wallet_multi_currency.up.sql`

```go
type Wallet struct {
    ID          uuid.UUID  // Primary key
    UserID      uuid.UUID  // 1-to-1 with User (unique)
    BalanceGHS  float64    // Fiat (GHS) — legacy
    BalanceSOL  float64    // SOL — primary active currency
    BalanceUSDT float64    // USDT — present but not actively credited
    Currency    string     // "MULTI" marker, not used for routing
}

type WalletLedgerEntry struct {
    ID           uuid.UUID
    WalletID     uuid.UUID
    Amount       float64     // Positive = credit, Negative = debit
    BalanceAfter float64     // Snapshot of balance after this entry
    Type         string      // topup, usage, payout, refund, p2p_sent, p2p_received, provider_earning
    ReferenceID  string      // Solana tx sig or internal UUID
    TxHash       string      // On-chain tx hash if applicable
    Description  string
    CreatedAt    time.Time
}
```

Every financial operation creates a `WalletLedgerEntry`. This forms an audit trail but has no `Currency` field — making it impossible to tell which currency a given entry represents in a multi-currency wallet.

---

### 3.2 Wallet API Endpoints

**File:** `services/control-api/internal/api/wallet.go`

| Method | Path | Action |
|---|---|---|
| `GET` | `/wallet` | Fetch balances + merged transaction history |
| `POST` | `/wallet/deposit` | **DISABLED** — returns 403, fiat disabled for decentralization |
| `GET` | `/wallet/verify` | Paystack callback — verifies and credits GHS deposit |
| `POST` | `/wallet/withdraw` | MoMo withdrawal (GHS → Paystack → mobile) |
| `POST` | `/wallet/withdraw/sol` | SOL withdrawal to linked Solana address |
| `POST` | `/wallet/deposit/crypto` | Verify Solana crypto deposit (rate-limited 5/min) |
| `POST` | `/wallet/transfer` | P2P transfer between users (SOL or GHS) |
| `POST` | `/wallet/link` | Link external Solana/Ethereum wallet |
| `DELETE` | `/wallet/link` | Unlink wallet |
| `POST` | `/wallet/swap` | GHS ↔ SOL conversion |

**Wallet auto-initialization:** On first `GET /wallet`, if no wallet exists the system auto-creates one, including a fallback user profile creation if the user row is also missing. This lazy init is safe but has race-condition protections via `ON CONFLICT DO NOTHING`.

---

### 3.3 Billing & Settlement Engine

**File:** `services/control-api/internal/billing/worker.go`

This is the financial heart of the system.

**Settlement Flow:**
```
Edge Gateway
    │  (real-time byte counting)
    │  metering.rs → Redis key: billing:session:{credentials_user}:pending
    ▼
[Hourly Tick — StartSettlementWorker]
    │
    ├── Scan Redis: billing:session:*:pending
    │
    ├── For each key → settleSession()
    │   ├── Load session by credentials_user from DB
    │   ├── Calculate cost: bytes / GB × price_per_GB → USDT → SOL
    │   ├── Lock buyer wallet (FOR UPDATE)
    │   ├── Debit buyer's BalanceSOL
    │   ├── Write buyer's ledger entry (usage charge)
    │   ├── Credit provider's BalanceSOL (NO LOCK)
    │   ├── Write provider's ledger entry (provider_earning)
    │   ├── If provider balance ≥ 0.05 SOL → triggerProviderPayout() [goroutine]
    │   └── DecrBy Redis key
    │
    └── triggerProviderPayout()
        ├── resolveProviderWallet() → linked wallet or profile wallet_address
        ├── Lock provider wallet (FOR UPDATE)
        ├── Deduct full balance → write ledger entry
        ├── sendSOLToWallet() → oracle on-chain transfer
        └── On failure → PayoutRetryQueue entry (exponential backoff)
```

**Cost calculation formula:**
```
costUSDT = (totalBytes / 1_073_741_824) × pricePerGB
costSOL  = costUSDT / SOLPriceUSD
```

**Provider payout threshold:** `0.05 SOL` (~$7.50 at $150/SOL)

---

### 3.4 Solana Oracle & On-Chain Settlement

**Files:** `services/control-api/internal/solana/settlement.go`, `solana/client.go`

The oracle is a server-side Solana keypair (loaded from `/run/secrets/oracle-keypair.json`) that signs and submits transactions:

- **`SendSOL()`** — System Program transfer (treasury → recipient)
- **`SettleEscrow()`** — Closes an escrow account and distributes SOL proportionally between buyer and seller
- **`EmergencyRefund()`** — Refunds buyer after timeout
- **`SlashStake()`** — Penalizes providers for violations
- **`SubmitUsageProof()`** — Submits Ed25519-signed usage proof to on-chain program
- **`BatchSettleEscrows()`** — Batches multiple settlements in a single RPC trip

RPC failover is supported via comma-separated `SOLANA_RPC_ENDPOINT` env var.

**Escrow lifecycle:**
```
Buyer creates session → escrow PDA initialized on-chain
    ↓ (session runs, bytes metered)
Oracle settles escrow → SOL distributed (buyer deduction + provider credit)
    ↓ (or timeout)
EmergencyRefund → buyer gets SOL back
```

---

### 3.5 Linked Wallets

**File:** `services/control-api/internal/api/linked_wallets.go`
**Model:** `services/control-api/internal/models/blockchain.go`

Users can link external wallets (Solana or Ethereum) by proving ownership through a signature challenge:

1. User requests a challenge message (timestamp + nonce)
2. User signs with their external wallet
3. Server verifies the signature (Ed25519 for Solana, ECDSA for Ethereum)
4. Wallet is stored as `verified = true`

Each user can have multiple linked wallets but only one `is_primary = true` per chain. Provider payouts prefer the primary verified linked wallet over the legacy `wallet_address` profile field.

**BlockchainStateCache** syncs escrow PDA state (buyer, seller, amount, status) from on-chain events to Postgres for fast off-chain queries.

---

### 3.6 Payout Retry System

**File:** `services/control-api/internal/models/payout_retry.go`
**Worker:** `billing/worker.go` → `StartPayoutRetryWorker()`

When an on-chain SOL transfer fails (network error, RPC timeout, insufficient fee), the failed payout is queued:

```
PayoutRetryQueue {
    ProviderID, WalletAddress, AmountSOL
    AttemptCount, LastAttemptedAt, NextRetryAt
    Status: "pending" | "succeeded" | "failed_permanent"
    ErrorMessage
}
```

Retry schedule (exponential backoff, 2^n minutes, cap 128 min):

| Attempt | Delay |
|---|---|
| 1 | 2 min |
| 2 | 4 min |
| 3 | 8 min |
| 4 | 16 min |
| 5 | 32 min |
| 6 | 64 min |
| 7 | 128 min (~2h) |
| 8 | → `failed_permanent` — requires manual intervention |

---

### 3.7 Escrow & Disputes

**File:** `services/control-api/internal/models/escrow.go`

| Status | Meaning |
|---|---|
| `held` | Funds locked in escrow |
| `released` | Seller received funds |
| `refunded` | Buyer received refund |
| `disputed` | Under arbitration |

Milestone-based progressive release is modeled (byte thresholds) but dispute resolution requires manual admin override at `POST /escrow/:orderId/resolve`.

---

### 3.8 Price Oracle

**File:** `services/control-api/internal/billing/price.go`

```go
GetSOLPriceUSD()
    → CoinGecko API (cached 5 min)
    → Fallback: 150.0 USD if CoinGecko unavailable
```

Used for: USDT → SOL conversion in billing settlement. **Not used** for the GHS → SOL conversion path (which uses a hardcoded rate of 2200).

---

## 4. End-to-End Flow

### Buyer Session Flow
```
1. User funds wallet
   → POST /wallet/deposit/crypto  (Solana deposit verified via RPC)
   → BalanceSOL credited

2. User creates proxy session
   → POST /sessions
   → Session row created with credentials (user:pass)

3. Proxy usage runs
   → Edge Gateway meters bytes
   → Redis key: billing:session:{credentials_user}:pending → incremented per request

4. Hourly settlement fires
   → settleSession() calculates cost in SOL
   → Buyer's BalanceSOL decremented
   → Provider's BalanceSOL incremented
   → Ledger entries written for both parties

5. Provider threshold reached (≥ 0.05 SOL)
   → triggerProviderPayout() goroutine fires
   → Provider's BalanceSOL zeroed in DB
   → Oracle sends SOL on-chain to provider's Solana address

6. User withdraws their remaining SOL
   → POST /wallet/withdraw/sol
   → BalanceSOL decremented atomically
   → Oracle sends SOL to user's linked wallet
```

### Provider Earnings Flow
```
Session settles → providerWallet.BalanceSOL += costSOL
                                ↓
              balance ≥ 0.05 SOL?
                    Yes ↓
         triggerProviderPayout() goroutine
                    ↓
         lock wallet → set balance to 0
                    ↓
         sendSOLToWallet() → oracle → Solana network
                    ↓
           success?
         Yes → log success
          No → PayoutRetryQueue entry (exponential backoff)
                    ↓ (retry worker polls every 5 min)
         retried up to 8 times → failed_permanent if all fail
```

---

## 5. What Is Wired Correctly

These components are correctly implemented and well-integrated:

| Component | Status | Notes |
|---|---|---|
| Wallet auto-creation | ✅ Correct | Race-safe via `ON CONFLICT DO NOTHING` |
| Buyer wallet debit in settlement | ✅ Correct | `FOR UPDATE` lock prevents double-spend |
| Ledger audit trail | ✅ Present | Every credit/debit records a ledger entry |
| SOL withdrawal atomicity | ✅ Correct | DB deduction in a transaction; balance restored on on-chain failure |
| Provider payout retry queue | ✅ Correct | Exponential backoff, `failed_permanent` after 8 attempts |
| Linked wallet signature verification | ✅ Correct | Ed25519 (Solana) and ECDSA (Ethereum) both implemented |
| Multi-endpoint RPC failover | ✅ Correct | Comma-separated `SOLANA_RPC_ENDPOINT` |
| Paystack recipient code caching | ✅ Correct | Cached per user to avoid repeat Paystack calls |
| P2P deadlock prevention (intent) | ✅ Intent correct | Wallets locked in sorted UUID order |
| `resolveProviderWallet` fallback chain | ✅ Correct | Primary linked wallet → profile `wallet_address` |
| Payout retry worker startup | ✅ Correct | `StartPayoutRetryWorker()` launched in `main.go` |
| Fiat deposit disabled (decentralization) | ✅ Correct | Returns 403 with clear action message |
| BlockchainStateCache population | ✅ Correct | Wired via `upsertBlockchainStateCache()` in activator.go |

---

## 6. Issues, Bugs, and Cons

### CRITICAL Severity

---

#### C-1: Float64 Used for All Financial Balances

**Location:** `models/wallet.go`, `models/wallet.go` (WalletLedgerEntry), all of billing/worker.go

```go
BalanceSOL  float64   // ← PROBLEM
BalanceGHS  float64   // ← PROBLEM
BalanceUSDT float64   // ← PROBLEM
Amount      float64   // WalletLedgerEntry ← PROBLEM
```

**Problem:** IEEE 754 floating-point arithmetic introduces rounding errors that accumulate over many transactions. Example: `0.1 + 0.2 = 0.30000000000000004` in float64. For financial systems this is unacceptable. Over thousands of billing settlements, sub-lamport rounding errors silently accumulate, leading to discrepancies between DB balances and on-chain reality.

**Impact:** Balance drift over time, potential double-spending in edge cases.

**Fix:** Use `decimal.Decimal` (shopspring/decimal library) for all monetary fields, or store all SOL amounts as integer **lamports** (`int64`, where 1 SOL = 1,000,000,000 lamports).

---

#### C-2: Hardcoded GHS/SOL Exchange Rate

**Location:** `api/wallet.go:362`

```go
currentRate := 2200.0  // 1 SOL = 2200 GHS — HARDCODED
```

**Problem:** The GHS-to-SOL conversion rate is hardcoded at 2200 GHS/SOL. SOL is highly volatile; the actual rate fluctuates significantly. When this rate is wrong, users either receive too much or too little SOL for their GHS deposit. This is also a separate code path from `GetSOLPriceUSD()` in `billing/price.go` — inconsistent rate sources.

**Impact:** Financial loss for either platform or user on every Paystack GHS deposit.

**Fix:** Call `GetSOLPriceUSD()` and multiply by a live GHS/USD rate from a forex API (e.g., ExchangeRate-API). Unify the rate fetch into a single price service.

---

#### C-3: triggerProviderPayout Sends Wrong Amount On-Chain

**Location:** `billing/worker.go:213`

```go
// In settleSession():
go triggerProviderPayout(providerID, providerWallet.BalanceSOL)  // stale snapshot

// In triggerProviderPayout():
payoutAmount := wallet.BalanceSOL  // ← deducts THIS (fresh locked value)
...
sendSOLToWallet(ctx, walletAddress, pendingSOL)  // ← sends the OLD value passed in
```

**Problem:** The function parameter `pendingSOL` is the balance snapshot at the time `settleSession` ran. By the time `triggerProviderPayout` executes (it's a goroutine), additional earnings may have been credited. The DB deducts `wallet.BalanceSOL` (the fresh value), but the on-chain transfer sends `pendingSOL` (the old value).

**Impact:** If additional earnings were credited between the goroutine spawn and execution:
- DB balance is fully zeroed (correct)
- On-chain transfer sends less than what was deducted (net SOL stuck in treasury)

**Fix:** Send `payoutAmount` (the locked amount) on-chain, not `pendingSOL`:
```go
if err := sendSOLToWallet(ctx, walletAddress, payoutAmount); err != nil { ... }
```

---

#### C-4: Provider Wallet Not Locked During Settlement Credit

**Location:** `billing/worker.go:135`

```go
var providerWallet models.Wallet
if err := tx.Where("user_id = ?", providerID).First(&providerWallet).Error; err == nil {
    providerWallet.BalanceSOL += costSOL
    // ← No FOR UPDATE lock!
```

**Problem:** While the buyer's wallet is locked (`FOR UPDATE`), the provider's wallet is fetched without a lock. Under concurrent settlement of multiple sessions for the same provider, two goroutines can read the same `providerWallet.BalanceSOL`, both add `costSOL`, and write back — losing one of the credits (lost update race condition).

**Impact:** Provider earnings are silently under-credited when multiple sessions settle simultaneously.

**Fix:**
```go
tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", providerID).First(&providerWallet)
```

---

### HIGH Severity

---

#### H-1: WalletLedgerEntry Missing Currency Field

**Location:** `models/wallet.go`

The ledger entry has no `Currency string` field. In a multi-currency wallet with SOL, GHS, and USDT, every ledger entry looks identical — there is no way to determine which currency the `Amount` and `BalanceAfter` values represent.

**Impact:** Auditing, accounting, and frontend display are all ambiguous. A `+0.05` entry could be 0.05 SOL (~$7.50) or 0.05 GHS (~$0.004) — a 1875× difference.

**Fix:** Add `Currency string` and `CurrencyAmount float64` fields to `WalletLedgerEntry`. Optionally add `SOLEquivalent float64` for normalized reporting.

---

#### H-2: autoConvert Is Permanently False

**Location:** `api/wallet.go:380`

```go
autoConvert := false
// if meta, ok := resp.Data.Metadata.(map[string]interface{}); ok { ... }
// ← This block is commented out
```

**Problem:** The auto-swap logic (GHS → SOL on Paystack verification) is intentionally disabled but left in the codebase. All Paystack deposits always credit GHS, never SOL, regardless of user preference. The `auto_convert` JSON field in the deposit request struct is also silently ignored.

**Impact:** The system is in a half-migrated state. Users who deposit via the legacy Paystack path get GHS that cannot easily be spent (since proxy billing is in SOL).

**Fix:** Either fully remove the GHS path, or implement the live GHS→SOL swap properly and re-enable the auto-convert path.

---

#### H-3: P2P Transfer — Deadlock Prevention Pattern Is Fragile

**Location:** `api/wallet.go:663-678`

```go
// This map-based wallet selection is convoluted and error-prone
if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", ids[0]).First(
    map[string]*models.Wallet{senderID: &senderWallet, recipient.ID.String(): &recipientWallet}[ids[0]],
).Error; err != nil {
```

**Problem:** The pattern of using a Go `map` to select the correct wallet pointer based on sorted ID is clever but very fragile. If `senderID` happens to equal `ids[0]` vs `ids[1]` depends on string comparison. If there are any mutations to `senderID` or UUID string formatting (e.g., uppercase vs lowercase UUID), the pointer assignment silently goes to the wrong variable.

**Impact:** Transactions may silently credit/debit the wrong wallet. The self-transfer check at line 625 also compares `req.RecipientIdentifier == senderID` which compares email/username to a UUID — this check always passes falsely, meaning a user *can* transfer to themselves if they use their UUID as the recipient.

**Fix:** Simplify — use explicit variables with clear named locking:
```go
firstID, secondID := senderUUID, recipientUUID
if firstID.String() > secondID.String() { firstID, secondID = secondID, firstID }
// lock by firstID, then secondID, then assign to senderWallet/recipientWallet by comparing with senderUUID
```

---

#### H-4: SOL Withdrawal Balance Restoration Is Not Idempotent

**Location:** `api/wallet.go:838-840`

```go
// If on-chain fails, restore balance with a plain UPDATE (no retry, no ledger)
db.DB.Model(&models.Wallet{}).Where("user_id = ?", userUUID).
    Update("balance_sol", gorm.Expr("balance_sol + ?", req.Amount))
```

**Problem:** If the balance restoration fails (DB connection issue, concurrent transaction, etc.), the user's SOL is lost — it was deducted from the DB, the on-chain transfer failed, and the restoration also failed. There is no ledger entry for the restoration attempt, and no retry mechanism. Also, the ledger entry for the deduction was already written inside the successful DB transaction — so the ledger shows a withdrawal that technically did not happen on-chain.

**Impact:** User funds can be permanently lost in a rare but possible failure scenario.

**Fix:** Add the restoration as a queued retry operation (similar to `PayoutRetryQueue`) or wrap the on-chain call within a two-phase commit pattern that does not write the ledger until on-chain confirmation.

---

#### H-5: Settlement Redis Key Extraction Uses Naming Mismatch

**Location:** `billing/worker.go:45-47`

```go
sessionID := strings.TrimPrefix(key, "billing:session:")
sessionID = strings.TrimSuffix(sessionID, ":pending")
// Then used as:
db.DB.Where("credentials_user = ?", sessionID).First(&session)
```

**Problem:** The variable is named `sessionID` but it actually holds the `credentials_user` value (not the session UUID). The Redis key format is `billing:session:{credentials_user}:pending` (based on how `metering.rs` writes keys using the session credentials username), but the extraction strips prefixes to get a value that is treated as a UUID (`uuid.Parse(sessionID)`) later — which will always fail and produce a zero UUID, silently corrupting `ProviderScore` lookups.

**Impact:** `ProviderScore` updates always use `uuid.Nil` as the session ID, which is semantically wrong.

**Fix:** Rename the variable to `credentialsUser` throughout `settleSession()` and fix the `uuid.Parse` call at line 101 to use the actual session UUID from the loaded session object (`session.ID`).

---

### MEDIUM Severity

---

#### M-1: Settlement Uses Redis DecrBy Instead of Del (Potential Negative Values)

**Location:** `billing/worker.go:164`

```go
redis.Client.DecrBy(context.Background(), redisKey, totalBytes)
```

If new bytes arrive in Redis between reading the value and calling DecrBy, those new bytes are preserved (which is correct). However, if the settlement reads 1000 bytes and DecrBys by 1000, but another coroutine also decrements, the counter could go negative. Also, `Scan` doesn't provide a point-in-time snapshot — the SCAN cursor may visit the same key multiple times if Redis resharding is happening.

**Fix:** Use a Lua script or `GETDEL` pattern to atomically read and clear the counter in a single operation.

---

#### M-2: Price Fallback Is Hardcoded and Stale

**Location:** `billing/price.go`

```go
return 150.0 // Fallback when CoinGecko is unavailable
```

SOL's price changes dramatically. A hardcoded fallback of $150 may be significantly off from real market price. During CoinGecko outages, every billing settlement uses this stale rate, systematically over- or under-charging users.

**Fix:** Use multiple price sources (CoinGecko + CoinMarketCap + Jupiter aggregator). If all fail, pause settlement and log an alert rather than using a hardcoded fallback. Alternatively, use a circuit breaker that refuses settlement when price freshness exceeds 15 minutes.

---

#### M-3: USDT Balance Is a Dead Column

**Location:** `models/wallet.go`, `migrations/000003_wallet_multi_currency.up.sql`

`BalanceUSDT` exists in the model and DB schema but there is no API endpoint, billing path, or user action that credits it directly. It is referenced only as an intermediate for cost calculations. The column causes confusion for anyone reading the API response or ledger.

**Fix:** Either implement a USDT deposit/withdrawal path (via SPL token on Solana) or remove the column and use it only as an in-memory intermediate in the cost calculation.

---

#### M-4: No Transfer Fee or Abuse Protection

**Location:** `api/wallet.go` (transferP2P)

P2P transfers have no minimum amount, no fee, and no rate limiting. Any user can transfer 0.000001 SOL repeatedly to spam the DB with ledger entries, or create automated micro-transfer loops between accounts.

**Fix:** Add a minimum transfer amount (e.g., 0.001 SOL), a flat or percentage fee credited to the platform treasury, and rate limiting (e.g., 10 transfers per hour per user).

---

#### M-5: Wallet History Is Capped at 10 Entries, No Pagination

**Location:** `api/wallet.go:160`

```go
db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at DESC").Limit(10).Find(&ledger)
```

The wallet endpoint always returns exactly 10 ledger entries and 10 payment attempts. There is no `page` or `cursor` parameter. Users with more than 10 transactions cannot see older history.

**Fix:** Add `?page=1&limit=20` query parameters and return total count metadata for pagination.

---

#### M-6: initiateWithdrawal Writes Ledger Before Paystack Confirmation

**Location:** `api/wallet.go:579-587`

The Paystack MoMo transfer is initiated, and then regardless of whether Paystack returns a terminal success (it returns `"pending"` initially), a ledger entry is immediately written. If Paystack's async transfer later fails, the ledger entry remains showing a payout that never completed.

**Fix:** Only write the ledger entry via a Paystack webhook handler on confirmed `transfer.success` events, not optimistically at initiation.

---

#### M-7: No On-Chain Confirmation Waiting for Crypto Deposits

**Location:** `api/wallet.go` (verifyCryptoDeposit — referenced but body not shown)

The crypto deposit flow verifies by checking the Solana RPC. However Solana transactions require confirmation (typically 31 blocks for "finalized" status). If the deposit is verified at "confirmed" or "processed" status, a chain reorganization could void the transaction after the balance has already been credited.

**Fix:** Require "finalized" confirmation status before crediting balances for crypto deposits.

---

### LOW Severity

---

#### L-1: Hard-Coded Provider Payout Threshold in Source Code

```go
const providerPayoutThresholdSOL = 0.05
```

This constant is not configurable via environment variable or database. Changing it requires a code change and redeployment.

**Fix:** Load from `SystemConfiguration` table or environment variable `PROVIDER_PAYOUT_THRESHOLD_SOL`.

---

#### L-2: No Real-Time Balance Notifications

Users only see updated balances by polling `GET /wallet`. After a session's hourly settlement, the user has no way to know their balance changed until they refresh.

**Fix:** Emit a WebSocket event or server-sent event (SSE) after each settlement that affects a user's wallet.

---

#### L-3: Withdrawal Does Not Check Minimum Amount

`POST /wallet/withdraw/sol` accepts any `amount > 0` (binding validation). A user could withdraw 0.000000001 SOL, which costs more in Solana transaction fees than the amount sent.

**Fix:** Add a minimum withdrawal floor (e.g., 0.01 SOL) that accounts for Solana rent and transaction fees.

---

#### L-4: No Platform Fee on Provider Payouts

When SOL is transferred from buyer to provider, 100% goes to the provider with no platform cut. The business model depends on this being handled elsewhere (e.g., listing price markup), but there is no explicit platform fee ledger entry or treasury credit.

**Fix:** Deduct a configurable platform fee (e.g., 5–15%) before the provider payout and credit the treasury wallet.

---

#### L-5: Missing Idempotency Keys on Mutation Endpoints

`POST /wallet/withdraw/sol`, `POST /wallet/transfer`, and `POST /wallet/deposit/crypto` do not accept idempotency keys. A frontend retry (network timeout → duplicate submit) can cause double withdrawals or double credits.

**Fix:** Accept `Idempotency-Key` header and cache the response for 24 hours per key in Redis.

---

#### L-6: `getWallet` Uses `debug.PrintStack()` in Production

**Location:** `api/wallet.go:68`

```go
debug.PrintStack()  // Prints Go stack trace to stderr in production
```

Stack traces should never be printed in production — they leak internal implementation details.

**Fix:** Replace with `logging.Error(fmt.Errorf("panic: %v", r)).Str("stack", string(debug.Stack())).Msg(...)` (log the stack, don't print it).

---

## 7. Recommendations & Enhancements

### R-1: Migrate to Decimal/Lamport Precision

Replace all `float64` monetary fields with integer lamport amounts (`int64`) for SOL:

```go
// Instead of:
BalanceSOL float64   // 0.05 SOL
// Use:
BalanceLamports int64  // 50_000_000 lamports

// Conversion:
const LamportsPerSOL = 1_000_000_000
```

For GHS/USDT, use `shopspring/decimal` library:
```bash
go get github.com/shopspring/decimal
```

---

### R-2: Implement Double-Entry Bookkeeping

The current system uses single-entry ledger entries (one entry per event). A double-entry system would record both sides of every transaction (debit from buyer + credit to provider as a single balanced entry), making it impossible to lose funds silently.

```
CREDIT buyer.wallet  $0.50
  DEBIT provider.wallet $0.47   (platform keeps $0.03 fee)
  DEBIT platform.treasury $0.03
```

---

### R-3: Live GHS/USD Forex Rate

Integrate a forex API for the GHS ↔ SOL conversion path:

```go
func GetGHStoSOLRate() float64 {
    usdPerGHS := fetchForexRate("GHS", "USD")  // ExchangeRate-API
    solPerUSD  := 1.0 / GetSOLPriceUSD()
    return solPerUSD * usdPerGHS
}
```

---

### R-4: Multi-Source Price Oracle with Circuit Breaker

```
Primary:   CoinGecko API
Secondary: CoinMarketCap API
Tertiary:  Jupiter DEX aggregator (on-chain price)
Fallback:  PAUSE SETTLEMENT + alert, never use stale hardcoded value
```

---

### R-5: Platform Fee Mechanism

Add a configurable platform fee to all buyer→provider flows:

```go
const PlatformFeePercent = 0.10  // 10%

platformCut := costSOL * PlatformFeePercent
providerEarning := costSOL - platformCut

// Credit platform treasury
creditTreasuryWallet(platformCut)
// Credit provider
creditProviderWallet(providerEarning)
```

---

### R-6: Real-Time Wallet Notifications via WebSocket/SSE

After every settlement event affecting a user:
1. Emit a NATS event: `wallet.balance_changed.{user_id}`
2. Control API has a WebSocket handler subscribed to this — pushes to connected clients
3. Frontend updates balance without polling

This NATS infrastructure already exists in the project.

---

### R-7: Admin Wallet Operations Panel

Add admin-only endpoints for:
- Manual credit/debit with required reason field
- Freeze/unfreeze a wallet
- View full unfiltered ledger history
- Force trigger payout for a provider
- Manually resolve `failed_permanent` retry entries

---

### R-8: Withdrawal Limits and Daily Caps

```go
type WalletPolicy struct {
    MaxDailyWithdrawalSOL float64  // e.g., 100 SOL
    MaxSingleWithdrawalSOL float64  // e.g., 10 SOL
    MinWithdrawalSOL float64        // e.g., 0.01 SOL
    KycRequiredAboveSOL float64     // e.g., 5 SOL — trigger KYC gate
}
```

---

### R-9: SOL Withdrawal Two-Phase Commit

Instead of deducting first and then sending on-chain:
1. Create a `withdrawal_intent` record (status: `pending`)
2. Send on-chain; store tx signature
3. Poll for `finalized` confirmation
4. On confirmation: deduct balance + write ledger (step 3 and 4 atomic)
5. On permanent failure: mark intent `failed`, no balance change

---

### R-10: SPL Token Support for USDT

The `BalanceUSDT` column currently does nothing. Properly implement it:
- Accept USDC/USDT deposits via Solana SPL token program
- Allow billing in USDT directly (no conversion needed)
- Allow USDT withdrawals to user's Solana token account

---

## 8. Priority Matrix

| ID | Issue | Severity | Effort | Fix First? |
|---|---|---|---|---|
| C-1 | Float64 for financial math | CRITICAL | High | Yes — after launch risk |
| C-3 | Wrong amount sent on-chain in payout | CRITICAL | Low | **Yes — immediate** |
| C-4 | Provider wallet not locked in settlement | CRITICAL | Low | **Yes — immediate** |
| C-2 | Hardcoded GHS exchange rate | CRITICAL | Medium | Yes |
| H-3 | P2P deadlock logic fragile | HIGH | Medium | Yes |
| H-4 | SOL withdrawal refund can silently fail | HIGH | Medium | Yes |
| H-5 | sessionID naming mismatch in billing | HIGH | Low | **Yes — immediate** |
| H-1 | Ledger missing Currency field | HIGH | Medium | Yes |
| H-2 | autoConvert permanently false | HIGH | Low | Yes |
| M-2 | Stale price fallback halts correctly | MEDIUM | Medium | Yes |
| M-4 | No P2P transfer fees or limits | MEDIUM | Low | Yes |
| M-6 | Ledger written before Paystack confirm | MEDIUM | Medium | Yes |
| M-7 | No finalized confirmation for crypto deposit | MEDIUM | High | Schedule |
| R-5 | Platform fee mechanism missing | Enhancement | Medium | Next sprint |
| R-6 | Real-time balance WebSocket | Enhancement | Medium | Next sprint |
| R-2 | Double-entry bookkeeping | Enhancement | High | Long-term |
| R-9 | Two-phase commit for withdrawals | Enhancement | High | Long-term |
| R-10 | SPL token USDT support | Enhancement | High | Long-term |

---

## Summary

The ProxyHubb wallet system is **structurally sound** and covers the key flows needed for a decentralized proxy marketplace: SOL-based billing, provider auto-payouts, retry queues, linked wallet management, and escrow settlement. The ledger-based audit trail and atomic DB transactions for most operations show good engineering discipline.

However, three issues require **immediate patching before any production load**:

1. **C-3** — Fix `pendingSOL` vs `payoutAmount` in `triggerProviderPayout` (1-line fix, high financial impact)
2. **C-4** — Add `FOR UPDATE` lock on provider wallet in `settleSession` (1-line fix, prevents lost earnings)
3. **H-5** — Rename `sessionID` to `credentialsUser` and fix `uuid.Parse` to use `session.ID` (prevents ProviderScore corruption)

The **float64 monetary representation** (C-1) is a systemic issue that should be addressed in the next engineering sprint before the user base scales.

---

*Report generated by code analysis. All file references are relative to the project root `f:/project/proxyhubb/`.*
