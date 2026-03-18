# ProxyHub SOL-Only Migration Plan

**Objective:** Remove all USDC, USDT, and Ghana Cedi (GHS) support, keeping only SOL (Solana) as the native currency.

**Date:** March 14, 2026

---

## Phase 1: Analysis (COMPLETED)

### Files Identified for Modification

#### Backend (Go)
1. `services/control-api/internal/models/wallet.go` - Remove BalanceGHS, BalanceUSDT fields
2. `services/control-api/internal/models/transaction.go` - Update Currency field default
3. `services/control-api/internal/api/wallet.go` - Remove multi-currency logic
4. `services/control-api/internal/api/swap.go` - Remove entirely (SOL<->USDT swap)
5. `services/control-api/internal/billing/worker.go` - Simplify to SOL-only
6. `services/control-api/internal/billing/price.go` - Remove USD conversion
7. `services/control-api/internal/treasury/liquidity_manager.go` - Remove token checks
8. `services/control-api/internal/treasury/reconciliation.go` - Remove multi-currency
9. `services/control-api/internal/pricing/price_feed.go` - Remove GHS/USDC/USDT
10. `services/control-api/internal/api/admin.go` - Remove GHS references
11. `services/control-api/internal/api/analytics.go` - Remove GHS references
12. `services/control-api/internal/api/escrow.go` - Remove GHS balance updates
13. `services/control-api/internal/api/orders.go` - Remove GHS references
14. `services/control-api/internal/api/subscriptions.go` - Remove GHS pricing
15. `services/control-api/internal/api/referral.go` - Change GHS to SOL rewards
16. `services/control-api/internal/api/metrics.go` - Remove GHS metrics
17. `services/control-api/internal/api/usage.go` - Change price constant
18. `services/control-api/internal/api/pricing.go` - Remove GHS conversion
19. `services/control-api/internal/api/crypto.go` - Remove multi-currency wallet creation
20. `services/control-api/internal/api/auth.go` - Remove multi-currency wallet creation
21. `services/control-api/internal/api/governance.go` - Update currency options
22. `services/control-api/internal/email/notifications.go` - Remove GHS formatting
23. `services/control-api/internal/testutil/testutil.go` - Update test wallets

#### Frontend (TypeScript/React)
1. `apps/web/src/lib/api/wallet.ts` - Remove balance_ghs, balance_usdt
2. `apps/web/src/lib/services/wallet.ts` - Remove multi-currency support
3. `apps/web/src/lib/solana.ts` - Remove USDC mint references
4. `apps/web/src/app/dashboard/wallet/page.tsx` - Simplify to SOL-only UI
5. `apps/web/src/app/dashboard/page.tsx` - Remove GHS display
6. `apps/web/src/app/marketplace/create/page.tsx` - Change price input to SOL
7. `apps/web/src/app/layout.tsx` - Update metadata
8. `apps/web/src/components/StreamingSessionCard.tsx` - Change USDT to SOL
9. `apps/web/src/app/settings/page.tsx` - Remove Ghana references
10. `apps/web/src/app/agents/page.tsx` - Update balance check message

#### Database
1. Migration to drop `balance_ghs` and `balance_usdt` columns
2. Update existing records to convert balances to SOL (if any)

#### Configuration
1. `.env` - Remove GHS/USD_GHS_RATE variables
2. `.env.example` - Remove multi-currency examples

---

## Phase 2: Database Schema Changes

### Migration Script

```sql
-- Remove multi-currency columns from wallets table
ALTER TABLE wallets 
    DROP COLUMN IF EXISTS balance_ghs,
    DROP COLUMN IF EXISTS balance_usdt,
    DROP COLUMN IF EXISTS currency;

-- Add single balance_sol column (already exists, ensure it's NOT NULL)
ALTER TABLE wallets 
    ALTER COLUMN balance_sol SET DEFAULT 0,
    ALTER COLUMN balance_sol SET NOT NULL;

-- Update pending_transactions to remove GHS default
ALTER TABLE pending_transactions 
    ALTER COLUMN currency SET DEFAULT 'SOL';

-- Remove GHS/USDC/USDT from any enums or constraints
```

