# User Spending Limits - Implementation Summary

## Overview
Implemented user-configurable spending limits to protect against compromised accounts draining wallets. Limits can be set on daily, weekly, and monthly windows.

## Default Limits by Trust Tier

| Trust Tier | Daily | Weekly | Monthly |
|------------|-------|--------|---------|
| New | 10 SOL | 50 SOL | 100 SOL |
| Verified | 50 SOL | 200 SOL | 500 SOL |
| Premium | 100 SOL | 500 SOL | 2000 SOL |

## Database Changes

### New Columns in `wallets` table:
- `daily_limit` (DECIMAL 20,9) - Daily spending limit
- `weekly_limit` (DECIMAL 20,9) - Weekly spending limit
- `monthly_limit` (DECIMAL 20,9) - Monthly spending limit
- `limit_window_start` (TIMESTAMP) - When current window started

### New Table `spending_records`:
Tracks individual spending transactions for accurate limit enforcement.
- `id` (UUID) - Primary key
- `user_id` (UUID) - User reference
- `wallet_id` (UUID) - Wallet reference
- `amount` (DECIMAL 20,9) - Amount spent (always positive)
- `type` (VARCHAR) - Type: usage, transfer, withdraw, escrow
- `reference` (VARCHAR) - Related transaction ID
- `created_at` (TIMESTAMP)

## API Endpoints

### Get Current Limits and Usage
```
GET /v1/wallet/limits

Response:
{
  "limits": {
    "daily": { "limit": 10.0, "spent": 2.5 },
    "weekly": { "limit": 50.0, "spent": 15.0 },
    "monthly": { "limit": 100.0, "spent": 45.0 }
  },
  "window_start": "2026-03-14T00:00:00Z"
}
```

### Update Limits (User-configurable, max based on trust tier)
```
PUT /v1/wallet/limits
{
  "daily": 5.0,   // Can only lower, not exceed tier max
  "weekly": 25.0
}

Response (success):
{
  "status": "success",
  "message": "Spending limits updated",
  "limits": { "daily": 5.0, "weekly": 25.0 }
}

Response (exceeds max):
{
  "error": "Daily limit exceeds maximum allowed",
  "requested": 100.0,
  "max_allowed": 10.0
}
```

### Reset to Defaults
```
POST /v1/wallet/limits/reset

Response:
{
  "status": "success",
  "message": "Spending limits reset to defaults",
  "limits": { "daily": 10.0, "weekly": 50.0, "monthly": 100.0 }
}
```

## Protected Operations

Spending limits are enforced on:

1. **Billing/Usage Charges** (`billing/worker.go`)
   - Hourly settlement of bandwidth usage
   - Prevents excessive usage charges

2. **P2P Transfers** (`api/wallet.go`)
   - User-to-user transfers
   - Returns 403 with limit details if exceeded

3. **SOL Withdrawals** (`api/wallet.go`)
   - On-chain withdrawals
   - Checked before balance deduction

## Error Response Format

When a spending limit is exceeded:

```json
{
  "error": "Spending limit exceeded",
  "limit_type": "daily",
  "limit": 10.0,
  "spent": 8.5,
  "attempted": 5.0,
  "remaining": 1.5
}
```

## Migration Scripts

- **Up**: `migrations/000028_spending_limits.up.sql`
- **Down**: `migrations/000028_spending_limits.down.sql`

## Implementation Details

### Spending Check Flow:
1. Lock wallet (FOR UPDATE)
2. Query spending_records for current window totals
3. Check if `current_spent + new_amount > limit`
4. If allowed: deduct balance, record spending, create ledger entry
5. If exceeded: rollback, return error

### Automatic Initialization:
- New wallets are initialized with default limits based on user's trust tier
- Applies to: registration, first deposit, P2P transfer receipt

### Special Cases:
- Limit of `0` means unlimited (disabled)
- Failed spending record creation doesn't fail the transaction (logged only)
- Spending records are kept for audit trail

## Security Considerations

1. **Users can only lower limits**, not exceed tier maximums
2. **Limits are per-user**, not per-wallet (user_id based tracking)
3. **Atomic checks** within database transactions
4. **Row-level locking** prevents race conditions
5. **Audit trail** via spending_records table

## Future Enhancements

- [ ] Email/notification when approaching limits
- [ ] Admin override for specific users
- [ ] Cooldown period before limit increases take effect
- [ ] Per-transaction type limits (e.g., max withdrawal size)
- [ ] Time-based limits (e.g., no withdrawals between 2-6 AM)

## Testing

Test scenarios to verify:
1. New user gets correct default limits
2. User can lower their limits
3. User cannot exceed tier maximum
4. Spending is correctly tracked across windows
5. Limit enforcement blocks transactions appropriately
6. Reset restores defaults
