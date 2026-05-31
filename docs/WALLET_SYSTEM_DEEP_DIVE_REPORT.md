# ProxyHubb Wallet System — Deep-Dive Analysis Report

**Date:** 2026-05-24  
**Scope:** Full wallet architecture, security, flow, and integration audit  
**Systems Reviewed:** Control API, Edge Gateway, Solana Programs, Billing/Settlement, Treasury, Auth, and Web Frontend  

---

## Executive Summary

The ProxyHubb wallet system has undergone a significant architectural evolution from a fiat-first (GHS) multi-currency design to a **Solana (SOL)-only settlement layer**. This transition demonstrates strong technical decision-making for a decentralized proxy marketplace, but it has left behind **legacy artifacts, untested critical paths, and several high-severity security gaps**.

The wallet is the economic backbone of the platform: users deposit SOL to buy bandwidth, providers earn SOL for routing traffic, and the treasury manages batch payouts. Any weakness in this system directly impacts user funds, provider trust, and platform solvency.

**Overall Grade: B-**  
*Good architectural foundations with critical security and reliability gaps that must be addressed before mainnet-scale deployment.*

---

## 1. Wallet Architecture & Structure

### 1.1 Database Schema

The wallet layer is backed by PostgreSQL (Supabase) with the following core tables:

| Table | Purpose | Key Constraints |
|-------|---------|-----------------|
| `wallets` | Primary user wallet (1:1 with `auth.users`) | `chk_wallet_balance_non_negative` |
| `wallet_ledger_entries` | Immutable double-entry audit trail | Append-only, referenced by `wallet_id` |
| `pending_transactions` | Crypto deposits/withdrawals awaiting on-chain confirmation | Prevents double-spend via `tx_hash` uniqueness |
| `linked_wallets` | Multi-chain external wallet linkage (Solana, Ethereum) | Signature-verified at link time |
| `spending_records` | Per-transaction spend tracking for limit enforcement | Rolled up daily/weekly/monthly |
| `batch_payouts` / `batch_payout_items` | Gas-efficient bulk SOL transfers to providers | Atomic batch status tracking |
| `pending_payouts` | Payout queue with priority and scheduled timestamps | Retry counter + error log |
| `provider_earnings` | Per-session earnings breakdown | Links to `sessions` and `orders` |
| `payout_retry_queue` | Failed on-chain payout retry state | Exponential backoff (max 8 attempts) |
| `reconciliation_history` | Treasury balance vs. internal liabilities audit | Periodic snapshot |
| `blockchain_state_cache` | On-chain PDA/account state mirror | Reduces RPC load |

#### Current Wallet Schema (SOL-Only)
```sql
id UUID PRIMARY KEY
user_id UUID UNIQUE NOT NULL → auth.users
balance_sol NUMERIC(20,9) NOT NULL DEFAULT 0
limits_enabled BOOLEAN NOT NULL DEFAULT false
daily_limit NUMERIC(20,9) DEFAULT 0
weekly_limit NUMERIC(20,9) DEFAULT 0
monthly_limit NUMERIC(20,9) DEFAULT 0
limit_window_start TIMESTAMP
created_at / updated_at
```

#### Multi-Currency Evolution
| Phase | Migration | State |
|-------|-----------|-------|
| Initial | `000001_init_supabase.up.sql` | GHS-only (`balance` column) |
| Multi-currency | `000003_wallet_multi_currency.up.sql` | Added `balance_sol`, `balance_usdt` |
| SOL-only | `20260314_sol_only_migration.sql` | Dropped GHS/USDT, converted to SOL at fixed rates |

**Note:** The `balance_usdt` column still exists in the database but is dead weight. The Go model only references `BalanceSOL`.

