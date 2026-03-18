# ProxyHub — Master Implementation Plan
## Fixing All Issues: Explorer · Blockchain Engine · Financial Engine

**Date:** 2026-03-17
**Source Reports:**
- `PROXY_EXPLORER_AND_BLOCKCHAIN_ENGINE_ANALYSIS.md`
- `FINANCIAL_ENGINE_DEEP_DIVE_ANALYSIS.md`

**Total Issues Tracked:** 69 bugs · 16 security vulnerabilities · 14 financial correctness failures · 17 integration gaps · 20+ missing implementations

---

## How to Read This Plan

Every item follows this format:

```
### [TICKET-ID] Short Title
- **File(s):** path/to/file.go:line
- **Issue:** What is wrong
- **Fix:** Exactly what to change and how
- **Risk if skipped:** Consequence in production
- **Complexity:** XS / S / M / L / XL
- **Depends on:** other ticket IDs that must come first
```

Priorities:
- **P0 — Pre-Launch Blocker:** Service is unsafe to run with real money until fixed
- **P1 — Sprint 1 (Week 1–2):** Critical correctness and reliability
- **P2 — Sprint 2 (Week 3–4):** Security hardening and data quality
- **P3 — Backlog (Month 2+):** Architecture improvements and completeness

---

## Executive Snapshot

| Priority | Count | Theme |
|----------|-------|-------|
| P0 | 20 items | Fund loss · panics · key exposure · broken core features |
| P1 | 22 items | Race conditions · missing indexes · auth gaps · data correctness |
| P2 | 17 items | Security hardening · architecture cleanup · monitoring |
| P3 | 14 items | Long-term architecture · DeFi · audit completeness |
| **Total** | **73** | |

---

## P0 — Pre-Launch Blockers
### Must be resolved before any real-money usage

---

### [P0-01] Fix: Provider Wallet Not Credited on Fetch Failure

- **File:** `services/control-api/internal/billing/worker.go:176-179`
- **Issue:** If the provider's wallet row is not found (new provider, DB error), `settleSession()` debits the buyer but silently skips crediting the provider. SOL disappears into the void.
- **Fix:**
  1. Change the `if err == nil` guard to `if err != nil { tx.Rollback(); return fmt.Errorf("provider wallet not found for %s: %w", providerID, err) }`.
  2. Create the provider wallet inside the transaction if it doesn't exist (using `clause.OnConflict{DoNothing: true}` then re-fetch).
  3. The settlement must be atomic: if provider wallet cannot be credited, buyer must not be debited. Roll back the entire transaction.
- **Risk if skipped:** Every session where a provider has no wallet entry loses the buyer's payment permanently.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P0-02] Fix: Batch Payout Double-Processing (Missing Lock)

