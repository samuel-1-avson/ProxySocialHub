# ProxyHubb Wallet System — Implementation Plan
## SOL-Only Decentralized Architecture

**Version:** 1.0  
**Date:** 2026-05-24  
**Status:** Ready for execution  
**Estimated Duration:** 10 weeks (with 2 engineers)  

---

## Overview

This plan addresses all critical weaknesses in the ProxyHubb wallet system and hardens it for a pure SOL, fully decentralized deployment. No fiat. No payment processors. Just Solana.

---

## Phase 1: Security Lockdown (Week 1)
**Goal:** Eliminate all critical vulnerabilities before any mainnet activity.
**Risk if skipped:** Fund loss, unauthorized KYC elevation, double-spend attacks.

### 1.1 Remove Hardcoded Secrets from Docker Compose
**Priority:** P0  
**Effort:** 2 hours  
**Files:**
- `docker-compose.full.yml`
- `docker-compose.minimal.yml`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml` (if exists)

**Changes:**
```yaml
# BEFORE (insecure fallback)
- PROVIDER_PRIVATE_KEY=${PROVIDER_PRIVATE_KEY:-750cb0f0d0b7dce54567b0394513cd19a2ab6d21d4691696179061c20da297d1}

# AFTER (fail if unset)
- PROVIDER_PRIVATE_KEY=${PROVIDER_PRIVATE_KEY:?PROVIDER_PRIVATE_KEY is required}
```

Apply this pattern to ALL env vars that previously had `:-default` fallbacks, especially:
- `PROVIDER_PRIVATE_KEY`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `ORACLE_KEYPAIR_ENCRYPTION_KEY`
- `JWT_SECRET`
- `AWS_KMS_KEY_ID` (if applicable)

**Deliverable:** Docker Compose files that refuse to start if any secret is missing.

---

### 1.2 Implement KYC Webhook Authentication
**Priority:** P0  
**Effort:** 1 day  
**File:** `services/control-api/internal/api/kyc.go`

**Current state:**
```go
func handleKYCWebhook(c *gin.Context) {
    // P0: In production, verify webhook signature/source IP here.
```

**Required implementation:**
1. **IP allowlist check:** Verify `c.ClientIP()` against a configured list of KYC provider IPs
2. **HMAC signature verification:** Verify `X-Webhook-Signature` header against a shared secret
3. **Timestamp tolerance:** Reject payloads older than 5 minutes
4. **Idempotency:** Store processed webhook IDs in Redis with 24h TTL to prevent replay

```go
func handleKYCWebhook(c *gin.Context) {
    // 1. IP allowlist
    if !isAllowedKYCIP(c.ClientIP()) {
        c.AbortWithStatus(http.StatusForbidden)
        return
    }
    
    // 2. HMAC verification
    body, _ := io.ReadAll(c.Request.Body)
    signature := c.GetHeader("X-Webhook-Signature")
    if !verifyKYCHmac(body, signature, os.Getenv("KYC_WEBHOOK_SECRET")) {
        c.AbortWithStatus(http.StatusForbidden)
        return
    }
    
    // 3. Timestamp check
    timestamp := c.GetHeader("X-Webhook-Timestamp")
    if !isWithinTolerance(timestamp, 5*time.Minute) {
        c.AbortWithStatus(http.StatusForbidden)
        return
    }
    
    // 4. Idempotency
    webhookID := c.GetHeader("X-Webhook-ID")
    if !redis.SetNX("kyc:webhook:"+webhookID, "1", 24*time.Hour).Val() {
        c.JSON(http.StatusOK, gin.H{"status": "already processed"})
        return
    }
    
    // ... existing logic
}
```

**Deliverable:** KYC webhooks cannot be spoofed. Trust tier elevation requires valid provider signature.

---

### 1.3 Fix Revenue Claim Race Condition
**Priority:** P0  
**Effort:** 1 day  
**File:** `services/control-api/internal/api/circle_pool.go`

**Current state:** Separate DB operations across two databases with no distributed transaction.

**Fix:** Use idempotency key + atomic update.

```go
func ClaimRevenue(ctx context.Context, userID uuid.UUID, revenueIDs []uuid.UUID) error {
    idempotencyKey := fmt.Sprintf("claim:%s:%s", userID, hashRevenueIDs(revenueIDs))
    
    // 1. Idempotency guard
    if !redis.SetNX(idempotencyKey, "processing", 10*time.Minute).Val() {
        return errors.New("claim already in progress or completed")
    }
    defer redis.Del(idempotencyKey)
    
    // 2. Atomic update: mark revenues claimed ONLY if all are unclaimed
    result := db.Social().Exec(`
        UPDATE revenues 
        SET claimed = true, claimed_at = NOW()
        WHERE id IN ? AND claimed = false AND user_id = ?
    `, revenueIDs, userID)
    
    if result.RowsAffected != int64(len(revenueIDs)) {
        return errors.New("some revenues already claimed or do not belong to user")
    }
    
    // 3. Calculate total
    var totalAmount float64
    db.Social().Model(&models.Revenue{}).Where("id IN ?", revenueIDs).Select("SUM(amount)").Scan(&totalAmount)
    
    // 4. Credit wallet in same logical transaction (compensating rollback on failure)
    err := db.DB.Transaction(func(tx *gorm.DB) error {
        if err := tx.Model(&models.Wallet{}).Where("user_id = ?", userID).
            Update("balance_sol", gorm.Expr("balance_sol + ?", totalAmount)).Error; err != nil {
            return err
        }
        return tx.Create(&models.WalletLedgerEntry{
            UserID: userID,
            Type:   "revenue_claim",
            Amount: totalAmount,
            Metadata: map[string]interface{}{"revenue_ids": revenueIDs},
        }).Error
    })
    
    if err != nil {
        // Compensating: unmark revenues as claimed
        db.Social().Exec(`UPDATE revenues SET claimed = false WHERE id IN ?`, revenueIDs)
        return err
    }
    
    return nil
}
```

**Deliverable:** Revenue claims are idempotent and atomic. No double-spend possible.

---

### 1.4 Fix Subscription Prorated Billing Transaction
**Priority:** P0  
**Effort:** 4 hours  
**File:** `services/control-api/internal/api/subscriptions.go`

**Fix:** Wrap wallet update, ledger entry, and plan update in a single transaction.

```go
err := db.DB.Transaction(func(tx *gorm.DB) error {
    // 1. Update wallet
    if err := tx.Model(&wallet).Update("balance_sol", newBal).Error; err != nil {
        return err
    }
    
    // 2. Create ledger entry
    if err := tx.Create(&models.WalletLedgerEntry{
        UserID: userID,
        Type:   "subscription_proration",
        Amount: netSOL,
        Metadata: map[string]interface{}{
            "old_plan": oldPlan.ID,
            "new_plan": newPlan.ID,
        },
    }).Error; err != nil {
        return err
    }
    
    // 3. Update subscription plan
    return tx.Model(&subscription).Updates(map[string]interface{}{
        "plan_id": newPlan.ID,
        "updated_at": time.Now(),
    }).Error
})
```

**Deliverable:** Subscription changes are atomic. No partial state possible.

---

### 1.5 Fix Auto-Deposit Treasury Verification
**Priority:** P0  
**Effort:** 3 hours  
**File:** `services/control-api/internal/worker/escrow_listener.go`

**Fix:** Before crediting any deposit, verify the on-chain recipient matches the configured treasury address.

```go
var treasuryAddress = os.Getenv("SOLANA_TREASURY_ADDRESS")

func handleNativeDeposit(event solana.EscrowEvent) {
    if event.Recipient != treasuryAddress {
        logging.Warn().
            Str("sender", event.Buyer).
            Str("recipient", event.Recipient).
            Str("expected", treasuryAddress).
            Msg("Deposit ignored: recipient is not treasury")
        return
    }
    // ... existing logic
}
```

**Deliverable:** Only deposits actually sent to the platform treasury are credited.

---

## Phase 2: Testing & Reliability (Weeks 2-3)
**Goal:** Achieve >80% test coverage on all financial mutation paths.
**Risk if skipped:** Undetected bugs in fund-moving code.

### 2.1 Write Unit Tests for Wallet Transfers
**Priority:** P1  
**Effort:** 3 days  
**File:** `services/control-api/internal/api/wallet_test.go` (expand from 249 lines to ~800)

**Test cases to add:**
```go
func TestTransferP2P_Success(t *testing.T)      // happy path
func TestTransferP2P_InsufficientBalance(t *testing.T)
func TestTransferP2P_SelfTransfer(t *testing.T)   // should block
func TestTransferP2P_SameWallet(t *testing.T)     // should block
func TestTransferP2P_SpendingLimitExceeded(t *testing.T)
func TestTransferP2P_ConcurrentTransfers(t *testing.T)  // race condition test
func TestTransferP2P_LedgerEntriesCreated(t *testing.T)
func TestTransferP2P_OnChainFallback(t *testing.T)
```

**Technique:** Use `testify/suite` with a test database (SQLite in-memory or test Postgres container). Mock Solana client for on-chain paths.

---

### 2.2 Write Unit Tests for Withdrawals
**Priority:** P1  
**Effort:** 2 days  
**File:** `services/control-api/internal/api/wallet_test.go`

**Test cases:**
```go
func TestWithdrawSOL_Success(t *testing.T)
func TestWithdrawSOL_InsufficientBalance(t *testing.T)
func TestWithdrawSOL_OnChainFailureCompensates(t *testing.T)
func TestWithdrawSOL_SpendingLimitExceeded(t *testing.T)
func TestWithdrawSOL_NoLinkedWallet(t *testing.T)
func TestWithdrawSOL_InvalidAmount(t *testing.T)
```

**Mock:** Use `mock_solana_client.go` that implements `SendSOL()` with configurable success/failure.

---

### 2.3 Write Unit Tests for Crypto Deposits
**Priority:** P1  
**Effort:** 2 days  
**File:** `services/control-api/internal/api/crypto_test.go` (new)

**Test cases:**
```go
func TestVerifyCryptoDeposit_Success(t *testing.T)
func TestVerifyCryptoDeposit_DoubleSpend(t *testing.T)      // same tx_hash twice
func TestVerifyCryptoDeposit_SenderMismatch(t *testing.T)
func TestVerifyCryptoDeposit_InvalidChain(t *testing.T)
func TestVerifyCryptoDeposit_TxNotFound(t *testing.T)
func TestVerifyCryptoDeposit_AmountMismatch(t *testing.T)
```

---

### 2.4 Write Unit Tests for Spending Limits
**Priority:** P1  
**Effort:** 1 day  
**File:** `services/control-api/internal/models/spending_limit_test.go` (new)

**Test cases:**
```go
func TestCheckSpendingLimit_WithinLimit(t *testing.T)
func TestCheckSpendingLimit_ExceedsDaily(t *testing.T)
func TestCheckSpendingLimit_ExceedsWeekly(t *testing.T)
func TestCheckSpendingLimit_ExceedsMonthly(t *testing.T)
func TestCheckSpendingLimit_WindowReset(t *testing.T)
func TestRecordSpending_Atomic(t *testing.T)
```

---

### 2.5 Write Unit Tests for Billing Worker
**Priority:** P1  
**Effort:** 4 days  
**File:** `services/control-api/internal/billing/worker_test.go` (new)

**Test cases:**
```go
func TestSettleUsage_Success(t *testing.T)
func TestSettleUsage_BuyerInsufficientBalance(t *testing.T)
func TestSettleUsage_CircuitBreakerOpens(t *testing.T)
func TestSettleUsage_ProviderPayoutQueued(t *testing.T)
func TestSettleUsage_Ed25519SignatureInvalid(t *testing.T)
func TestDebitBuyerWallet_Atomic(t *testing.T)
func TestCreditProviderWallet_Atomic(t *testing.T)
func TestTriggerProviderPayout_OnChainFailure(t *testing.T)
func TestPayoutRetryWorker_ExponentialBackoff(t *testing.T)
```

**Technique:** Mock Redis, mock Solana client, use test DB. Verify circuit breaker state transitions.

---

### 2.6 Add Input Validation
**Priority:** P1  
**Effort:** 4 hours  
**File:** `services/control-api/internal/api/wallet.go`

**Changes:**
```go
type p2pTransferRequest struct {
    RecipientIdentifier string  `json:"recipient" binding:"required"`
    Amount              float64 `json:"amount" binding:"required,gt=0,lte=10000"` // max 10,000 SOL
}

type withdrawSOLRequest struct {
    Amount float64 `json:"amount" binding:"required,gt=0,lte=10000"`
}
```

Also add runtime check:
```go
const maxTransferSOL = 10000.0
if req.Amount > maxTransferSOL {
    c.JSON(http.StatusBadRequest, gin.H{"error": "amount exceeds maximum transfer limit"})
    return
}
```

---

### 2.7 Add Rate Limiting to Limits Management
**Priority:** P1  
**Effort:** 2 hours  
**File:** `services/control-api/internal/api/wallet.go`

**Changes:**
```go
wallet.GET("/limits", getSpendingLimits)
wallet.PUT("/limits", RateLimitWithConfig(10, time.Minute), updateSpendingLimits)
wallet.POST("/limits/reset", RateLimitWithConfig(5, time.Minute), resetSpendingLimits)
```

---

### 2.8 Fix Escrow Listener Race Conditions
**Priority:** P1  
**Effort:** 1 day  
**File:** `services/control-api/internal/worker/escrow_listener.go`

**Changes:**
1. Use `SELECT FOR UPDATE` when looking up/creating wallets
2. Handle `tx.Commit()` errors properly
3. Use `ON CONFLICT DO NOTHING` with retry for wallet creation races

```go
err := db.DB.Transaction(func(tx *gorm.DB) error {
    var wallet models.Wallet
    err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
        Where("user_id = ?", userID).First(&wallet).Error
    
    if err == gorm.ErrRecordNotFound {
        wallet = models.Wallet{UserID: userID, BalanceSOL: 0}
        if err := tx.Create(&wallet).Error; err != nil {
            // Handle unique constraint violation (another tx created it)
            if isUniqueViolation(err) {
                return tx.Clauses(clause.Locking{Strength: "UPDATE"}).
                    Where("user_id = ?", userID).First(&wallet).Error
            }
            return err
        }
    } else if err != nil {
        return err
    }
    
    // Credit deposit
    wallet.BalanceSOL += amount
    if err := tx.Save(&wallet).Error; err != nil {
        return err
    }
    
    return tx.Create(&models.WalletLedgerEntry{
        UserID: userID,
        Type:   "deposit",
        Amount: amount,
    }).Error
})

if err != nil {
    logging.Error(err).Msg("Failed to process deposit")
    return err
}
```

---

## Phase 3: Cleanup & Decentralized Hardening (Weeks 4-6)
**Goal:** Remove fiat artifacts, strengthen on-chain security, improve transparency.

### 3.1 Remove Fiat Payment Code
**Priority:** P2  
**Effort:** 2 days  

**Delete or archive:**
- [ ] `services/control-api/internal/payments/paystack.go` → delete
- [ ] `services/control-api/internal/payments/` directory → remove if empty
- [ ] `services/relayer/workers/payout.go` (ETH/GHS legacy) → archive to `legacy/` or delete
- [ ] `services/control-api/internal/config/config.go` — remove MTN MoMo fields
- [ ] `docker-compose.*.yml` — remove MoMo/Paystack env vars
- [ ] `.env.example` — remove fiat-related variables

**Migration:**
```sql
-- Drop dead column
ALTER TABLE wallets DROP COLUMN IF EXISTS balance_usdt;

-- Clean up any remaining fiat pending transactions
DELETE FROM pending_transactions WHERE currency != 'SOL';
```

---

### 3.2 Sanitize Panic Recovery
**Priority:** P2  
**Effort:** 3 hours  
**Files:** `services/control-api/internal/api/wallet.go`, `crypto.go`, `usage.go`

**Change all panic recoverers to:**
```go
defer func() {
    if r := recover(); r != nil {
        logging.Error(fmt.Errorf("panic: %v", r)).
            Str("handler", "getWallet").
            Str("user_id", userID.String()).
            Msg("Recovered from panic")
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Internal Server Error",
            "code": "INTERNAL_ERROR",
        })
    }
}()
```

Never return raw panic values to clients.

---

### 3.3 Fix Referral Reward Transaction
**Priority:** P2  
**Effort:** 2 hours  
**File:** `services/control-api/internal/api/referral.go`

```go
tx := db.DB.Begin()
// ... operations ...
if err := tx.Commit().Error; err != nil {
    tx.Rollback()
    logging.Error(err).Msg("Referral reward commit failed")
    return err
}
```

---

### 3.4 Fix Compensating Refund Error Handling
**Priority:** P2  
**Effort:** 2 hours  
**File:** `services/control-api/internal/api/wallet.go`

```go
if err := db.DB.Transaction(func(tx *gorm.DB) error {
    // compensating refund...
}).Error; err != nil {
    logging.Error(err).
        Str("user_id", userID.String()).
        Float64("amount", req.Amount).
        Msg("CRITICAL: Compensating refund failed — user may have lost funds")
    // Alert on-call via Watchtower/PagerDuty
    alert.OnCall("compensating_refund_failed", userID, req.Amount)
}
```

---

### 3.5 Implement Withdrawal Security
**Priority:** P2  
**Effort:** 2 days  **Files:** `services/control-api/internal/api/wallet.go`, `services/control-api/internal/models/wallet.go`

**Database migration:**
```sql
ALTER TABLE wallets ADD COLUMN withdrawal_whitelist JSONB DEFAULT '[]';
ALTER TABLE wallets ADD COLUMN primary_withdrawal_address VARCHAR(44);
ALTER TABLE wallets ADD COLUMN withdrawal_address_changed_at TIMESTAMPTZ;
```

**Logic:**
- First linked wallet = automatic primary withdrawal address
- Changing primary withdrawal address sets `withdrawal_address_changed_at = NOW()`
- Withdrawals blocked for 24 hours after address change
- Withdrawals > 10 SOL require re-signing a nonce with the linked wallet

```go
func withdrawSOL(c *gin.Context) {
    // ... existing validation ...
    
    // Check cooldown
    if wallet.PrimaryWithdrawalAddress != nil && 
       wallet.WithdrawalAddressChangedAt != nil &&
       time.Since(*wallet.WithdrawalAddressChangedAt) < 24*time.Hour {
        c.JSON(http.StatusForbidden, gin.H{
            "error": "Withdrawal address changed recently. Please wait 24 hours.",
        })
        return
    }
    
    // Large withdrawal requires re-signature
    if req.Amount > 10.0 {
        if !verifyWithdrawalSignature(c, userID, req.Amount, req.Nonce, req.Signature) {
            c.JSON(http.StatusForbidden, gin.H{"error": "Signature verification required for large withdrawals"})
            return
        }
    }
    
    // ... proceed with withdrawal ...
}
```

---

### 3.6 Add Real-Time Balance Reconciliation
**Priority:** P2  
**Effort:** 1 day  **File:** `services/control-api/internal/treasury/reconciliation.go` (expand)

**New worker:** Runs every hour.

```go
func ReconcileUserWallets() {
    var discrepancies []ReconciliationDiscrepancy
    
    db.DB.Raw(`
        SELECT 
            w.id,
            w.user_id,
            w.balance_sol as db_balance,
            COALESCE(SUM(CASE 
                WHEN type IN ('deposit', 'p2p_received', 'revenue_claim') THEN amount 
                WHEN type IN ('withdrawal', 'p2p_sent', 'session_payment') THEN -amount 
                ELSE 0 
            END), 0) as ledger_balance
        FROM wallets w
        LEFT JOIN wallet_ledger_entries le ON w.user_id = le.user_id
        GROUP BY w.id, w.user_id, w.balance_sol
        HAVING w.balance_sol != COALESCE(SUM(...), 0)
    `).Scan(&discrepancies)
    
    for _, d := range discrepancies {
        logging.Error().
            Str("user_id", d.UserID.String()).
            Float64("db_balance", d.DBBalance).
            Float64("ledger_balance", d.LedgerBalance).
            Float64("diff", d.DBBalance - d.LedgerBalance).
            Msg("WALLET RECONCILIATION DISCREPANCY DETECTED")
        
        alert.Critical("wallet_reconciliation_failed", d)
    }
}
```

---

### 3.7 Add Anomaly Detection
**Priority:** P2  
**Effort:** 2 days  **File:** `services/control-api/internal/worker/anomaly_detector.go` (new)

**Rules:**
- More than 5 withdrawals in 1 hour → flag account
- Withdrawal amount > 3x historical average → flag account  
- P2P transfer to new recipient > 50 SOL → flag account
- Session spend > 10x normal usage pattern → flag account

**Action:** Flag in `user_flags` table, notify security team, optionally freeze withdrawals pending review.

---

### 3.8 Switch GeoIP to HTTPS
**Priority:** P2  
**Effort:** 30 minutes  **File:** `services/control-api/internal/geoip/resolver.go`

```go
url := fmt.Sprintf("https://ip-api.com/json/%s?fields=...", ip)
```

Or better: use the local `geoip/GeoLite2-Country.mmdb` file exclusively (already in repo).

---

## Phase 4: Advanced Decentralized Features (Weeks 7-10)
**Goal:** Treasury hardening, multi-sig, transparency, optional pay streams.

### 4.1 Hot/Cold Wallet Architecture
**Priority:** P2  
**Effort:** 3 days  **Files:** `services/control-api/internal/treasury/treasury_manager.go`, `services/control-api/internal/solana/client.go`

**Design:**
- **Hot wallet:** Holds ~10% of treasury (used for daily batch payouts)
- **Cold wallet:** Holds ~90% of treasury (multi-sig, rarely used)
- **Auto-replenish:** When hot wallet drops below threshold, trigger multi-sig transfer from cold wallet

**Config:**
```yaml
SOLANA_TREASURY_HOT_ADDRESS: ...
SOLANA_TREASURY_COLD_ADDRESS: ...
SOLANA_TREASURY_HOT_MIN_BALANCE: 100  # SOL
SOLANA_TREASURY_HOT_MAX_BALANCE: 500  # SOL
SOLANA_TREASURY_REPLENISH_AMOUNT: 200 # SOL
```

---

### 4.2 Multi-Signature Treasury Withdrawals
**Priority:** P2  
**Effort:** 4 days  **Files:** New service + on-chain program update

**Design:**
- Admin treasury withdrawals > 100 SOL require 2-of-3 admin signatures
- Use Squads Protocol or custom multi-sig on Solana
- Each admin signs a proposal, on-chain program executes only after threshold met

**Alternative (simpler):**
- Off-chain multi-sig: 3 admin keys stored separately
- `TreasuryManager` requires 2 signatures to construct a transaction
- Use `solana.Multisig` program or manual threshold logic

---

### 4.3 Treasury Transparency Page
**Priority:** P2  
**Effort:** 2 days  **Files:** `apps/web/src/app/treasury/page.tsx` (new)

**Public data (no auth required):**
- Treasury SOL address
- Current treasury balance (hot + cold)
- Recent batch payout tx hashes with Solscan links
- Total provider earnings paid (lifetime)
- Current SOL/USD price
- Network status (mainnet slot, oracle health)

---

### 4.4 Add Explorer Links to All On-Chain Operations
**Priority:** P2  
**Effort:** 1 day  **Files:** Web frontend + API response payloads

**Where to add links:**
- Deposit confirmation → Solscan tx link
- Withdrawal completion → Solscan tx link  
- Provider payout → Solscan batch tx link
- Escrow creation → Solscan tx link + Explorer PDA link

```typescript
const getSolscanUrl = (signature: string) => 
  `https://solscan.io/tx/${signature}?cluster=${network}`;