### 1.2 Service Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              WEB CLIENT                                  │
│  (Next.js — Wallet Page, Deposit/Withdraw, Linked Wallets, Limits)      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTROL API (Go/Gin)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Wallet API  │  │ Linked Wallets│  │   Auth API   │  │  Admin API   │ │
│  │  (wallet.go) │  │(linked_wallets)│  │  (auth.go)   │  │(admin_payouts)│ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                    │
│  │  Crypto API  │  │  Orders API  │  │   KYC API    │                    │
│  │ (crypto.go)  │  │ (orders.go)  │  │   (kyc.go)   │                    │
│  └──────────────┘  └──────────────┘  └──────────────┘                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
        ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
        │  Billing/     │ │   Solana      │ │   Treasury    │
        │  Settlement   │ │   Oracle      │ │   Manager     │
        │  (worker.go)  │ │  (client.go)  │ │(treasury_mgr) │
        └───────────────┘ └───────────────┘ └───────────────┘
                    │               │               │
                    ▼               ▼               ▼
        ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
        │     Redis     │ │  Solana RPC   │ │  Watchtower   │
        │   (queues)    │ │  / Mainnet    │ │   (alerts)    │
        └───────────────┘ └───────────────┘ └───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EDGE GATEWAY (Rust)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │BlockchainMgr │  │ EventSigner  │  │ UsageEvent   │                   │
│  │ (mod.rs)     │  │ (Ed25519)    │  │ (Merkle)     │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SOLANA ON-CHAIN PROGRAM                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Escrow PDA   │  │ Admin Config │  │ Dispute PDA  │  │ MultiSig     │ │
│  │ [escrow,buyer│  │ [admin_config│  │ [dispute,    │  │ Oracle       │ │
│  │  ,seller]    │  │  ]           │  │  escrow]     │  │ (3-of-5)     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Files & Responsibilities

| File | Lines | Role |
|------|-------|------|
| `services/control-api/internal/api/wallet.go` | ~907 | Main wallet API (transfers, deposits, withdrawals, limits) |
| `services/control-api/internal/api/linked_wallets.go` | ~461 | Multi-chain wallet linking with signature verification |
| `services/control-api/internal/models/wallet.go` | ~67 | Wallet + LedgerEntry GORM models |
| `services/control-api/internal/models/spending_limit.go` | ~223 | Spending limit enforcement logic |
| `services/control-api/internal/billing/worker.go` | ~743 | Settlement engine, payouts, retry queue |
| `services/control-api/internal/billing/aggregator.go` | ~201 | Usage aggregation + Ed25519 verification |
| `services/control-api/internal/billing/batch_payout.go` | ~180 | Batch payout processor for gas efficiency |
| `services/control-api/internal/solana/client.go` | ~852 | Oracle client, RPC failover, HSM signing |
| `services/control-api/internal/solana/settlement.go` | ~570 | On-chain escrow settlement tx builder |
| `services/control-api/internal/treasury/treasury_manager.go` | ~430 | Auto-topup, thresholds, reconciliation |
| `services/control-api/internal/api/auth.go` | ~370 | Wallet-first authentication (challenge + login) |
| `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` | ~3639 | Anchor on-chain program |
| `docs/openapi.yaml` | ~4218 | API specification |

---

## 2. System Flow

### 2.1 User Deposit Flow

```
1. User links Solana wallet via POST /v1/linked-wallets
   └─> Signs message containing user_id + wallet_address
   └─> Ed25519 signature verified server-side

2. User sends SOL to platform treasury address
   └─> On-chain native SOL transfer

3. Escrow Listener Worker detects deposit
   └─> Maps sender address → user via linked_wallets table
   └─> Creates wallet if missing
   └─> Credits balance_sol
   └─> Writes ledger entry (type: deposit)
   └─> Emits notification

4. Alternative: Manual crypto deposit verification
   └─> POST /v1/wallet/deposit/crypto with tx_hash
   └─> Server verifies tx on-chain
   └─> Confirms sender matches linked wallet
   └─> Credits balance
```

### 2.2 Session Purchase & Escrow Flow

```
1. User creates order for proxy session
   └─> Buyer wallet must have sufficient SOL balance

2. Order enters "pending_payment" status
   └─> Escrow PDA derived: ["escrow", buyer, seller]
   └─> Buyer sends SOL to escrow PDA on-chain

3. Edge Gateway streams usage data
   └─> Signs usage events with Ed25519
   └─> Submits to Control API billing aggregator

4. Hourly Settlement Cron runs
   └─> Aggregates signed usage per session
   └─> Debits buyer wallet (off-chain ledger)
   └─> Credits provider earnings
   └─> If escrow-backed: calls SettleEscrow() on-chain proportionally

5. Provider Earnings Accrue
   └─> When ≥ 0.05 SOL threshold reached
   └─> Queued to BatchPayoutProcessor

6. Batch Payout (every 15 min)
   └─> Groups pending payouts
   └─> Single on-chain tx from treasury
   └─> Updates batch_payout_items status
```