- **File:** `services/control-api/internal/billing/batch_payout.go:202`
- **Issue:** `ProcessPendingBatches()` fetches pending payouts with no row lock. Two concurrent calls (scheduled + manual force-process) fetch the same rows and both submit on-chain transfers.
- **Fix:**
  1. Replace the plain `Find(&pending)` with a PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` via GORM:
     ```go
     db.DB.Set("gorm:query_option", "FOR UPDATE SKIP LOCKED").
         Where("scheduled_for IS NULL OR scheduled_for <= ?", time.Now()).
         Order("priority DESC, queued_at ASC").
         Limit(bp.config.MaxBatchSize).
         Find(&pending)
     ```
  2. Wrap the entire fetch + batch creation in a single database transaction.
  3. Mark fetched rows as `status = 'processing'` before releasing the lock.
- **Risk if skipped:** Double payments to providers, on-chain fund loss.
- **Complexity:** M
- **Depends on:** Nothing

---

### [P0-03] Fix: Double-Spend After On-Chain Success + DB Failure

- **File:** `services/control-api/internal/billing/batch_payout.go:278-296`
- **Issue:** If `batchFunc()` succeeds (SOL sent on-chain) but `db.DB.Save(&batch)` fails, items are re-queued via `requeueIndividual()`, causing a second on-chain transfer.
- **Fix:**
  1. Before calling `batchFunc()`, record the batch as `status = 'submitted'` with a generated idempotency key.
  2. After `batchFunc()` returns a `txHash`, attempt `db.DB.Save()` in a retry loop (up to 3 times with 1s backoff) before falling back.
  3. In `requeueIndividual()`, check whether the idempotency key already has a completed on-chain tx before re-queuing — query the Solana RPC to confirm the tx is not already finalized.
  4. Store the `txHash` in the batch record *before* attempting the DB save, so re-entry points can check it.
- **Risk if skipped:** Providers receive double payment; treasury depleted.
- **Complexity:** L
- **Depends on:** [P0-02]

---

### [P0-04] Fix: Staked SOL Permanently Lost on Unstake

- **File:** `services/control-api/internal/api/staking.go:157-161`
- **Issue:** `unstakeNode()` resets the quality score but never returns the staked SOL to the provider's wallet. The SOL is deducted in `stakeNode()` and never returned.
- **Fix:**
  1. Add a `StakedAmountSOL float64` field to `ProviderNode` model (migration required).
  2. In `stakeNode()`: store `req.AmountSOL` in `node.StakedAmountSOL`.
  3. In `unstakeNode()`:
     ```go
     tx := db.DB.Begin()
     tx.Model(&wallet).UpdateColumn("balance_sol", gorm.Expr("balance_sol + ?", node.StakedAmountSOL))
     tx.Create(&WalletLedgerEntry{Amount: node.StakedAmountSOL, EntryType: "stake_return"})
     tx.Model(&node).Updates(map[string]interface{}{"quality_score": resetScore, "staked_amount_sol": 0})
     tx.Commit()
     ```
  4. Remove the fake `tx_hash` return — either call an on-chain instruction or document that staking is off-chain only.
- **Risk if skipped:** Every provider who stakes loses their SOL permanently.
- **Complexity:** M
- **Depends on:** DB migration for `staked_amount_sol` column

---

### [P0-05] Fix: Division by Zero in Subscription Billing

- **File:** `services/control-api/internal/api/subscriptions.go:96-109`
- **Issue:** `priceSOL := priceUSD / solPrice` panics or produces `+Inf` if `GetSOLPrice()` returns `0`.
- **Fix:**
  ```go
  solPrice, err := prices.GetSOLPrice(c.Request.Context())
  if err != nil || solPrice <= 0 {
      c.JSON(503, gin.H{"error": "price service unavailable — cannot compute SOL amount"})
      return
  }
  priceSOL := priceUSD / solPrice
  ```
  Also fix `billing/price.go:134-136`: `USDToSOL()` must return `(0, error)` signature when price ≤ 0, not silently return `0`.
- **Risk if skipped:** Any subscription purchase during a price feed outage crashes the service.
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P0-06] Fix: Typo `ConvertSOLTUSD` → `ConvertSOLToUSD`

- **File:** `services/control-api/internal/api/pricing.go:74`
- **Issue:** Method name `ConvertSOLTUSD` does not exist. Every call to the SOL→USD conversion endpoint panics at runtime.
- **Fix:**
  ```go
  // Before:
  result, err = pf.ConvertSOLTUSD(amount)
  // After:
  result, err = pf.ConvertSOLToUSD(amount)
  ```
  Search the entire codebase for other instances of this typo.
- **Risk if skipped:** The `/v1/pricing/convert` endpoint crashes every call.
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P0-07] Make Velocity Guard Mandatory — Fail Fast on Nil

- **File:** `services/control-api/internal/solana/client.go:82-84`, `main.go`
- **Issue:** `OracleClient.velocity` is `nil` by default. If `SetVelocityGuard()` is not called, all transfers proceed with no rate limiting.
- **Fix:**
  1. In `NewOracleClient()`, **require** a `*VelocityGuard` parameter — do not make it optional:
     ```go
     func NewOracleClient(rpcEndpoints []string, programID string, oracleKeyPath string, vg *VelocityGuard) (*OracleClient, error) {
         if vg == nil {
             return nil, fmt.Errorf("FATAL: VelocityGuard is required to create OracleClient")
         }
         ...
     }
     ```
  2. In `SendSOL()` and `BatchTransferSOL()`, replace the log warning with a hard error:
     ```go
     if c.velocity == nil {
         return "", fmt.Errorf("SECURITY: cannot transfer %.6f SOL — VelocityGuard not initialized", amountSOL)
     }
     ```
  3. In `main.go`, ensure `VelocityGuard` is constructed before `OracleClient`.
- **Risk if skipped:** Any code path that creates an `OracleClient` without setting a guard can drain the treasury unchecked.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P0-08] Fix: Random Nonce Breaks Usage Idempotency

- **File:** `services/control-api/internal/api/usage.go:70`
- **Issue:** A new random nonce is generated on every call to `reportUsage()`. Retried requests (network issues, at-least-once delivery from edge gateway) count usage twice.
- **Fix:**
  1. Derive the nonce deterministically from `sessionID + reportTimestampFlooredToMinute + gatewayNodeID`:
     ```go
     nonceInput := fmt.Sprintf("%s:%d:%s", sessionID, time.Now().Truncate(time.Minute).Unix(), gatewayNodeID)
     h := sha256.Sum256([]byte(nonceInput))
     nonce := binary.BigEndian.Uint64(h[:8])
     ```
  2. Store processed nonces in Redis with a 2-minute TTL for deduplication at the aggregator level.
- **Risk if skipped:** Every network retry doubles the billed bandwidth; providers are overpaid, buyers are overcharged.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P0-09] Fix: On-Chain Escrow Never Settled When DB Releases

- **File:** `services/control-api/internal/api/escrow.go:97-103`
- **Issue:** `releaseEscrow()` updates the DB record to `released` but never calls `settlement.SettleEscrow()`. The Solana program escrow account stays locked forever.
- **Fix:**
  1. After updating the DB status to `released`, call the settlement service:
     ```go
     if order.EscrowPDA != "" && order.SellerWallet != "" {
         params := solana.SettleEscrowParams{
             EscrowPDA:    order.EscrowPDA,
             Buyer:        order.BuyerWallet,
             Seller:       order.SellerWallet,
             AmountLamports: uint64(sellerAmount * solana.LamportsPerSOL),
         }
         txHash, err := oracleClient.SettleEscrow(ctx, params)
         if err != nil {
             // Roll back DB status to "held" and return error
             tx.Rollback()
             c.JSON(500, gin.H{"error": "on-chain settlement failed: " + err.Error()})
             return
         }
         order.TxSignature = txHash
     }
     ```
  2. Same fix in `AutoReleaseExpiredEscrows()`.
  3. Add the same fix for the refund path in `resolveEscrowDispute()`.
- **Risk if skipped:** Escrow funds are locked on-chain forever; sellers can never withdraw. Chain and DB permanently diverge.
- **Complexity:** L
- **Depends on:** Oracle client available in escrow handler (wire dependency in main.go)

---

### [P0-10] Fix: Transaction Amounts Always 0.0 in Blockchain Indexer

- **File:** `services/control-api/internal/indexer/blockchain_indexer.go:287-329`
- **Issue:** The indexer hardcodes `amount := 0.0` and never extracts actual SOL transfer amounts from transaction balance deltas. Every explorer transaction shows `0.0 SOL`.
- **Fix:**
  ```go
  // After fetching blockResult.Transactions[i]:
  amount := 0.0
  toAddr := ""

  if tx.Meta != nil && len(tx.Meta.PreBalances) > 1 && len(tx.Meta.PostBalances) > 1 {
      // fromAddr = accountKeys[0] (fee payer / sender)
      // Find the account whose balance INCREASED (recipient)
      for idx, postBal := range tx.Meta.PostBalances {
          preBal := tx.Meta.PreBalances[idx]
          if postBal > preBal && idx > 0 { // idx 0 is fee payer (net negative)
              delta := postBal - preBal
              amount = float64(delta) / float64(LamportsPerSOL)
              if idx < len(accountKeys) {
                  toAddr = accountKeys[idx].String()
              }
              break
          }
      }
  }
  ```
  Also handle SPL token transfers by inspecting `tx.Meta.PreTokenBalances` / `PostTokenBalances` for future token support.
- **Risk if skipped:** Every transaction in the explorer shows $0.00 — the explorer is useless for financial visibility.
- **Complexity:** M
- **Depends on:** Nothing

---

### [P0-11] Fix: `toAddress` Always Empty in Blockchain Indexer

- **File:** `services/control-api/internal/indexer/blockchain_indexer.go:319`
- **Issue:** `toAddr` is declared as `""` and never populated. All `ToAddress` fields in `ExplorerTransaction` are empty, breaking wallet lookup pages for inbound transactions.
- **Fix:** Covered jointly with [P0-10] above — the balance delta loop identifies both the recipient address and the amount in one pass.
- **Risk if skipped:** Wallet pages show no inbound transactions. Recipient-based TX history is permanently broken.
- **Complexity:** XS (bundled with P0-10)
- **Depends on:** [P0-10]

---

### [P0-12] Fix: Program ID Filter Override in Blockchain Indexer

- **File:** `services/control-api/internal/indexer/blockchain_indexer.go:267-276`
- **Issue:**
  ```go
  if !isRelevant {
      isRelevant = true  // Overrides the filter — indexes EVERYTHING
  }
  ```
  This line negates the entire program-ID filter. Every transaction on every Solana block is indexed, regardless of whether it involves ProxyHub.
- **Fix:** Delete the `if !isRelevant { isRelevant = true }` block entirely. Optionally, add a configurable `IndexAllTransactions bool` flag that must be explicitly set to `true` in config.
- **Risk if skipped:** Database fills with millions of unrelated Solana transactions, degrading performance and misleading users.
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P0-13] Fix: Node Map Shows All Pins at (0, 0)

- **File:** `services/control-api/internal/indexer/node_sync.go:165-178`
- **Issue:** `Latitude: 0, Longitude: 0` hardcoded. The GeoIP resolver (`internal/geoip/resolver.go`) exists but is never called.
- **Fix:**
  1. Inject the GeoIP resolver into `NodeSyncService`.
  2. In the sync loop, resolve the node's IP address:
     ```go
     if node.IPAddress != "" {
         if geo, err := geoResolver.Resolve(node.IPAddress); err == nil {
             explorerNode.Latitude  = geo.Latitude
             explorerNode.Longitude = geo.Longitude
             explorerNode.City      = geo.City
             explorerNode.Region    = geo.Region
             explorerNode.Country   = geo.Country
         }
     }
     ```
  3. Remove the static `regionMap` — use GeoIP as the single source of truth for country names.
- **Risk if skipped:** Node map is non-functional. All nodes appear at a single point in the ocean off Africa.
- **Complexity:** S
- **Depends on:** GeoIP database file exists (`geoip/GeoLite2-Country.mmdb`)

---

### [P0-14] Fix: Plaintext Reserve Keypair — Use Encrypted Storage

- **File:** `services/control-api/internal/treasury/treasury_manager.go:197`
- **Issue:** `LoadKeypairFromFile(reserveKeyPath)` reads a private key directly from the filesystem with no encryption.
- **Fix (Immediate — no KMS required):**
  1. Encrypt the keypair JSON file at rest using AES-256-GCM with the key derived from `RESERVE_KEYPAIR_ENCRYPTION_KEY` env var.
  2. Create a helper: `LoadEncryptedKeypairFromFile(path, encryptionKey string) (sol.PrivateKey, error)`.
  3. Clear the key from memory after use: `defer zeroBytesInSlice(keypairBytes)`.
- **Fix (Long-term — see P2-07):** Migrate to AWS KMS, HashiCorp Vault, or GCP Secret Manager.
- **Risk if skipped:** Container escape, log leak, or volume misconfiguration exposes a wallet holding potentially $200,000+.
- **Complexity:** M
- **Depends on:** `RESERVE_KEYPAIR_ENCRYPTION_KEY` environment variable added to docker-compose and deployment config

---

### [P0-15] Add Unique Database Constraint on `idempotency_key`

- **File:** `services/control-api/internal/models/transaction.go:15`, new migration file
- **Issue:** `IdempotencyKey` field has no unique constraint. Two concurrent requests with the same key both insert, defeating idempotency entirely.
- **Fix:**
  1. Create migration `000041_idempotency_key_unique.up.sql`:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_transactions_idempotency_key
         ON pending_transactions(idempotency_key)
         WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
     ```
  2. Update all code paths that create `PendingTransaction` to handle `duplicate key` errors gracefully (fetch the existing record instead of failing).
- **Risk if skipped:** Duplicate deposits, duplicate payouts on retry.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P0-16] Fix: Velocity Guard Redis Race — Use Lua Script