```

---

### 4.5 Manual Provider Claim (Self-Custodial)
**Priority:** P2  
**Effort:** 3 days  **Files:** `services/control-api/internal/api/provider_claim.go` (new)

**Feature:** Provider can trigger an on-chain claim themselves:
1. API returns a signed transaction payload (not yet submitted)
2. Provider signs with their own wallet
3. Provider submits to Solana network themselves
4. Platform verifies on-chain and updates DB

This removes the platform as an intermediary for provider payouts.

---

### 4.6 Solana Pay Stream Integration (Optional)
**Priority:** P3  
**Effort:** 5 days  **Files:** New integration module

**Use Streamflow or Zebec Protocol:**
- Real-time micropayments to providers as bandwidth is used
- Eliminates batch payout delay
- Fully on-chain, transparent

**Trade-off:** Higher gas cost per session, but better UX for providers.

---

## Execution Checklist

### Week 1: Security Lockdown
- [x] 1.1 Remove hardcoded secrets from Docker Compose
- [x] 1.2 Implement KYC webhook authentication
- [x] 1.3 Fix revenue claim race condition
- [x] 1.4 Fix subscription billing transaction
- [x] 1.5 Fix auto-deposit treasury verification

### Weeks 2-3: Testing & Reliability
- [x] 2.1 Unit tests for P2P transfers
- [x] 2.2 Unit tests for withdrawals
- [x] 2.3 Unit tests for crypto deposits
- [x] 2.4 Unit tests for spending limits
- [x] 2.5 Unit tests for billing worker
- [x] 2.6 Add max amount validation
- [x] 2.7 Add rate limiting to limits endpoints
- [x] 2.8 Fix escrow listener race conditions

### Weeks 4-6: Cleanup & Hardening
- [x] 3.1 Remove fiat payment code
- [x] 3.2 Sanitize panic recovery
- [x] 3.3 Fix referral reward transaction
- [x] 3.4 Fix compensating refund error handling
- [x] 3.5 Implement withdrawal security (cooldown + re-signing)
- [x] 3.6 Add balance reconciliation worker
- [x] 3.7 Add anomaly detection worker
- [x] 3.8 Switch GeoIP to HTTPS or local DB

### Weeks 7-10: Advanced Features
- [x] 4.1 Hot/cold wallet architecture (see `docs/TREASURY_4.1_AUDIT.md`)
- [x] 4.2 Multi-sig treasury withdrawals (`/v1/treasury/withdrawals/*`, >100 SOL)
- [x] 4.3 Treasury transparency page (`/treasury`, `GET /v1/treasury/public`)
- [x] 4.4 Add explorer links everywhere
- [x] 4.5 Manual provider claim option (`/v1/provider/claim/*`)
- [ ] 4.6 Solana pay streams — **deferred** until production treasury path is stable
- [ ] 4.6 Solana pay stream integration (optional)

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Critical security issues (P0) | 4 | 0 |
| Test coverage (wallet API) | ~15% | >80% |
| Test coverage (billing worker) | 0% | >70% |
| Fiat code paths | Multiple | 0 |
| Compensating refund failures | Silent | Alerted + logged |
| KYC webhook auth | None | HMAC + IP + idempotency |
| Withdrawal security | Session-only | Session + signature + cooldown |

---

## Dependencies

| Resource | Needed For |
|----------|-----------|
| Test Postgres instance | All unit tests |
| Redis (test) | Rate limiting, idempotency tests |
| Solana devnet | Integration tests for on-chain ops |
| AWS KMS test key | HSM signing tests (optional) |
| 2 Go engineers | Parallel execution of phases |

---

*Plan ready for execution. Start with Phase 1 (Security Lockdown) immediately.*