### 2.3 P2P Transfer Flow

```
1. POST /v1/wallet/transfer
   └─> Rate limited: 5 req/min
   └─> Validates recipient identifier (username or wallet)
   └─> Checks sender balance
   └─> Checks spending limits

2. DB Transaction
   └─> Locks wallets in UUID-sorted order (deadlock prevention)
   └─> Deducts sender balance
   └─> Adds recipient balance
   └─> Creates sender ledger entry (type: p2p_sent)
   └─> Creates recipient ledger entry (type: p2p_received)

3. Optional On-Chain Transfer
   └─> If recipient has linked wallet
   └─> Goroutine triggers SendSOL() from treasury
   └─> Updates ledger entry with tx_hash
```

### 2.4 Withdrawal Flow

```
1. POST /v1/wallet/withdraw/sol
   └─> Rate limited: 5 req/min
   └─> Validates amount (gt=0)
   └─> Checks balance
   └─> Checks spending limits
   └─> Resolves destination: primary linked wallet

2. DB Transaction
   └─> Deducts balance
   └─> Creates ledger entry (type: withdraw)
   └─> Creates pending_transaction

3. On-Chain Transfer
   └─> OracleClient.SendSOL()
   └─> Multi-RPC failover
   └─> Circuit breaker protection

4. Completion
   └─> Updates pending_transaction with tx_hash
   └─> On failure: compensating DB refund + ledger entry
```

### 2.5 Wallet-First Authentication Flow

```
1. POST /v1/auth/wallet/challenge
   └─> Generates nonce: hex(random_32B) + ":" + recent_blockhash
   └─> 5-minute TTL, single-use

2. User signs nonce with Solana wallet
   └─> Ed25519 signature

3. POST /v1/auth/wallet/login
   └─> Verifies signature
   └─> Verifies blockhash on-chain
   └─> Deletes nonce (replay protection)
   └─> Issues JWT + Refresh token
```

---

## 3. Strengths of the Wallet System

### 3.1 Architectural Strengths

| Strength | Evidence |
|----------|----------|
| **Immutable Ledger** | Every balance change creates a `wallet_ledger_entries` row with type, amount, reference_id, and metadata. Full audit trail. |
| **DB-Level Balance Protection** | `CHECK (balance_sol >= 0)` constraint prevents negative balances at the database level. |
| **Deadlock Prevention** | P2P transfers lock wallets in UUID-sorted order, eliminating circular wait conditions. |
| **Circuit Breaker** | Solana RPC client pauses after 3 failures in 60 seconds, preventing cascading settlement failures. |
| **Compensating Transactions** | On-chain withdrawal failures trigger automatic DB refunds with full ledger audit entries. |
| **Multi-RPC Failover** | OracleClient supports comma-separated RPC endpoints with health checking. |
| **HSM Support** | AWS KMS integration for oracle signing with fallback to encrypted local keypairs (AES-256-GCM). |
| **Batch Payouts** | Gas-efficient batch SOL transfers reduce on-chain transaction costs for provider payouts. |
| **Spending Limits** | Daily/weekly/monthly limits with trust-tier caps (New → Verified → Premium). |
| **Nonce Replay Protection** | Wallet auth uses single-use nonces with Redis + blockhash verification. |
| **Message Binding** | Wallet linking requires signed messages containing both `user_id` and `wallet_address`, preventing replay attacks. |
| **Treasury Monitoring** | Auto-topup with environment-specific thresholds and 10-minute cooldown guards. |
| **Reconciliation** | Periodic treasury vs. liabilities reconciliation with historical snapshots. |

### 3.2 Security Strengths

- **Ed25519 Signature Verification**: All Solana operations use proper Ed25519 verification via `ed25519.Verify()`.
- **Rate Limiting on Financial Mutations**: Transfers, deposits, and withdrawals are capped at 5 requests per minute.
- **Idempotency Keys**: Usage aggregation uses Redis `SetNX` to prevent double-counting receipts.
- **On-Chain Sender Verification**: Crypto deposits verify the transaction sender matches the user's linked wallet.
- **MultiSig Oracle**: On-chain program supports up to 5 oracle signers with configurable threshold (default 3-of-5).
- **Trust Tier Gating**: Spending limit updates are capped by the user's KYC trust tier.

### 3.3 Operational Strengths