---

## Phase 3: Backend API Changes

### 3.1 Wallet Model Changes

**File:** `services/control-api/internal/models/wallet.go`

**Changes:**
- Remove `BalanceGHS` field
- Remove `BalanceUSDT` field  
- Remove `Currency` field
- Keep only `BalanceSOL`

### 3.2 Remove Swap API

**File:** `services/control-api/internal/api/swap.go`

**Action:** Delete entire file

**Update:** Remove route registration in main.go

### 3.3 Simplify Billing Worker

**File:** `services/control-api/internal/billing/worker.go`

**Changes:**
- Remove `costUSDT` calculation
- Price directly in SOL: `pricePerGB = 0.0025` SOL/GB (approx $0.50 at $200/SOL)
- Remove `USDToSOL` conversion calls

### 3.4 Update Wallet API

**File:** `services/control-api/internal/api/wallet.go`

**Changes:**
- Remove `balance_ghs` from JSON responses
- Remove `balance_usdt` from JSON responses
- Remove currency swap endpoint
- Simplify P2P transfer to SOL only
- Remove fiat deposit/withdrawal endpoints (Paystack)

### 3.5 Update Treasury Management

**File:** `services/control-api/internal/treasury/liquidity_manager.go`

**Changes:**
- Remove `CheckTokenLiquidity()` function
- Remove USDC/USDT mint addresses
- Keep only SOL balance checks

---

## Phase 4: Frontend Changes

### 4.1 Simplify Wallet Types

**File:** `apps/web/src/lib/api/wallet.ts`

**Changes:**
```typescript
// Before
interface Wallet {
    id: string;
    balance_ghs: number;
    balance_sol: number;
    balance_usdt: number;
    currency: string;
}

// After
interface Wallet {
    id: string;
    balance_sol: number;
}
```

### 4.2 Update Wallet Page

**File:** `apps/web/src/app/dashboard/wallet/page.tsx`

**Changes:**
- Remove USDT/USDC balance cards
- Remove GHS balance display
- Remove currency swap UI
- Show only SOL balance
- Simplify deposit/withdraw to SOL only

### 4.3 Update Dashboard

**File:** `apps/web/src/app/dashboard/page.tsx`

**Changes:**
- Remove GHS balance from stats
- Show SOL balance only

---

## Phase 5: Testing & Validation

### Test Cases
1. Wallet creation (SOL-only)
2. Deposit verification (SOL only)
3. Withdrawal (SOL only)
4. P2P transfer (SOL only)
5. Billing settlement (SOL only)
6. Provider payout (SOL only)
7. Escrow creation/settlement (SOL only)

### Validation Checklist
- [ ] No references to USDC in codebase
- [ ] No references to USDT in codebase
- [ ] No references to GHS/Ghana Cedi in codebase
- [ ] All balances display in SOL
- [ ] All prices displayed in SOL
- [ ] Database has no multi-currency columns
- [ ] API returns only SOL balances
- [ ] Frontend shows only SOL

---

## Implementation Order

1. **Database Migration** - Drop columns safely
2. **Models** - Update Go structs
3. **Backend APIs** - Remove multi-currency logic
4. **Billing Worker** - Simplify to SOL-only
5. **Treasury** - Remove token checks
6. **Frontend Types** - Update TypeScript interfaces
7. **Frontend UI** - Simplify wallet pages
8. **Testing** - Validate everything works
9. **Cleanup** - Remove unused files

---

## Rollback Plan

If issues arise:
1. Restore columns from backup
2. Revert to previous code version
3. Run database migration rollback

---

**Estimated Time:** 2-3 days  
**Risk Level:** Medium (financial system changes)  
**Testing Required:** Extensive