- **File:** `services/control-api/internal/solana/velocity.go:97-104`
- **Issue:** `IncrByFloat` + `Expire` are two separate Redis commands. Between them, the key can be modified by another goroutine. The rollback (`IncrByFloat` by `-amount`) is also non-atomic.
- **Fix:** Replace the multi-command sequence with a single Lua script:
  ```lua
  -- KEYS[1] = velocity key, ARGV[1] = amount, ARGV[2] = max, ARGV[3] = window_seconds
  local current = tonumber(redis.call('GET', KEYS[1])) or 0
  local newval = current + tonumber(ARGV[1])
  if newval > tonumber(ARGV[2]) then
      return redis.error_reply('VELOCITY_EXCEEDED')
  end
  redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return tostring(newval)
  ```
  Execute with `redis.Eval(ctx, luaScript, keys, args)`.
- **Risk if skipped:** Multiple concurrent transfers can each individually pass the velocity check and together exceed the hourly limit.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P0-17] Fix: Velocity Guard Redis Failure Must Block, Not Allow

- **File:** `services/control-api/internal/solana/velocity.go:113-115`
- **Issue:**
  ```go
  } else {
      log.Printf("[VelocityGuard] Redis error — proceeding without hourly check", err)
  }
  ```
  Redis failure silently bypasses the hourly check.
- **Fix:**
  ```go
  } else {
      return fmt.Errorf("velocity guard: Redis unavailable — transfer blocked for safety: %w", err)
  }
  ```
  If allowing a degraded mode is intentional, make it an explicit opt-in via `VELOCITY_ALLOW_REDIS_FAILURE=true` env var, which must be explicitly set and should page the on-call engineer.
- **Risk if skipped:** During any Redis restart or network partition, unlimited transfers are permitted.
- **Complexity:** XS
- **Depends on:** [P0-16]

---

### [P0-18] Fix: Velocity Guard Freeze State Must Persist in Redis

- **File:** `services/control-api/internal/solana/velocity.go:30`
- **Issue:** `frozen atomic.Bool` is in-process memory only. A pod restart clears the freeze state.
- **Fix:**
  1. Replace `atomic.Bool` with a Redis key `velocity:frozen` (set = frozen, absent = not frozen).
  2. `Freeze()`: `redis.Set(ctx, "velocity:frozen", "1", 0)` (no expiry — permanent until unfrozen)
  3. `IsFrozen()`: `redis.Exists(ctx, "velocity:frozen") > 0`
  4. `Unfreeze()`: `redis.Del(ctx, "velocity:frozen")`
  5. Keep the in-process `atomic.Bool` as a local cache, refreshed from Redis on every `Check()` call.
- **Risk if skipped:** An emergency freeze is cleared by any pod restart, allowing transfers to resume.
- **Complexity:** S
- **Depends on:** [P0-16]

---

### [P0-19] Fix: Admin Payout Routes Have No Authorization

- **File:** `services/control-api/internal/api/admin_payouts.go:34-38`
- **Issue:** Any authenticated user can call `/admin/payouts/force-process` or retry failed payouts.
- **Fix:**
  ```go
  func RegisterAdminPayoutRoutes(r *gin.RouterGroup) {
      admin := r.Group("", RequirePermission("payouts:admin"))
      admin.GET("/queue", getPayoutQueue)
      admin.POST("/force-process", forceProcessBatches)
      admin.GET("/history", getBatchHistory)
      admin.GET("/history/:batchId", getBatchDetails)
      admin.GET("/stats", getPayoutStats)
      admin.POST("/retry/:payoutId", retryFailedPayout)
  }
  ```
  Ensure `RequirePermission("payouts:admin")` middleware checks the user's role/permission claim in the JWT.
- **Risk if skipped:** Any authenticated user can drain the payout queue, force batch submissions, or retry individual payouts.
- **Complexity:** XS
- **Depends on:** Permission middleware exists in the codebase

---

### [P0-20] Fix: Hardcoded $150 Emergency SOL Price — Block in Production

- **File:** `services/control-api/internal/billing/price.go:83-87`
- **Issue:** The emergency fallback hardcodes `150.0 USD/SOL`. SOL has traded significantly above $150 for extended periods, systematically overcharging users during price feed outages.
- **Fix:**
  1. Remove the hardcoded `150.0` default.
  2. Make `EMERGENCY_SOL_PRICE_USD` a **required** env var in production (`SOLANA_NETWORK=mainnet`).
  3. If the env var is unset in production, return an error — do not silently use a stale value:
     ```go
     func getEmergencyFallback() (float64, error) {
         if p := os.Getenv("EMERGENCY_SOL_PRICE_USD"); p != "" {
             return strconv.ParseFloat(p, 64)
         }
         if os.Getenv("SOLANA_NETWORK") == "mainnet" {
             return 0, fmt.Errorf("EMERGENCY_SOL_PRICE_USD must be set on mainnet")
         }
         return 150.0, nil  // Only acceptable on devnet
     }
     ```
  4. Alert (Slack/email) whenever the fallback price is used.
- **Risk if skipped:** Users pay incorrect amounts during any price feed interruption; amounts could be 30–50% wrong.
- **Complexity:** S
- **Depends on:** Alert delivery mechanism (see P1-13)

---

## P1 — Sprint 1 (Week 1–2)
### Critical correctness, race conditions, data integrity

---

### [P1-01] Add Database Indexes on Explorer Transaction Columns