- **Retry Queue**: Failed payouts retry with exponential backoff (max 8 attempts).
- **Batch Processing**: Provider payouts batch into single on-chain transactions for gas efficiency.
- **Auto-Deposit Worker**: Native SOL deposits are auto-detected and credited without manual intervention.
- **Structured Logging**: Most of the codebase uses structured logging with correlation IDs.

---

## 4. Weaknesses & Vulnerabilities

### 4.1 Critical (P0) Issues

#### 🔴 CR-1: Hardcoded Secrets in Docker Compose
**File:** `docker-compose.full.yml`, `docker-compose.minimal.yml`, `docker-compose.dev.yml`

```yaml
# docker-compose.full.yml:102
- PROVIDER_PRIVATE_KEY=${PROVIDER_PRIVATE_KEY:-750cb0f0d0b7dce54567b0394513cd19a2ab6d21d4691696179061c20da297d1}

# docker-compose.minimal.yml:70
--requirepass cf31a09442a2129a1b61ed789176774a

# docker-compose.full.yml:246 / docker-compose.minimal.yml:101
- POSTGRES_PASSWORD=proxyhubb
```

**Impact:** If environment variables are unset in production, fallback defaults expose real private keys, database passwords, and Redis credentials. The provider private key is a valid 64-character hex string.

**Fix:** Replace all `${VAR:-default}` patterns with `${VAR:?error message}` to force explicit configuration.

---

#### 🔴 CR-2: KYC Webhook Missing Authentication
**File:** `services/control-api/internal/api/kyc.go:35-36`

```go
func handleKYCWebhook(c *gin.Context) {
    // P0: In production, verify webhook signature/source IP here.
```

**Impact:** An attacker can POST arbitrary KYC status updates, elevating any user to "Verified" trust tier, unlocking spending limits from 10 SOL/day to 500 SOL/day. This is a direct trust-boundary bypass.

**Fix:** Implement webhook HMAC signature verification and source IP allowlisting before processing any KYC status update.

---

#### 🔴 CR-3: Revenue Claim Race Condition (Double-Spend)
**File:** `services/control-api/internal/api/circle_pool.go:658-686`

```go
for _, r := range revenues {
    r.Claimed = true
    r.ClaimedAt = &[]time.Time{time.Now()}[0]
    db.Social().Save(&r)          // Marks revenue claimed
    totalAmount += r.Amount
}
// Then separately:
wallet.BalanceSOL += totalAmount
db.DB.Save(&wallet)               // Credits wallet
db.DB.Create(&ledger)
```

**Impact:** Two concurrent requests can both see `claimed = false`, mark revenue as claimed, and credit the wallet twice. The social DB and wallet DB are different databases with no distributed transaction.

**Fix:** Use a distributed saga pattern or idempotency key + single atomic update query.

---

#### 🔴 CR-4: Subscription Prorated Billing Non-Atomic
**File:** `services/control-api/internal/api/subscriptions.go:230-271`

**Impact:** A crash between wallet update and ledger entry creation produces unauditable balance changes. The subscription plan update also occurs outside the transaction.

**Fix:** Wrap all three operations (wallet update, ledger entry, plan update) in a single `db.DB.Transaction()`.

---

### 4.2 High (P1) Issues

#### 🔴 HI-1: Auto-Deposit Worker Assumes Any Known Sender = Deposit
**File:** `services/control-api/internal/worker/escrow_listener.go:94-113`

```go
func handleNativeDeposit(event solana.EscrowEvent) {
    // Maps sender to user, but doesn't verify deposit was intended for treasury
```

**Impact:** If a user sends SOL from a linked wallet to a third party, the platform may incorrectly credit their account. No verification that the recipient was the platform treasury.

**Fix:** Verify the transaction recipient matches the configured `SOLANA_TREASURY_ADDRESS` before crediting.

---

#### 🔴 HI-2: `getKYCStatus` Exposes User Data Without Authorization
**File:** `services/control-api/internal/api/kyc.go:232-250`

**Impact:** Any authenticated user can query any other user's KYC status and linked wallet address.

**Fix:** Enforce that `user_id` parameter matches the authenticated user's ID, or require admin role.

---

#### 🔴 HI-3: Missing Test Coverage for Critical Financial Paths
**File:** `services/control-api/internal/api/wallet_test.go` (249 lines)

