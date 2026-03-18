# SOL-Only Currency Migration Summary

## Overview
Migrated ProxyHubb financial system from multi-currency (SOL, USDT, GHS) to SOL-only currency system.

## Changes Made

### 1. Database Models (services/control-api/internal/models/)

#### wallet.go
- Removed `BalanceGHS`, `BalanceUSDT`, and `Currency` fields from Wallet struct
- Updated `BalanceSOL` precision to `numeric(20,9)`
- Removed multi-currency constants
- Updated transaction type constants

#### transaction.go
- Updated `PendingTransaction` to default currency to 'SOL'
- Changed amount precision to `numeric(20,9)`
- Updated comments to reflect SOL-only system

### 2. API Layer (services/control-api/internal/api/)

#### wallet.go
- Removed fiat deposit/withdrawal/swap endpoints from route registration
- Updated `getWallet` response to only return SOL balance
- Deprecated `initiateDeposit`, `initiateWithdrawal`, `verifyDeposit` with 403/400 responses
- Updated P2P transfer to be SOL-only
- Removed `getBalance` helper function

#### swap.go
- Completely replaced with deprecated endpoint returning 403 Forbidden

#### usage.go
- Changed `PricePerGB` from GHS to SOL (0.002 SOL per GB)
- Updated cost calculations to return `cost_sol` instead of `cost_ghs`

#### analytics.go
- Updated `DailyUsagePoint` to use `CostSOL` instead of `CostGHS`
- Updated cost calculations to use SOL pricing

#### auth.go, crypto.go, escrow.go, escrow_milestones.go, orders_test.go, concurrency_test.go
- Updated all wallet creation and balance references to use SOL only

### 3. Billing System (services/control-api/internal/billing/)

#### worker.go
- Already SOL-only, no changes needed

#### price.go
- Already SOL-only, no changes needed

### 4. Pricing (services/control-api/internal/pricing/)

#### price_feed.go
- Removed SOLGHS, USDCUSD, USDTUSD, BTCUSD, ETHUSD constants
- Removed `GetSOLPriceGHS()` function
- Removed `getGHSRate()` function
- Removed `ConvertGHSWithFallback()` function
- Simplified to only support SOL/USD price feeds

### 5. Treasury (services/control-api/internal/treasury/)

#### liquidity_manager.go
- Removed USDC and USDT mint addresses
- Removed stablecoin balance monitoring
- Removed `getStableThresholds()` function
- `CheckTokenLiquidity()` now returns nil (no-op for SOL-only)

#### reconciliation.go
- Removed `BalanceGHS` and `BalanceUSDT` from `UserBalanceSummary`

### 6. Test Utilities (services/control-api/internal/testutil/)

#### testutil.go
- Updated `CreateTestUser` to only set `BalanceSOL` (removed GHS/USDT)

#### wallet_test.go
- Updated tests to check for `balance_sol` instead of `balance_ghs`
- Updated deposit/withdrawal tests to expect 403/400 (fiat disabled)

### 7. Frontend (apps/web/)

#### app/dashboard/wallet/page.tsx
- Removed USDT balance card
- Added USD equivalent card based on SOL price
- Updated all balance references to use `balance_sol` only
- Removed GHS/USDT references from UI

#### lib/api/wallet.ts
- Updated `Wallet` interface to only include `balance_sol`
- Removed `currency` field
- Updated `transferFunds` to remove currency parameter

#### lib/services/wallet.ts
- Updated `Wallet` interface to only include `balance_sol`
- Removed `currency` field
- Updated `transferFunds` to remove currency parameter

### 8. Database Migration Scripts

#### migrations/000027_sol_only_currency.up.sql
- Removes `balance_ghs` and `balance_usdt` columns from wallets table
- Updates `wallet_ledger_entries` precision to `numeric(20,9)`
- Updates `pending_transactions` for SOL-only
- Provides data migration strategy

#### migrations/000027_sol_only_currency.down.sql
- Rollback script to restore multi-currency support (with warnings)

## API Changes

### Deprecated Endpoints (Return 403/400)
- `POST /v1/wallet/deposit` - Fiat deposits disabled
- `POST /v1/wallet/withdraw` - Fiat withdrawals disabled
- `GET /v1/wallet/verify` - Paystack verification disabled
- `POST /v1/wallet/swap` - Currency swapping disabled

### Updated Endpoints
- `GET /v1/wallet` - Now returns only `balance_sol`, `wallet_id`, `transactions`, `linked_solana_address`
- `POST /v1/wallet/transfer` - No longer accepts `currency` parameter (SOL only)

### Unchanged Endpoints
- `POST /v1/wallet/deposit/crypto` - Crypto deposits (SOL only)
- `POST /v1/wallet/withdraw/sol` - SOL withdrawals
- `POST /v1/wallet/link` - Wallet linking

## Pricing Updates
- Price per GB: 0.002 SOL (approximately $0.30 at current prices)

## Environment Variables
No new environment variables required. Existing variables remain:
- `SOLANA_TREASURY_ADDRESS`
- `SOLANA_NETWORK`
- `COINGECKO_API_KEY`

## Testing
- All wallet tests updated to use SOL-only
- Fiat operation tests now verify proper error responses

## Backward Compatibility
This is a **breaking change**. Frontend clients using `balance_ghs` or `balance_usdt` will need to be updated.

## Rollback Plan
Use the down migration script: `migrations/000027_sol_only_currency.down.sql`

**Note**: Any SOL-only transactions during the SOL-only period cannot be rolled back to multi-currency format.