- **File:** New migration `migrations/000041_explorer_indexes.up.sql`
- **Issue:** `explorer_transactions` has no indexes on `from_address`, `to_address`, `timestamp`, `status`. Wallet history pages do full table scans.
- **Fix:**
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_explorer_tx_from_address
      ON explorer_transactions(from_address) WHERE from_address != '';

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_explorer_tx_to_address
      ON explorer_transactions(to_address) WHERE to_address != '';

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_explorer_tx_timestamp
      ON explorer_transactions(timestamp DESC);

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_explorer_tx_status
      ON explorer_transactions(status);

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_explorer_nodes_is_active
      ON explorer_nodes(is_active);

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_explorer_blocks_chain
      ON explorer_blocks(chain);
  ```
  Use `CONCURRENTLY` to avoid locking in production.
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P1-02] Fix: WebSocket Hub Race Condition on Polling State Variables

- **File:** `services/control-api/internal/api/explorer_ws.go:206-207`
- **Issue:** `lastTxTime` and `lastBlockNumber` are accessed by multiple goroutines without mutex protection.
- **Fix:**
  ```go
  type ExplorerHub struct {
      // ... existing fields
      pollMu          sync.Mutex
      lastTxTime      time.Time
      lastBlockNumber uint64
  }

  // In startPolling():
  h.pollMu.Lock()
  savedLastTxTime := h.lastTxTime
  savedLastBlock  := h.lastBlockNumber
  h.pollMu.Unlock()

  // After fetching new data:
  h.pollMu.Lock()
  h.lastTxTime      = newLastTxTime
  h.lastBlockNumber = newLastBlock
  h.pollMu.Unlock()
  ```
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-03] Fix: WebSocket Hub Goroutine Leak on Slow Clients

- **File:** `services/control-api/internal/api/explorer_ws.go:154-156`
- **Issue:** Slow clients have messages dropped but connections kept open indefinitely, accumulating zombie connections.
- **Fix:**
  1. Add a consecutive-drop counter per client (`slowDropCount int`).
  2. After 3 consecutive drops, close the connection:
     ```go
     entry.slowDropCount++
     if entry.slowDropCount >= 3 {
         h.unregister <- entry.conn
         entry.conn.Close()
     }
     ```
  3. Reset `slowDropCount` to 0 on every successful send.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-04] Replace WebSocket DB Polling with NATS Events

- **File:** `services/control-api/internal/api/explorer_ws.go:203-239`
- **Issue:** The WS hub polls the database every 5 seconds. Events are always 0–5 seconds late, and polling does not scale.
- **Fix:**
  1. Subscribe to NATS subjects `explorer.new_block` and `explorer.new_transaction` in the hub.
  2. When the blockchain indexer writes a new block/transaction, publish to NATS instead of relying on the poll tick.
  3. Keep the 5-second poll as a fallback/catch-up mechanism only (not primary).
  4. In `blockchain_indexer.go`, after `OnNewBlock(block)` callback:
     ```go
     natsConn.Publish("explorer.new_block", marshalBlock(block))
     natsConn.Publish("explorer.new_transaction", marshalTx(tx))
     ```
- **Complexity:** L
- **Depends on:** NATS is already in the docker-compose stack

---

### [P1-05] Fix: Batch Payout Infinite Retry — Add Max Retry Limit

- **File:** `services/control-api/internal/billing/batch_payout.go:295`
- **Issue:** Failed payouts are re-queued indefinitely. Permanent failures (bad address, program rejection) spin forever.
- **Fix:**
  1. Add `RetryCount int` and `MaxRetries int` fields to `PayoutRetryQueue` model.
  2. In `requeueIndividual()`:
     ```go
     if item.RetryCount >= item.MaxRetries {
         item.Status = "dead_lettered"
         item.ErrorMessage = "Max retries exceeded"
         db.DB.Save(&item)
         alertFn("Payout Dead-Lettered", fmt.Sprintf("Payout %s failed after %d attempts", item.ID, item.MaxRetries))
         return
     }
     item.RetryCount++
     ```
  3. Default `MaxRetries = 8`.
  4. Create an admin endpoint to inspect and manually retry dead-lettered items.
- **Complexity:** M
- **Depends on:** Alert delivery (P1-13)

---

### [P1-06] Fix: P2P Wallet Locking Logic Refactor

- **File:** `services/control-api/internal/api/wallet.go:360-382`
- **Issue:** The map-based wallet pointer assignment is error-prone and confusing. The lock ordering logic is correct in principle but the implementation is fragile.
- **Fix:** Replace the map trick with explicit ordered locking:
  ```go
  // Sort IDs to prevent deadlock
  ids := []string{senderID, recipientID}
  sort.Strings(ids)

  var firstWallet, secondWallet models.Wallet
  if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
      Where("user_id = ?", ids[0]).First(&firstWallet).Error; err != nil {
      tx.Rollback()
      return
  }
  if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
      Where("user_id = ?", ids[1]).First(&secondWallet).Error; err != nil {
      tx.Rollback()
      return
  }
  // Assign back to named variables
  var senderWallet, recipientWallet *models.Wallet
  if ids[0] == senderID {
      senderWallet, recipientWallet = &firstWallet, &secondWallet
  } else {
      senderWallet, recipientWallet = &secondWallet, &firstWallet
  }
  ```
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-07] Add Negative Balance Prevention — DB Constraint

- **File:** New migration file
- **Issue:** `balance_sol` has no CHECK constraint. Race conditions or bugs can produce negative balances with no database-level protection.
- **Fix:**
  ```sql
  -- Migration: 000042_wallet_balance_non_negative.up.sql
  ALTER TABLE wallets
      ADD CONSTRAINT chk_wallets_balance_non_negative
      CHECK (balance_sol >= 0);
  ```
  Also add `CHECK` constraints on `daily_limit >= 0`, `weekly_limit >= 0`, `monthly_limit >= 0`.
- **Complexity:** XS
- **Depends on:** Verify no existing negative balances first: `SELECT COUNT(*) FROM wallets WHERE balance_sol < 0`

---

### [P1-08] Fix: Escrow Auto-Release Race — Add Row Lock

- **File:** `services/control-api/internal/api/escrow.go:320-355`
- **Issue:** `AutoReleaseExpiredEscrows()` processes each expired escrow without a lock. Two concurrent cron invocations double-pay sellers.
- **Fix:**
  ```go
  // Use SELECT FOR UPDATE SKIP LOCKED in the query
  db.DB.Set("gorm:query_option", "FOR UPDATE SKIP LOCKED").
      Where("status = ? AND auto_release_at <= ?", "held", time.Now()).
      Find(&expiredEscrows)

  // Immediately mark as processing before releasing the lock
  for _, escrow := range expiredEscrows {
      db.DB.Model(&escrow).UpdateColumn("status", "processing")
  }
  ```
  Also add a `unique` constraint on the auto-release operation using a `released_at` timestamp.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-09] Fix: Milestone Double-Release — Add Unique Constraint

- **File:** `services/control-api/internal/api/escrow_milestones.go:41`
- **Issue:** Two concurrent calls to `CheckAndReleaseMilestones()` for the same escrow can both release the same milestone.
- **Fix:**
  1. Use `SELECT FOR UPDATE` on the milestone row before checking status.
  2. Add DB unique constraint: `UNIQUE(escrow_transaction_id, milestone_index)` already exists — but also add a partial unique index:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_milestones_one_release_per_milestone
         ON escrow_milestones(escrow_transaction_id, milestone_index)
         WHERE status = 'released';
     ```
  3. Use `UPDATE ... WHERE status = 'pending' RETURNING *` to atomically claim the milestone.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-10] Fix: Subscription Charges Must Create Ledger Entries

- **File:** `services/control-api/internal/api/subscriptions.go:125-126`
- **Issue:** Subscription debits update `balance_sol` directly without creating a `WalletLedgerEntry`. Reconciliation cannot account for subscription revenue.
- **Fix:**
  ```go
  // Inside the transaction:
  newBalance := wallet.BalanceSOL - priceSOL
  tx.Model(&wallet).Update("balance_sol", newBalance)
  tx.Create(&models.WalletLedgerEntry{
      WalletID:     wallet.ID,
      Amount:       -priceSOL,
      BalanceAfter: newBalance,
      EntryType:    "subscription",
      ReferenceID:  subscription.ID.String(),
      Note:         fmt.Sprintf("Subscription: %s (%s)", plan.Name, req.BillingCycle),
  })
  ```
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P1-11] Fix: Subscription Plan Query Uses Wrong Database

- **File:** `services/control-api/internal/api/subscriptions.go:27`
- **Issue:** `db.Social()` queries the Supabase social DB for subscription plans that are in the main DB.
- **Fix:** Change `db.Social()` to `db.DB` for all `SubscriptionPlan` and `UserSubscription` queries. Verify which tables live in which database and enforce consistency.
- **Complexity:** S
- **Depends on:** Confirm where `SubscriptionPlan` data is seeded

---

### [P1-12] Fix: Escrow Milestone Sum Validation

- **File:** `services/control-api/internal/api/escrow_milestones.go`
- **Issue:** `milestone.Amount` values are not validated to sum to `escrow.Amount`. Over- or under-payment is silently possible.
- **Fix:**
  ```go
  // In CreateEscrowForOrder or wherever milestones are created:
  var totalMilestoneAmount float64
  for _, m := range milestones {
      totalMilestoneAmount += m.Amount
  }
  if math.Abs(totalMilestoneAmount - escrow.Amount) > 0.000001 {
      return fmt.Errorf("milestone amounts (%.9f) do not sum to escrow amount (%.9f)",
          totalMilestoneAmount, escrow.Amount)
  }
  ```
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P1-13] Implement Treasury Alert Delivery (Slack / Email)

- **File:** `services/control-api/internal/treasury/treasury_manager.go:300-309`
- **Issue:** `notifyManualTopupNeeded()` is a stub that only logs. Critical treasury events are invisible to operators.
- **Fix:**
  1. Create `internal/alerts/financial.go` with:
     ```go
     func SendTreasuryAlert(title, message string, urgency string) {
         // Slack webhook via SLACK_TREASURY_WEBHOOK_URL env var
         // Email via existing SMTP config (already wired in main.go)
         // PagerDuty via PAGERDUTY_TREASURY_KEY if urgency == "critical"
     }
     ```
  2. Call from `notifyManualTopupNeeded()`, `triggerEmergencyTopup()` start, and any velocity guard freeze event.
  3. Add `SLACK_TREASURY_WEBHOOK_URL` to docker-compose env vars.
- **Complexity:** M
- **Depends on:** Existing SMTP config in main.go

---

### [P1-14] Fix: Provider Earnings — Unique Constraint on Session

- **File:** `services/control-api/internal/models/provider_earnings.go`, new migration
- **Issue:** No unique constraint on `(provider_user_id, session_id)`. Multiple earning records per session cause duplicate payouts.
- **Fix:**
  ```sql
  -- Migration: 000043_provider_earning_session_unique.up.sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_earnings_session_unique
      ON provider_earnings(provider_user_id, session_id)
      WHERE deleted_at IS NULL;
  ```
  Update `recordProviderEarning()` to use `INSERT ... ON CONFLICT DO NOTHING` and check the result.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-15] Fix: WebSocket Reconnect Exponential Backoff

- **File:** `apps/web/src/lib/hooks/useExplorerWS.ts:82`
- **Issue:** Fixed 5-second reconnect interval causes thundering herd on server restart.
- **Fix:**
  ```typescript
  const reconnectDelay = useRef(1000); // Start at 1s

  const scheduleReconnect = () => {
      const delay = Math.min(reconnectDelay.current, 30000); // Cap at 30s
      reconnectDelay.current = delay * 2; // Exponential backoff
      // Add jitter: ±20% of delay
      const jitter = delay * 0.2 * (Math.random() * 2 - 1);
      reconnectTimer.current = setTimeout(connect, delay + jitter);
  };

  // On successful connection:
  reconnectDelay.current = 1000; // Reset on success
  ```
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P1-16] Add AbortController to All Explorer Fetch Calls