**Current Tests:**
- `TestGetWallet` — basic retrieval
- `TestGetWallet_NotFound` — missing wallet
- `TestDeposit_FiatDisabled` — 403 check
- `TestWithdraw_FiatDisabled` — 400 check
- `TestWalletLedgerEntry` — ledger CRUD
- `TestWallet_SOLOnly` — balance field check

**Missing Tests:**
- `transferP2P` (balance transfer, ledger entries, self-transfer block, concurrent transfers)
- `withdrawSOL` (balance deduction, on-chain failure compensation, spending limits)
- `verifyCryptoDeposit` (double-spend prevention, sender mismatch, chain verification)
- `linkWallet` (Ed25519/ECDSA signature verification)
- Spending limit enforcement (`CheckSpendingLimit`, `RecordSpending`)
- Billing worker settlement logic (743 lines, zero unit tests)

---

### 4.3 Medium (P2) Issues

#### 🟡 MD-1: Panic Recovery Leaks Internal State
**File:** `services/control-api/internal/api/wallet.go:69-77`

```go
defer func() {
    if r := recover(); r != nil {
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": fmt.Sprintf("Internal Server Error (Panic): %v", r)
        })
    }
}()
```

**Impact:** Raw panic values (which may contain sensitive data) are returned to the client.

**Fix:** Sanitize the error message to a generic "Internal Server Error" and log the full panic internally.

---

#### 🟡 MD-2: `CreditReferralReward` Ignores `tx.Commit()` Error
**File:** `services/control-api/internal/api/referral.go:167-195`

```go
tx.Commit()  // No error check!
```

**Impact:** If commit fails, the wallet was credited but the transaction may have partially failed. No rollback on commit error.

---

#### 🟡 MD-3: Compensating Refund Error Discarded
**File:** `services/control-api/internal/api/wallet.go:685-698`

```go
_ = db.DB.Transaction(func(tx *gorm.DB) error {
    // compensating refund...
})
```

**Impact:** If the compensating transaction fails, the user loses funds permanently with no alert.

---

#### 🟡 MD-4: `transferP2P` Missing Maximum Amount Validation
**File:** `services/control-api/internal/api/wallet.go:379-382`

```go
type p2pTransferRequest struct {
    RecipientIdentifier string  `json:"recipient" binding:"required"`
    Amount              float64 `json:"amount" binding:"required,gt=0"`
}
```

**Impact:** No upper bound. A float overflow or extremely large value could cause undefined behavior in `solana.SOLToLamports(amount * 1e9)`.

---

#### 🟡 MD-5: `withdrawSOL` Missing Linked Wallet Re-validation
**Impact:** After linking a wallet, a user can later change it. Withdrawal uses the **current** linked wallet without requiring re-signing or confirmation. A compromised session token allows withdrawal to an attacker's pre-linked wallet.

---

#### 🟡 MD-6: Spending Limits Endpoints Not Rate-Limited
**File:** `services/control-api/internal/api/wallet.go:48-53`

```go
wallet.GET("/limits", getSpendingLimits)
wallet.PUT("/limits", updateSpendingLimits)
wallet.POST("/limits/reset", resetSpendingLimits)
```

**Impact:** An attacker could rapid-fire reset limits to bypass restrictions.

---

#### 🟡 MD-7: GeoIP Uses HTTP (MITM Vulnerable)
**File:** `services/control-api/internal/geoip/resolver.go:68`

```go
url := fmt.Sprintf("http://ip-api.com/json/%s?fields=...", ip)
```

**Impact:** Geographic routing decisions can be manipulated by a network adversary.

---

#### 🟡 MD-8: `BatchPayoutProcessor` `sendFunc` Unvalidated
**File:** `services/control-api/internal/billing/batch_payout.go:54-63`

**Impact:** A nil `sendFunc` causes a panic at payout time.

---

#### 🟡 MD-9: Duplicate Wallet Linking Endpoints
**Files:** `services/control-api/internal/api/crypto.go` and `services/control-api/internal/api/wallet.go`

**Impact:** `crypto.go` version has weaker validation (no chain-specific signature verification for Ethereum). Two paths to the same outcome with different security postures.

---

#### 🟡 MD-10: `escrow_listener.go` Auto-Deposit Race on Wallet Creation
**File:** `services/control-api/internal/worker/escrow_listener.go:132-142`

**Impact:** Two simultaneous deposits for a new user can both hit `RecordNotFound` and attempt wallet creation. One fails with a unique constraint violation, and the deposit is lost.

