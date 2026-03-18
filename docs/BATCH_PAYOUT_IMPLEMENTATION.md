# Batch Payout Processing - Implementation Summary

## Overview
Implemented batch payout processing to save ~30% on gas fees by aggregating multiple provider payouts into single transactions.

## Problem with Individual Payouts

**Before:**
- Each provider payout = 1 separate transaction
- Gas per transfer: ~0.000005 SOL
- 100 payouts = 100 transactions = 0.0005 SOL in gas

**After (Batch Processing):**
- Up to 20 payouts per transaction
- Gas per transfer in batch: ~0.0000035 SOL (30% savings)
- 100 payouts = 5 transactions = 0.00035 SOL in gas
- **Savings: ~0.00015 SOL per 100 payouts**

## Architecture

### Queue-Based Batching
```
Provider Earnings
       |
       v
[Queue Payout] (deduct from wallet, add to queue)
       |
       v
[Batch Processor] (runs every 15 minutes)
       |
       +---> Large amounts (≥10 SOL) -> Immediate transfer
       |
       +---> Regular amounts -> Queue for batch
       |
       v
[Batch Transaction] (up to 20 transfers in 1 tx)
       |
       v
[On-Chain Settlement]
```

## Database Schema

### New Tables

#### `pending_payouts` - The Queue
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| provider_id | UUID | Provider user ID |
| wallet_address | string | Solana address |
| amount_sol | decimal | Payout amount |
| priority | int | Higher = process first |
| queued_at | timestamp | When added to queue |
| scheduled_for | timestamp | Optional delayed processing |

#### `batch_payouts` - Batch Records
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Batch ID |
| status | string | pending/processing/completed/partial/failed |
| total_amount | decimal | Sum of all payouts |
| total_count | int | Number of payouts |
| success_count | int | Successful transfers |
| failed_count | int | Failed transfers |
| tx_hash | string | Solana transaction signature |
| gas_fee_lamports | bigint | Actual gas used |

#### `batch_payout_items` - Individual Items
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Item ID |
| batch_id | UUID | Parent batch |
| provider_id | UUID | Provider user ID |
| wallet_address | string | Destination address |
| amount_sol | decimal | Payout amount |
| status | string | pending/completed/failed |

## Configuration

### Default Batch Config
```go
{
    ImmediateThresholdSOL:     10.0,  // Process immediately if ≥ 10 SOL
    MaxBatchSize:              20,    // Max 20 payouts per batch
    MinBatchSize:              5,     // Don't batch fewer than 5
    MaxWaitTime:               30 * time.Minute,
    ProcessInterval:           15 * time.Minute,
    SingleTransferGasLamports: 5000,  // 0.000005 SOL
    BatchTransferGasLamports:  3500,  // 0.0000035 SOL (30% savings)
}
```

## API Endpoints

### Admin Endpoints

#### Get Payout Queue
```
GET /v1/admin/payouts/queue

Response:
{
  "pending_count": 45,
  "displayed": 50,
  "total_pending": 127.5,
  "items": [...]
}
```

#### Force Process Batches
```
POST /v1/admin/payouts/process

Response:
{
  "status": "processing",
  "message": "Batch processing started in background"
}
```

#### Get Batch History
```
GET /v1/admin/payouts/batches?limit=20&offset=0&status=completed

Response:
{
  "batches": [...],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

#### Get Batch Details
```
GET /v1/admin/payouts/batches/:id

Response:
{
  "batch": {...},
  "items": [...]
}
```

#### Get Payout Stats
```
GET /v1/admin/payouts/stats

Response:
{
  "batch_stats": {
    "total_batches": 150,
    "total_payouts": 2847,
    "total_amount_sol": 15234.56,
    "average_batch_size": 18.98,
    "savings_percent": 30.0
  },
  "pending_count": 45,
  "retry_count": 3,
  "today_total": 523.45
}
```

## Processing Logic

### When are payouts processed?

1. **Immediate Processing** (≥ 10 SOL)
   - Large payouts bypass the queue
   - Processed immediately for provider convenience

2. **Batch Processing** (triggered by):
   - Queue reaches `MinBatchSize` (5 payouts)
   - Oldest payout waits longer than `MaxWaitTime` (30 min)
   - Periodic check every `ProcessInterval` (15 min)

3. **Priority Queue**
   - Larger amounts get higher priority
   - FIFO within same priority level

### Batch Execution Flow

1. Lock wallet balance (deduct from provider wallet)
2. Add to `pending_payouts` queue
3. Batch processor picks up eligible payouts
4. Create `batch_payouts` record
5. Move items to `batch_payout_items`
6. Build single transaction with all transfers
7. Sign and submit to Solana
8. Update records with tx_hash and status

## Fallback Mechanism

If batch processing fails:
1. Mark batch as failed
2. Re-queue individual items to `payout_retry_queue`
3. Retry worker processes individually
4. Balance is never lost (atomic deduction only after queue success)

## Migration Scripts

- **Up**: `migrations/000029_batch_payouts.up.sql`
- **Down**: `migrations/000029_batch_payouts.down.sql`

## Gas Savings Calculation

```
Savings = (SingleGas - BatchGasPerTransfer) * NumberOfTransfers

Example for 100 payouts:
= (5000 - 3500) * 100
= 1500 * 100
= 150,000 lamports
= 0.00015 SOL saved

At $200/SOL: $0.03 saved per 100 payouts
At scale (10,000 payouts/day): $3/day = $90/month
```

## Monitoring

### Key Metrics
- Queue depth (pending_payouts count)
- Average batch size
- Gas savings per batch
- Failed batch rate
- Time in queue (p95)

### Alerts
- Queue depth > 100 (backlog warning)
- Failed batches > 5% (system issue)
- Oldest payout > 1 hour (processing delay)

## Testing

Test scenarios:
1. Single small payout (should queue)
2. Large payout ≥ 10 SOL (immediate)
3. Multiple payouts batching correctly
4. Batch failure fallback to individual retry
5. Gas savings calculation accuracy
6. Queue priority ordering

## Future Enhancements

- [ ] Dynamic batch sizing based on network congestion
- [ ] Time-based batching (e.g., all payouts at midnight)
- [ ] Smart batching by wallet (group by provider region)
- [ ] Gas price oracle for optimal timing
- [ ] Provider preference (immediate vs batch)