- **File:** `apps/web/src/lib/services/explorer.ts`
- **Issue:** No request cancellation. Pending requests after component unmount cause React state updates on unmounted components.
- **Fix:** Update every fetch function signature to accept an optional `signal: AbortSignal`:
  ```typescript
  export async function getExplorerMetrics(signal?: AbortSignal): Promise<ExplorerMetrics> {
      const response = await fetch(`${API_URL}/v1/explorer/metrics`, {
          signal,
          headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
          throw new Error(`Explorer metrics failed: HTTP ${response.status} ${response.url}`);
      }
      return response.json();
  }
  ```
  In React pages, create an `AbortController` in `useEffect` and pass its `signal` to queries.
- **Complexity:** M (affects ~20 functions)
- **Depends on:** Nothing

---

### [P1-17] Fix: Explorer API — Add Redis Cache Layer

- **File:** `services/control-api/internal/api/explorer.go`
- **Issue:** Every explorer request hits the database directly. High-traffic endpoints (`/metrics`, `/leaderboard`, `/stats`) have no caching.
- **Fix:**
  1. Create `internal/cache/explorer_cache.go` with a generic `CacheWithTTL(key string, ttl time.Duration, fn func() (interface{}, error))` helper using Redis.
  2. Apply to hot endpoints:
     - `/metrics` → 30-second TTL
     - `/stats` → 30-second TTL
     - `/leaderboard` → 60-second TTL
     - `/nodes/geo` → 5-minute TTL
     - `/analytics` → 5-minute TTL
  3. Invalidate on new block/transaction events from NATS (from P1-04).
- **Complexity:** M
- **Depends on:** [P1-04] for invalidation; independently useful without it

---

### [P1-18] Fix: Spending Limit Timezone — Use UTC Windows Consistently

- **File:** `services/control-api/internal/models/spending_limit.go:106-108`
- **Issue:** Window boundaries use local time truncation. The "day" boundary differs per server timezone, producing inconsistent limits.
- **Fix:**
  ```go
  now := time.Now().UTC()
  dayStart   := now.Truncate(24 * time.Hour)  // Already UTC — correct
  weekStart  := now.AddDate(0, 0, -int(now.Weekday())).Truncate(24 * time.Hour)
  // ^ Sunday-based week — document this explicitly or change to ISO week (Monday)
  monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
  ```
  Ensure the server always runs with `TZ=UTC` (add to Dockerfile: `ENV TZ=UTC`).
- **Complexity:** XS
- **Depends on:** Nothing

---

### [P1-19] Fix: Billing Worker Redis Key Parsing

- **File:** `services/control-api/internal/billing/worker.go:99-103`
- **Issue:** The key `billing:session:{credentialsUser}:pending` is parsed to extract `credentialsUser`, but then used to query sessions by `credentials_user`, which may not match the actual session identifier.
- **Fix:**
  1. Audit how Redis session keys are set (trace from `StoreSession` in `redisClient`).
  2. Ensure the key format is `billing:session:{sessionID}:pending` where `sessionID` is the UUID primary key.
  3. Update the worker to query `WHERE id = ?` instead of `WHERE credentials_user = ?`.
  4. Add a test that verifies the key extraction matches the DB lookup.
- **Complexity:** M
- **Depends on:** Full audit of Redis key formats across the codebase

---

### [P1-20] Fix: Escrow Buyer Refund Amount — Include Partial Releases

- **File:** `services/control-api/internal/api/escrow.go:252-253`
- **Issue:** On dispute resolution in buyer's favor, `escrow.Amount` is refunded — not the remaining held amount. If milestones have already released partial amounts, the buyer receives more than what's held.
- **Fix:**
  ```go
  // Calculate actual remaining amount
  var releasedSoFar float64
  db.DB.Model(&models.EscrowMilestone{}).
      Where("escrow_transaction_id = ? AND status = 'released'", escrow.ID).
      Select("COALESCE(SUM(amount), 0)").Scan(&releasedSoFar)

  refundAmount := escrow.Amount - releasedSoFar
  if refundAmount <= 0 {
      // Nothing left to refund
      return
  }
  newBalance := buyerWallet.BalanceSOL + refundAmount
  ```
- **Complexity:** S
- **Depends on:** Nothing

---

### [P1-21] Fix: Tier Score Formula — Enterprise Tier Must Be Reachable

- **File:** `services/control-api/internal/worker/tier_evaluator.go:44-77`
- **Issue:** Maximum achievable score is 80. Enterprise tier requires ≥ 90. No node can ever reach enterprise.
- **Fix:**
  1. Rebalance the formula to reach 100:
     ```go
     uptimeComponent  := node.UptimePercent * 0.5          // max: 50 points
     sessionComponent := math.Min(float64(sessions)/2000, 1) * 25  // max: 25 points
     disputePenalty   := math.Min(float64(node.DisputeCount)*5, 20) // max: -20 points
     latencyScore     := 0.0
     if node.AvgLatencyMs > 0 && node.AvgLatencyMs < 100  { latencyScore = 15.0 }
     else if node.AvgLatencyMs < 250 { latencyScore = 7.5 }
     bandwidthBonus   := math.Min(float64(node.TotalBandwidthGB)/10000, 1) * 10  // max: 10 points
     score := uptimeComponent + sessionComponent - disputePenalty + latencyScore + bandwidthBonus
     // Maximum: 50 + 25 + 15 + 10 = 100
     ```
  2. Add a 48-hour grace period before downgrading from a higher tier.
- **Complexity:** M
- **Depends on:** Nothing

---

### [P1-22] Fix: Escrow Listener — Retry Dropped Events

- **File:** `services/control-api/internal/worker/escrow_listener.go:41-46`
- **Issue:** If a blockchain event arrives before the Order is committed to DB, the event is silently dropped. No retry mechanism.
- **Fix:**
  1. Publish dropped events to a NATS subject `escrow.init.retry` with the event payload.
  2. Start a retry consumer that polls every 5 seconds for up to 60 seconds:
     ```go
     for attempt := 0; attempt < 12; attempt++ {
         time.Sleep(5 * time.Second)
         if order, err := db.DB.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err == nil {
             // Process normally
             return
         }
     }
     // After 60s, log error and alert — human intervention required
     alertFn("Escrow Init Lost", "Order not found for EscrowPDA: " + event.EscrowPDA)
     ```
- **Complexity:** M
- **Depends on:** [P1-13] for alerting

---

## P2 — Sprint 2 (Week 3–4)
### Security hardening, architectural improvements, monitoring

---

### [P2-01] Migrate Oracle/Reserve Keys to Secrets Manager

- **Files:** `treasury/treasury_manager.go`, `solana/client.go`, `main.go`
- **Issue:** Private keys are read from filesystem paths. No HSM or secrets manager integration.
- **Fix:**
  1. Abstract key loading behind an interface: `KeyProvider interface { LoadPrivateKey(keyID string) ([]byte, error) }`.
  2. Implement `FileKeyProvider` (current behavior, for development).
  3. Implement `AWSSecretsKeyProvider` using `aws-sdk-go-v2/service/secretsmanager`.
  4. Select implementation based on `KEY_PROVIDER=file|aws_secrets|vault` env var.
  5. In production (mainnet), require `KEY_PROVIDER=aws_secrets` or `vault`.
- **Complexity:** L
- **Depends on:** [P0-14]

---

### [P2-02] Replace Float64 Money with Lamports (uint64) Internally

- **Files:** All models, billing worker, wallet API, escrow engine
- **Issue:** `float64` accumulates rounding errors. SOL amounts should be stored as `uint64` lamports (1 SOL = 1,000,000,000 lamports) for exact arithmetic.
- **Fix:**
  1. Create type aliases: `type Lamports = uint64` and conversion helpers:
     ```go
     const LamportsPerSOL = 1_000_000_000
     func SOLToLamports(sol float64) Lamports { return Lamports(sol * LamportsPerSOL) }
     func LamportsToSOL(l Lamports) float64   { return float64(l) / LamportsPerSOL }
     ```
  2. Migrate all wallet balance fields to `uint64` lamports in the DB:
     ```sql
     ALTER TABLE wallets ADD COLUMN balance_lamports BIGINT NOT NULL DEFAULT 0
         CHECK (balance_lamports >= 0);
     -- Migrate: UPDATE wallets SET balance_lamports = ROUND(balance_sol * 1000000000);
     -- After validation: DROP COLUMN balance_sol;
     ```
  3. Run as a three-phase deployment: Add column → Dual-write → Remove old column.