---

### 4.4 Low (P3) Issues

#### 🟢 LO-1: Lingering Multi-Currency Artifacts
- `balance_usdt` column exists but is unused
- `PendingTransaction.Currency` field still referenced but fiat is deprecated
- `payments/paystack.go` and MTN MoMo config exist but are unused for user flows

#### 🟢 LO-2: Inconsistent Logging
**File:** `services/control-api/internal/worker/escrow_listener.go`

Uses `log.Printf()` instead of structured `logging.Info()/Warn()/Error()`, losing correlation IDs.

#### 🟢 LO-3: Hardcoded CORS Origin
**File:** `services/control-api/internal/config/config.go:119`

```go
"https://proxy-social-hub.vercel.app", // Allow Vercel Frontend
```

#### 🟢 LO-4: Weak CSP Policy
**File:** `services/control-api/internal/middleware/security.go:152-160`

```go
"script-src 'self' 'unsafe-inline' 'unsafe-eval';"
```

#### 🟢 LO-5: `orders.go` Derives PDA Before Funding
**File:** `services/control-api/internal/api/orders.go:152-162`

Database updated with escrow PDA before on-chain deposit is confirmed. Orders can be stuck in `pending_payment` indefinitely.

---

## 5. Decentralized SOL-Only Payment Architecture

### 5.1 Philosophy: No Fiat, No Intermediaries

The ProxyHubb wallet system is **strictly decentralized**:
- **No fiat on-ramps** — Users acquire SOL externally (exchanges, DEXs, self-custody)
- **No mobile money** — No MTN MoMo, no bank transfers, no payment processors
- **No card payments** — No Paystack, no Stripe, no card gateways
- **Pure Solana** — All value flows as native SOL on-chain

### 5.2 Current SOL Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Settlement Layer** | Solana native SOL | User deposits, provider payouts, escrow |
| **Escrow Program** | Anchor (Rust) | On-chain escrow PDAs for session payments |
| **Oracle Signing** | Ed25519 (AWS KMS or local encrypted keypair) | Treasury transaction signing |
| **User Auth** | Ed25519 signature challenge | Wallet-first login, no passwords |
| **Deposit Detection** | RPC event listener + manual verification | Auto-deposit worker + manual tx submission |
| **Payout Engine** | Batch on-chain transfers | Gas-efficient provider payouts |

### 5.3 On-Ramp Strategy (External Only)

Users are responsible for their own SOL acquisition. The platform provides:
- **Wallet linking instructions** — How to link a Phantom/Solflare wallet
- **SOL address display** — Treasury address for deposits
- **Network guidance** — Mainnet-beta vs devnet selection
- **Minimum deposit recommendations** — Based on session pricing

**No platform involvement in fiat conversion.** This keeps the system non-custodial for fiat and reduces regulatory surface area.

---

## 6. Recommendations for Improvement

### 6.1 Immediate Security Fixes (P0 — Do Before Mainnet)

| # | Recommendation | Target File |
|---|----------------|-------------|
| 6.1.1 | **Remove all hardcoded secrets** from Docker Compose files; use `${VAR:?required}` syntax | `docker-compose.*.yml` |
| 6.1.2 | **Implement KYC webhook HMAC verification** with source IP allowlisting | `internal/api/kyc.go` |
| 6.1.3 | **Add distributed transaction / saga pattern** for `circle_pool.go` revenue claims | `internal/api/circle_pool.go` |
| 6.1.4 | **Wrap subscription prorated billing** in a single database transaction | `internal/api/subscriptions.go` |
| 6.1.5 | **Verify treasury recipient address** in auto-deposit worker before crediting | `internal/worker/escrow_listener.go` |
| 6.1.6 | **Add authorization check** to `getKYCStatus` endpoint | `internal/api/kyc.go` |

### 6.2 Reliability & Testing (P1)

| # | Recommendation | Priority |
|---|----------------|----------|
| 6.2.1 | **Write comprehensive unit tests** for `transferP2P`, `withdrawSOL`, `verifyCryptoDeposit`, spending limits | Critical |
| 6.2.2 | **Add unit tests for billing worker** settlement, circuit breaker, and retry logic | Critical |
| 6.2.3 | **Add `max` validation** to `p2pTransferRequest.Amount` and `withdrawSOLRequest.Amount` | High |
| 6.2.4 | **Add rate limiting** to `/limits`, `/limits/reset`, and spending limit update endpoints | High |
| 6.2.5 | **Fix `escrow_listener.go`** to use `SELECT FOR UPDATE` and handle `tx.Commit()` errors | High |
| 6.2.6 | **Fix `CreditReferralReward`** to check `tx.Commit()` error and handle wallet creation race | High |

### 6.3 Code Quality & Cleanup (P2)

| # | Recommendation | Target |
|---|----------------|--------|
| 6.3.1 | **Remove panic recovery** or sanitize error messages in `wallet.go`, `crypto.go`, `usage.go` | Security |
| 6.3.2 | **Switch GeoIP to HTTPS** or use local MaxMind DB exclusively | Security |
| 6.3.3 | **Clean up dead `balance_usdt` column** and deprecated fiat code paths | Tech Debt |
| 6.3.4 | **Unify wallet linking** to single endpoint (`/linked-wallets`) and deprecate duplicate | Maintainability |
| 6.3.5 | **Add structured logging** to `escrow_listener.go` with correlation IDs | Observability |
| 6.3.6 | **Strengthen CSP** by removing `'unsafe-inline'` / `'unsafe-eval'` | Security |
| 6.3.7 | **Remove hardcoded CORS origin** from config fallback | Security |

### 6.4 Wallet Robustness Enhancements (P2)

| # | Recommendation | Rationale |
|---|----------------|-----------|
| 6.4.1 | **Add withdrawal confirmation flow** — require re-signing with linked wallet for withdrawals above threshold | Prevents session hijacking from draining wallets |
| 6.4.2 | **Add withdrawal delay / cooldown** for large amounts (> 10 SOL) | Time-window for fraud detection and cancellation |
| 6.4.3 | **Implement withdrawal address whitelist** — users pre-register trusted destination addresses | Prevents withdrawal to attacker-linked wallets |
| 6.4.4 | **Add real-time balance reconciliation** between `wallets.balance_sol` and sum of `wallet_ledger_entries` | Detects ledger corruption or bugs early |
| 6.4.5 | **Add anomaly detection** for unusual spending patterns | Flags potential compromised accounts |
| 6.4.6 | **Implement hot/cold wallet architecture** — keep majority of treasury in cold storage | Limits blast radius of a key compromise |
| 6.4.7 | **Add multi-signature requirement** for treasury withdrawals above threshold | Requires 2-of-3 admin signatures for large transfers |
| 6.4.8 | **Clean up all fiat/MoMo/Paystack code paths** | Remove dead code, reduce attack surface, simplify maintenance |

---

## 7. Decentralized SOL System Hardening Recommendations

### 7.1 Remove All Fiat Payment Artifacts

Since the platform is strictly decentralized and SOL-only, all fiat-related code, configuration, and database artifacts should be removed:

| Artifact | Action | Target |
|----------|--------|--------|
| `internal/payments/paystack.go` | **Delete** | Dead code |
| `internal/config/config.go` MTN MoMo fields | **Remove** | Dead configuration |
| `balance_usdt` column in `wallets` table | **Drop** via migration | Dead schema |
| `PendingTransaction.Currency` field usage | **Simplify** to always "SOL" | Code cleanup |
| `docker-compose.*.yml` MoMo/Paystack env vars | **Remove** | Infra cleanup |
| `services/relayer/workers/payout.go` (ETH/GHS legacy) | **Delete or archive** | Dead code |

### 7.2 Strengthen On-Chain Deposit Verification

**Current Gap:** The auto-deposit worker maps any known sender to a user without verifying the transaction recipient was the platform treasury.

**Fix:**
```go
func handleNativeDeposit(event solana.EscrowEvent) {
    // NEW: Verify deposit was sent TO the treasury
    if event.Recipient != treasuryAddress {
        logging.Warn().Str("sender", event.Buyer).Str("recipient", event.Recipient).
            Msg("Ignoring deposit not sent to treasury")
        return
    }
    // ... existing logic
}
```

### 7.3 Improve Linked Wallet Security

**Current Gap:** Withdrawal uses the current linked wallet without re-validation.

**Fix:**
- Require users to **set a primary withdrawal address** during wallet linking
- Any change to primary withdrawal address triggers a **24-hour cooldown** before withdrawals are permitted
- Large withdrawals (> 10 SOL) require **re-signing a challenge** with the linked wallet