- **Complexity:** XL (systemic change touching 30+ files)
- **Depends on:** All P0/P1 fixes that touch balance fields

---

### [P2-03] Fix: RPC Failover Index Reset

- **File:** `services/control-api/internal/solana/client.go:210-220`
- **Issue:** After a complete failover cycle, `currentIdx` points at the last-tried (failed) endpoint. The next call starts from the wrong endpoint.
- **Fix:**
  ```go
  func (c *OracleClient) withFailover(ctx context.Context, f func(*rpc.Client) error) error {
      startIdx := c.currentIdx
      for i := 0; i < len(c.rpcClients); i++ {
          idx := (startIdx + i) % len(c.rpcClients)
          err := f(c.rpcClients[idx])
          if err == nil {
              c.currentIdx = idx  // Remember last successful
              return nil
          }
      }
      // All failed — reset to first healthy or primary
      c.currentIdx = 0
      return lastErr
  }
  ```
- **Complexity:** S
- **Depends on:** Nothing

---

### [P2-04] Fix: Hardcoded Anchor Instruction Discriminators

- **Files:** `services/control-api/internal/solana/settlement.go:146,170,196,232`
- **Issue:** Eight Anchor discriminators are hardcoded as magic bytes. Any program recompile invalidates them silently.
- **Fix:**
  1. Load discriminators at startup from the Anchor IDL JSON file:
     ```go
     type AnchorIDL struct {
         Instructions []struct {
             Name          string `json:"name"`
             Discriminator []byte `json:"discriminator"`
         } `json:"instructions"`
     }
     func loadDiscriminators(idlPath string) (map[string][]byte, error)
     ```
  2. Set `ANCHOR_IDL_PATH=/config/proxyhub.json` in docker-compose.
  3. If IDL file not found, compute discriminators from instruction names:
     ```go
     func discriminator(name string) []byte {
         h := sha256.Sum256([]byte("global:" + name))
         return h[:8]
     }
     ```
  4. Log computed discriminators on startup for operator verification.
- **Complexity:** M
- **Depends on:** Anchor IDL file must be exported from the Solana program

---

### [P2-05] Fix: Account Parsing — Replace Byte Offsets with IDL

- **File:** `services/control-api/internal/solana/client.go:248-263`
- **Issue:** Hardcoded byte offsets for Anchor account deserialization. Any IDL change silently corrupts parsed data.
- **Fix:**
  1. Generate Go structs from the Anchor IDL using `anchor-client-gen` or manual Borsh deserialization.
  2. Add discriminator validation before parsing:
     ```go
     const EscrowDiscriminator = "b8e2f40c..."  // From IDL
     if !bytes.HasPrefix(data, discriminatorBytes) {
         return nil, fmt.Errorf("account is not an Escrow account: wrong discriminator")
     }
     ```
  3. Use Borsh deserialization library (`github.com/near/borsh-go`) instead of manual byte slicing.
- **Complexity:** L
- **Depends on:** [P2-04] for IDL loading

---

### [P2-06] Decompose Billing Worker (God Function)

- **File:** `services/control-api/internal/billing/worker.go`
- **Issue:** 450-line single file handles Redis scanning, session lookup, wallet locking, provider crediting, and payout triggering. Any bug affects all settlement.
- **Fix:** Split into focused components:
  - `billing/session_reader.go`: `ReadPendingUsage() []SessionUsage` — scans Redis
  - `billing/usage_calculator.go`: `Calculate(usage SessionUsage) (costSOL float64, error)` — pricing
  - `billing/wallet_settler.go`: `Settle(buyerID, providerID uuid.UUID, amount float64) error` — DB transaction
  - `billing/payout_trigger.go`: `CheckAndTrigger(providerID uuid.UUID, balance float64)` — threshold check
  - `billing/worker.go` becomes an orchestrator calling the above in sequence.
- **Complexity:** L
- **Depends on:** P0/P1 fixes that modify worker.go

---

### [P2-07] Add Rate Limiting to Explorer Public Endpoints

- **File:** `services/control-api/internal/api/explorer.go`
- **Issue:** Public unauthenticated endpoints have no rate limiting. `/nodes/geo` can be scraped at will.
- **Fix:**
  1. Add IP-based rate limiting middleware using Redis:
     ```go
     func ExplorerRateLimit(requestsPerMinute int) gin.HandlerFunc {
         return func(c *gin.Context) {
             key := "rl:explorer:" + clientIP(c)
             count, _ := redis.Incr(ctx, key).Result()
             if count == 1 { redis.Expire(ctx, key, time.Minute) }
             if count > int64(requestsPerMinute) {
                 c.AbortWithStatusJSON(429, gin.H{"error": "rate limit exceeded"})
                 return
             }
             c.Next()
         }
     }
     ```
  2. Apply: 120 req/min for general endpoints, 20 req/min for `/nodes/geo`.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P2-08] Fix: Reconciliation Discrepancy Formula

- **File:** `services/control-api/internal/treasury/reconciliation.go:148`
- **Issue:** `discrepancy = treasury - liabilities` ignores in-flight transactions, escrow holds, and platform fee reserves.
- **Fix:**
  ```go
  // Correct formula:
  totalLocked, _ := db.DB.Model(&EscrowTransaction{}).
      Where("status = 'held'").Select("COALESCE(SUM(amount), 0)").Scan(&totalLocked)

  totalPendingWithdrawals, _ := db.DB.Model(&PendingTransaction{}).
      Where("status = 'pending' AND type = 'withdrawal'").Select("COALESCE(SUM(amount), 0)").Scan(&totalPendingWithdrawals)

  expectedTreasury := internalLiabilities + totalLocked + platformFeeReserve + totalPendingWithdrawals
  discrepancy := math.Abs(treasuryBalance - expectedTreasury)
  threshold := 0.01 // 0.01 SOL tolerance for rounding
  if discrepancy > threshold {
      // Alert
  }
  ```
- **Complexity:** M
- **Depends on:** Nothing

---

### [P2-09] Implement Reconciliation History Persistence

- **File:** `services/control-api/internal/treasury/reconciliation.go:317`
- **Issue:** `GetLastReconciliationReport()` returns an error — not implemented.
- **Fix:**
  1. Create `ReconciliationRun` model:
     ```go
     type ReconciliationRun struct {
         ID              uuid.UUID
         RunAt           time.Time
         TreasuryBalance float64
         Liabilities     float64
         Discrepancy     float64
         Status          string  // "ok" / "discrepancy" / "failed"
         Issues          JSON    // Array of ReconciliationIssue
     }
     ```
  2. Save every run result to the DB.
  3. Implement `GetLastReconciliationReport()` to query the most recent record.
  4. Add migration for the new table.
- **Complexity:** M
- **Depends on:** [P2-08]

---

### [P2-10] Fix: Treasury Auto-Topup Rate Limiting

- **File:** `services/control-api/internal/treasury/treasury_manager.go:186-192`
- **Issue:** No limit on how many topups can be triggered. A misconfigured threshold can drain the reserve every 5 minutes.
- **Fix:**
  1. Add a Redis key `treasury:topup:last_triggered` with a 30-minute TTL.
  2. Before triggering a topup, check if the key exists:
     ```go
     if exists, _ := redis.Exists(ctx, "treasury:topup:last_triggered").Result(); exists > 0 {
         log.Warn("Treasury topup already triggered within cooldown period — skipping")
         return
     }
     redis.Set(ctx, "treasury:topup:last_triggered", "1", 30*time.Minute)
     ```
  3. For emergency topups, use a separate 5-minute cooldown key.
- **Complexity:** S
- **Depends on:** Nothing

---

### [P2-11] Fix: Dispute Expiration and Auto-Close

- **File:** `services/control-api/internal/api/disputes.go`, `models/dispute.go`
- **Issue:** Open disputes block escrow funds indefinitely. No expiration mechanism.
- **Fix:**
  1. Add `ExpiresAt time.Time` field to `Dispute` model (default: 30 days from creation).
  2. Add a daily cron job `AutoCloseExpiredDisputes()`:
     ```go
     func AutoCloseExpiredDisputes() {
         var expired []models.Dispute
         db.DB.Where("status = 'open' AND expires_at <= ?", time.Now()).Find(&expired)
         for _, d := range expired {
             // Auto-resolve in favor of seller if no response from buyer
             resolveDispute(d, "seller", "auto_closed_no_response")
         }
     }
     ```
  3. Add `RefundSOL` max validation: `if req.RefundSOL > escrow.Amount { return error }`.
- **Complexity:** M
- **Depends on:** Nothing

---

### [P2-12] Fix: Solana Edge Gateway — Per-Operation Timeouts

- **File:** `services/edge-gateway/src/blockchain/client.rs`
- **Issue:** Fixed 30-second timeout for all operations. Health checks should fail fast; transaction submissions may need longer.
- **Fix:**
  ```rust
  pub enum OperationTimeout {
      HealthCheck = 3,
      BalanceQuery = 5,
      TransactionSubmit = 60,
      TransactionConfirm = 120,
  }

  pub async fn rpc_call_with_timeout<T: DeserializeOwned>(
      &self,
      method: &str,
      params: Vec<Value>,
      timeout: OperationTimeout,
  ) -> Result<T>
  ```
- **Complexity:** S
- **Depends on:** Nothing

---

### [P2-13] Add Comprehensive Financial Audit Event Log

- **Files:** New model + migration, all financial API handlers
- **Issue:** There is no append-only, tamper-evident log of all financial events. Subscription charges, staking events, and treasury topups leave no trace beyond log lines.
- **Fix:**
  1. Create `FinancialEvent` model:
     ```go
     type FinancialEvent struct {
         ID          uuid.UUID
         EventType   string      // transfer / subscription / stake / unstake / escrow_release / topup / ...
         ActorID     *uuid.UUID  // Who initiated
         Amount      float64
         Currency    string      // SOL
         FromAddress string
         ToAddress   string
         Reference   string      // Order ID, session ID, etc.
         TxHash      string      // On-chain hash if applicable
         CreatedAt   time.Time   // Immutable — never updated
         Metadata    JSON        // Arbitrary context
     }
     ```
  2. Add `LogFinancialEvent()` helper called from every money movement.
  3. Add DB index on `(actor_id, event_type, created_at)`.
- **Complexity:** L
- **Depends on:** Nothing

---

### [P2-14] Fix: Gateway Signature Validation in Usage Reports

- **File:** `services/control-api/internal/api/usage.go:150`
- **Issue:** Gateway-provided signatures are forwarded without validation. A compromised gateway can report inflated usage.
- **Fix:**
  1. The edge gateway must sign usage reports with its node's private key.
  2. The control API must verify the signature against the gateway's registered public key (from `provider_nodes.wallet_address`):
     ```go
     if !verifyGatewaySignature(report.NodePublicKey, report.Signature, report.UsagePayload) {
         c.JSON(403, gin.H{"error": "invalid gateway signature"})
         return
     }
     ```
  3. Register gateway public keys at node registration time.
- **Complexity:** L
- **Depends on:** Gateway signing implementation (edge-gateway change required)

---

### [P2-15] Fix: Usage Report Cross-Validation Against Redis

- **File:** `services/control-api/internal/api/usage.go`
- **Issue:** Gateway-reported bandwidth bytes are accepted without cross-reference to Redis counters (which the gateway itself increments).
- **Fix:**
  1. After receiving a usage report, cross-check against Redis:
     ```go
     redisBytes, err := redisClient.GetUsage(report.SessionUsername)
     if err == nil && report.BytesTotal > redisBytes * 1.05 { // 5% tolerance
         log.Warn("Gateway reported more usage than Redis counter", ...)
         // Use Redis value as authoritative
         report.BytesTotal = redisBytes
     }
     ```
  2. This does not solve the root issue (compromised gateway controls Redis too) but adds a consistency check.
- **Complexity:** M
- **Depends on:** [P2-14]

---

### [P2-16] Fix: `PendingTransaction.UserID` Type Inconsistency

- **File:** `services/control-api/internal/models/transaction.go`
- **Issue:** `UserID string` while all other tables use `uuid.UUID`. Makes joins difficult and prevents FK constraints.
- **Fix:**
  ```sql
  -- Migration: 000044_pending_tx_userid_uuid.up.sql
  ALTER TABLE pending_transactions
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

  ALTER TABLE pending_transactions
      ADD CONSTRAINT fk_pending_tx_user FOREIGN KEY (user_id) REFERENCES users(id);
  ```
  Update Go model: `UserID uuid.UUID`.
- **Complexity:** S
- **Depends on:** Verify all existing `user_id` values are valid UUIDs first

---

### [P2-17] Fix: Spending Limit "Zero = Unlimited" Semantics

- **File:** `services/control-api/internal/models/spending_limit.go:52-54`
- **Issue:**
  ```go
  if w.DailyLimit == 0 && w.WeeklyLimit == 0 && w.MonthlyLimit == 0 {
      return nil  // "unlimited" — but 0 usually means "zero allowed"
  }
  ```
  Semantically backwards — 0 should mean "no spending allowed", not "unlimited".
- **Fix:**
  1. Add a `LimitsEnabled bool` field to `Wallet`:
     ```go
     LimitsEnabled bool `gorm:"default:false"`
     ```
  2. Change the check to: if `!wallet.LimitsEnabled { return nil }`.
  3. When a user explicitly sets a limit, set `LimitsEnabled = true`.
  4. Migrate existing: `UPDATE wallets SET limits_enabled = (daily_limit > 0 OR weekly_limit > 0 OR monthly_limit > 0)`.
- **Complexity:** M
- **Depends on:** Migration

---

## P3 — Backlog (Month 2+)
### Architecture improvements, long-term correctness

---

### [P3-01] Migrate to Event Sourcing for Financial State

- **Issue:** The current mutate-in-place model (`wallet.balance_sol`) makes state reconstruction impossible. A corrupted balance cannot be replayed.
- **Fix:** Implement event sourcing: wallet balance is always derived from `WalletLedgerEntry` records, never stored directly. The current `balance_sol` column becomes a materialized view / cache with periodic reconciliation.
- **Complexity:** XL

---

### [P3-02] Unify Solana Blockchain Clients (Go + Rust)

- **Issue:** Independent Solana RPC clients in `control-api` (Go) and `edge-gateway` (Rust) diverge over time.
- **Fix:** Define a `blockchain-service` gRPC API. Both services call it for all on-chain operations. The service is the single canonical Solana client.
- **Complexity:** XL

---

### [P3-03] Implement Usage-Proportional Escrow Release

- **File:** `services/control-api/internal/api/escrow.go:278`
- **Issue:** Seller always receives 90% of full escrow regardless of how much bandwidth was actually delivered.
- **Fix:** Calculate seller payment from actual bandwidth used:
  ```go
  usagePercent := float64(session.BandwidthUsed) / float64(session.BandwidthLimit)
  sellerAmount := escrow.Amount * usagePercent * (1 - platformFeePercent)
  ```
- **Complexity:** M

---

### [P3-04] Implement Prorated Subscription Billing

- **File:** `services/control-api/internal/api/subscriptions.go:184`
- **Issue:** Plan changes switch immediately with no proration.
- **Fix:** Calculate remaining days on current plan, credit proportionally, charge new plan's proportional amount for remaining days.
- **Complexity:** M

---

### [P3-05] Add SPL Token Support to Indexer

- **File:** `services/control-api/internal/indexer/blockchain_indexer.go`
- **Issue:** Only native SOL transfers are processed. SPL token transfers (future USDC support) are ignored.
- **Fix:** Parse `tx.Meta.PreTokenBalances` / `PostTokenBalances` for SPL accounts.
- **Complexity:** L

---

### [P3-06] Implement Re-org Detection in Blockchain Indexer

- **File:** `services/control-api/internal/indexer/blockchain_indexer.go`
- **Issue:** Chain reorganizations are not handled. Orphaned transactions may remain in the explorer.
- **Fix:** Track block parent hashes; detect when a stored block's parent no longer matches the canonical chain; mark orphaned blocks/transactions.
- **Complexity:** L

---

### [P3-07] Add Solana Program IDL Auto-Loading

- **Issue:** Hardcoded discriminators must be updated manually on every program recompile.
- **Fix:** Fetch the program's IDL from the Anchor IDL registry on startup, cache in Redis, validate discriminators match.
- **Complexity:** M
- **Depends on:** [P2-04]

---

### [P3-08] Implement DeFi Yield Generation for Treasury

- **File:** `services/control-api/internal/treasury/liquidity_manager.go` (stub)
- **Issue:** `YieldGenerationHook()` is empty. Treasury idle SOL earns nothing.
- **Fix:** Integrate with Solana lending protocols (Marinade, Solend) to earn yield on idle treasury SOL above the target balance.
- **Complexity:** XL

---

### [P3-09] Add Tax Reporting to Provider Earnings Dashboard