### 7.4 On-Chain Transparency Features

For a decentralized system, users should have full transparency:

| Feature | Implementation |
|---------|----------------|
| **Treasury address display** | Public page showing treasury SOL address, current balance, recent batch payouts |
| **Payout tx explorer links** | Every provider payout links directly to Solscan/Explorer |
| **Escrow PDA explorer links** | Every order shows its escrow PDA with direct explorer link |
| **Real-time SOL price** | Display current SOL/USD price from CoinGecko (read-only, no trading) |
| **Network status** | Show current Solana network (mainnet/devnet), slot height, oracle health |

### 7.5 Decentralized Provider Payout Options

Providers should have flexibility in how they receive SOL:

| Option | Description |
|--------|-------------|
| **Auto-batch to linked wallet** | Default: accumulate earnings, batch payout when threshold reached |
| **Manual claim** | Provider triggers on-chain claim, pays their own gas (fully self-custodial) |
| **Stream payments** | Use Solana pay streams (e.g., Streamflow protocol) for real-time micropayments |

---

## 8. Implementation Roadmap

### Phase 1: Security Hardening (Weeks 1-2)
- [ ] Fix hardcoded secrets in Docker Compose
- [ ] Implement KYC webhook verification
- [ ] Fix revenue claim race condition
- [ ] Add authorization to KYC status endpoint
- [ ] Wrap subscription billing in transactions

### Phase 2: Testing & Reliability (Weeks 3-4)
- [ ] Write unit tests for all wallet mutations
- [ ] Write unit tests for billing worker
- [ ] Add `max` validation to transfer/withdraw amounts
- [ ] Add rate limiting to limits management endpoints
- [ ] Fix auto-deposit race conditions

### Phase 3: Decentralized Hardening (Weeks 5-6)
- [ ] Remove all fiat/MoMo/Paystack code and configuration
- [ ] Add treasury recipient verification to auto-deposit worker
- [ ] Implement withdrawal address whitelist with 24h cooldown on changes
- [ ] Add re-signing requirement for large withdrawals
- [ ] Create public treasury transparency page
- [ ] Add Solscan explorer links to all on-chain transactions
- [ ] Implement manual provider claim option (self-custodial)

### Phase 4: Advanced Decentralized Features (Weeks 7-10)
- [ ] Withdrawal confirmation via wallet re-signing
- [ ] Real-time balance reconciliation (DB vs ledger sum)
- [ ] Anomaly detection for unusual spending patterns
- [ ] Hot/cold wallet treasury architecture
- [ ] Multi-signature treasury withdrawals (2-of-3 admin)
- [ ] Solana pay stream integration for real-time provider micropayments
- [ ] Add ZK-proof verification for usage claims (re-enable edge-side ZK)

---

## 9. Conclusion

The ProxyHubb wallet system has a **solid architectural foundation** with immutable ledgers, proper cryptographic verification, circuit breakers, and thoughtful settlement flows. The migration to SOL-only was a pragmatic decision that simplifies the system significantly.

However, **critical security gaps remain** that must be addressed before any production deployment at scale:
1. Hardcoded secrets pose an immediate compromise risk
2. The unauthenticated KYC webhook is a trust-boundary bypass
3. Missing transaction wrappers create double-spend vulnerabilities
4. Inadequate test coverage for financial mutations is a liability

The **wireless/mobile payment integration** (Card Today / MTN MoMo / Paystack) should be revived as a **fiat-to-SOL on-ramp**, not as a parallel currency system. This approach maintains the simplicity of SOL settlement while lowering the barrier to entry for users who prefer mobile money or card payments.

By following the phased roadmap above, the wallet system can evolve from its current **B- grade** to a production-ready **A-grade** decentralized financial infrastructure.

**Key Principles Maintained:**
- ✅ SOL-only, no fiat, no intermediaries
- ✅ Non-custodial withdrawals to user-linked wallets
- ✅ On-chain escrow for session payments
- ✅ Immutable ledger for all balance changes
- ✅ Transparent treasury with explorer links

---

*Report compiled by automated codebase analysis on 2026-05-24.*
*Systems reviewed: Control API (Go), Edge Gateway (Rust), Solana Programs (Anchor/Rust), Web Frontend (Next.js/TypeScript), Migrations (SQL), Infrastructure (Docker Compose, K8s).*