- **File:** `apps/web/src/app/dashboard/earnings/page.tsx`
- **Issue:** No CSV export, no tax categorization, no year-end summaries.
- **Fix:** Add CSV export button, per-month aggregation view, and printable tax summary.
- **Complexity:** M

---

### [P3-10] Implement Real-Time Wallet Balance Updates

- **File:** `apps/web/src/app/dashboard/wallet/page.tsx`
- **Issue:** Wallet balance only updates on page reload.
- **Fix:** Add WebSocket subscription to `user.wallet.{userID}` channel; push balance updates when ledger entries are created.
- **Complexity:** M

---

### [P3-11] Add Subscription Free-Tier Configuration to Database

- **File:** `services/control-api/internal/api/subscriptions.go:221-238`
- **Issue:** Free-tier limits are hardcoded integers in Go source.
- **Fix:** Create `SubscriptionTierLimit` table with configurable limits per plan per feature.
- **Complexity:** M

---

### [P3-12] Fix: Explorer Contracts Page — Add Data Ingestion

- **File:** `services/control-api/internal/api/explorer.go` (contracts endpoint)
- **Issue:** No code path populates `ExplorerContract` records. The contracts page is always empty.
- **Fix:** During blockchain indexing, identify Anchor program invocations and record the program address, invocation count, and method name.
- **Complexity:** M

---

### [P3-13] Add Circuit Breaker for Billing Settlement

- **Issue:** If the Solana RPC is slow or unavailable, the settlement worker retries indefinitely, causing thread saturation.
- **Fix:** Implement a circuit breaker on `settleSession()` — after 3 consecutive failures in a 60-second window, pause settlement for 5 minutes and alert operators.
- **Complexity:** M

---

### [P3-14] Split 157-Model AutoMigrate Into Sequential Migration Files

- **File:** `services/control-api/internal/db/db.go`
- **Issue:** A single `AutoMigrate()` call with 157 models is slow, high-risk, and impossible to roll back selectively.
- **Fix:** Replace the bulk `AutoMigrate` with the versioned SQL migration files already in `migrations/`. Set `MIGRATE_ONLY` mode to run migrations before startup. Remove `AutoMigrate` entirely.
- **Complexity:** L

---

## Migration Sequence

The following database migrations are needed for the P0/P1 fixes above:

```
000041_explorer_indexes.up.sql           — P1-01 (explorer table indexes)
000042_wallet_balance_non_negative.up.sql — P1-07 (CHECK balance >= 0)
000043_provider_earning_session_unique.up.sql — P1-14 (unique earnings per session)
000044_pending_tx_userid_uuid.up.sql     — P2-16 (UserID type fix)
000045_idempotency_key_unique.up.sql     — P0-15 (idempotency key constraint)
000046_node_staked_amount.up.sql         — P0-04 (staked SOL tracking)
000047_dispute_expiry.up.sql             — P2-11 (dispute ExpiresAt)
000048_financial_events.up.sql           — P2-13 (audit event log)
000049_reconciliation_runs.up.sql        — P2-09 (reconciliation history)
000050_wallet_limits_enabled.up.sql      — P2-17 (LimitsEnabled flag)
```

---

## Implementation Checklist Summary

### P0 — Must Complete Before Launch (20 items)
- [ ] P0-01 Fix provider wallet credit failure
- [ ] P0-02 Batch payout SELECT FOR UPDATE SKIP LOCKED
- [ ] P0-03 Double-spend guard on on-chain success + DB failure
- [ ] P0-04 Return staked SOL on unstake
- [ ] P0-05 Division by zero in subscription billing
- [ ] P0-06 Typo `ConvertSOLTUSD`
- [ ] P0-07 Velocity guard mandatory initialization
- [ ] P0-08 Deterministic usage report nonce
- [ ] P0-09 On-chain escrow settlement on DB release
- [ ] P0-10 Extract transaction amounts (not always 0.0)
- [ ] P0-11 Extract toAddress (not always empty)
- [ ] P0-12 Remove `isRelevant = true` override
- [ ] P0-13 GeoIP resolution in node sync
- [ ] P0-14 Encrypt reserve keypair at rest
- [ ] P0-15 Unique constraint on idempotency_key
- [ ] P0-16 Atomic Redis velocity check (Lua script)
- [ ] P0-17 Redis failure blocks transfers (not allows)
- [ ] P0-18 Freeze state in Redis (not in-memory)
- [ ] P0-19 Admin payout routes require auth
- [ ] P0-20 Remove hardcoded $150 price fallback

### P1 — Sprint 1 (22 items)
- [ ] P1-01 Explorer transaction DB indexes
- [ ] P1-02 WebSocket polling mutex
- [ ] P1-03 Slow client goroutine leak fix
- [ ] P1-04 Replace WS polling with NATS events
- [ ] P1-05 Max retry limit on payout requeue
- [ ] P1-06 P2P wallet locking refactor
- [ ] P1-07 Negative balance DB constraint
- [ ] P1-08 Escrow auto-release row lock
- [ ] P1-09 Milestone double-release unique index
- [ ] P1-10 Subscription charge creates ledger entry
- [ ] P1-11 Subscription plan query uses correct DB
- [ ] P1-12 Milestone amount sum validation
- [ ] P1-13 Treasury alert delivery (Slack/email)
- [ ] P1-14 Provider earnings session unique constraint
- [ ] P1-15 WebSocket reconnect exponential backoff
- [ ] P1-16 AbortController on all explorer fetches
- [ ] P1-17 Redis cache layer on explorer endpoints
- [ ] P1-18 Spending limit timezone fix
- [ ] P1-19 Billing worker Redis key parsing fix
- [ ] P1-20 Escrow refund uses remaining amount
- [ ] P1-21 Tier score formula — enterprise reachable
- [ ] P1-22 Escrow listener event retry mechanism

### P2 — Sprint 2 (17 items)
- [ ] P2-01 Keys to secrets manager
- [ ] P2-02 Float64 → uint64 lamports migration
- [ ] P2-03 RPC failover index reset
- [ ] P2-04 Anchor discriminators from IDL
- [ ] P2-05 Account parsing via Borsh/IDL
- [ ] P2-06 Decompose billing worker
- [ ] P2-07 Explorer rate limiting
- [ ] P2-08 Reconciliation formula fix
- [ ] P2-09 Reconciliation history persistence
- [ ] P2-10 Treasury topup rate limiting
- [ ] P2-11 Dispute expiration + auto-close
- [ ] P2-12 Edge gateway per-operation timeouts
- [ ] P2-13 Financial audit event log
- [ ] P2-14 Gateway signature validation
- [ ] P2-15 Usage cross-validation vs Redis
- [ ] P2-16 PendingTransaction.UserID type fix
- [ ] P2-17 Spending limit semantics fix

### P3 — Backlog (14 items)
- [ ] P3-01 Event sourcing for financial state
- [ ] P3-02 Unified blockchain service (Go+Rust)
- [ ] P3-03 Usage-proportional escrow release
- [ ] P3-04 Prorated subscription billing
- [ ] P3-05 SPL token indexer support
- [ ] P3-06 Re-org detection
- [ ] P3-07 Anchor IDL auto-loading
- [ ] P3-08 DeFi yield generation
- [ ] P3-09 Tax reporting dashboard
- [ ] P3-10 Real-time wallet balance WebSocket
- [ ] P3-11 DB-driven subscription tier limits
- [ ] P3-12 Explorer contracts data ingestion
- [ ] P3-13 Settlement circuit breaker
- [ ] P3-14 Replace AutoMigrate with versioned migrations

---

## Risk-Ordered Top 10

If time is extremely limited, these 10 items eliminate the highest-impact risks:

| Rank | Ticket | Risk Eliminated |
|------|--------|-----------------|
| 1 | P0-01 | Provider SOL loss on every settlement |
| 2 | P0-02 + P0-03 | Double payment to providers |
| 3 | P0-04 | Staked SOL permanently destroyed |
| 4 | P0-07 + P0-16 + P0-17 | Treasury unlimited drain |
| 5 | P0-09 | On-chain/DB escrow state divergence |
| 6 | P0-14 + P0-18 | Reserve wallet key exposure |
| 7 | P0-05 + P0-06 | Service-wide panic in billing and pricing |
| 8 | P0-19 | Any user forces treasury payouts |
| 9 | P0-10 + P0-12 | Explorer shows zero amounts, indexes everything |
| 10 | P0-13 | Node map permanently broken |

---

*Master Implementation Plan — ProxyHub Engineering*
*Generated: 2026-03-17 | Source: Explorer/Blockchain Analysis + Financial Engine Analysis*
*73 tracked items across P0–P3*
