# ProxyHubb — Implementation Plan

**Created:** 2026-03-13
**Based on:** PROXYHUBB_FULL_SYSTEM_ANALYSIS_REPORT.md
**Scope:** Security fixes, broken system repairs, unwired feature connections, new schema integration, performance & scale

---

## Master Task Tracking Table

| ID | Phase | Task | Primary File(s) | Effort | Status |
|----|-------|------|-----------------|--------|--------|
| **S-01** | 0 | Fix auth bypass on Redis failure | `edge-gateway/src/main.rs:208` | 2h | ☐ TODO |
| **S-02** | 0 | Remove JWT dead code | `edge-gateway/src/tunnel.rs:111` | 1h | ☐ TODO |
| **S-03** | 0 | Move admin credentials to secrets | `docker-compose.yml`, `.env.secrets` | 2h | ☐ TODO |
| **S-04** | 0 | Validate Solana address on withdrawal | `control-api/internal/api/wallet.go` | 2h | ☐ TODO |
| **S-05** | 0 | Fix billing race — SELECT FOR UPDATE | `control-api/internal/billing/worker.go` | 2h | ☐ TODO |
| **S-06** | 0 | Fix wallet creation race — UPSERT | `control-api/internal/api/wallet.go` | 2h | ☐ TODO |
| **S-07** | 0 | Add DNS rebinding protection | `edge-gateway/src/policy.rs` | 3h | ☐ TODO |
| **S-08** | 0 | Cap session auth cache with bounded LRU | `edge-gateway/src/auth.rs` | 3h | ☐ TODO |
| **S-09** | 0 | Audit & consolidate duplicate RLS migrations | `migrations/20260121_*.sql` | 3h | ☐ TODO |
| **S-10** | 0 | Fix Prometheus high-cardinality labels | `edge-gateway/src/metrics.rs` | 2h | ☐ TODO |
| **B-01** | 1 | Add payout retry queue | `billing/worker.go`, new migration | 1d | ☐ TODO |
| **B-02** | 1 | Add Redis WAL for metering data | `edge-gateway/src/metering.rs` | 1d | ☐ TODO |
| **B-03** | 1 | Wire heartbeat monitor into tunnel | `edge-gateway/src/tunnel.rs`, `heartbeat.rs` | 4h | ☐ TODO |
| **B-04** | 1 | Fix circuit breaker success_threshold | `edge-gateway/src/circuitbreaker.rs` | 2h | ☐ TODO |
| **B-05** | 1 | Make QoS bandwidth tier-aware | `edge-gateway/src/qos.rs`, `auth.rs` | 4h | ☐ TODO |
| **B-06** | 1 | Expand port policy whitelist | `edge-gateway/src/policy.rs` | 2h | ☐ TODO |
| **B-07** | 1 | Fix GeoIP — replace hardcoded fallback | `edge-gateway/src/tunnel.rs:191` | 3h | ☐ TODO |
| **B-08** | 1 | Enable audit log partitioning cron | `migrations/20260121_soft_deletes.sql` | 2h | ☐ TODO |
| **B-09** | 1 | Add graceful shutdown with tunnel draining | `edge-gateway/src/main.rs:685` | 4h | ☐ TODO |
| **B-10** | 1 | Add metering retry on flush failure | `edge-gateway/src/metering.rs` | 2h | ☐ TODO |
| **W-01** | 2 | Wire IP rotation into provider selection | `edge-gateway/src/rotation.rs`, `main.rs` | 4h | ☐ TODO |
| **W-02** | 2 | Swap Mutex registry → LockFree (DashMap) | `edge-gateway/src/registry/lockfree.rs`, `state.rs` | 4h | ☐ TODO |
| **W-03** | 2 | Wire connection pool into stream routing | `edge-gateway/src/pool/mod.rs`, `main.rs` | 1d | ☐ TODO |
| **W-04** | 2 | Wire heartbeat leader-election tasks | `edge-gateway/src/leader.rs`, `main.rs` | 3h | ☐ TODO |
| **W-05** | 2 | Wire HTTP/2 CONNECT into request handler | `edge-gateway/src/proxy/http2.rs`, `main.rs` | 4h | ☐ TODO |
| **W-06** | 2 | Wire WebSocket tunnel upgrade | `edge-gateway/src/proxy/websocket.rs`, `main.rs` | 4h | ☐ TODO |
| **W-07** | 2 | Wire zero-copy splice on Linux | `edge-gateway/src/proxy/zerocopy.rs`, `main.rs` | 3h | ☐ TODO |
| **N-01** | 3 | Read service_configurations in gateway routing | `edge-gateway/src/main.rs`, `control-api/api/channel.go` | 1d | ☐ TODO |
| **N-02** | 3 | Enforce session_configurations at gateway | `edge-gateway/src/main.rs`, `auth.rs` | 1d | ☐ TODO |
| **N-03** | 3 | Connect routing_profiles to matching engine | `control-api/internal/api/session.go` | 4h | ☐ TODO |
| **N-04** | 3 | Verify blockchain_state_cache is populated | `control-api/internal/solana/settlement.go` | 3h | ☐ TODO |
| **N-05** | 3 | Verify encrypted_credentials written on session create | `control-api/internal/api/session.go` | 2h | ☐ TODO |
| **N-06** | 3 | Enforce soft-delete filters on all API queries | `control-api/internal/api/*.go` | 1d | ☐ TODO |
| **N-07** | 3 | Payout respects linked_wallets is_primary flag | `control-api/internal/billing/worker.go` | 3h | ☐ TODO |
| **N-08** | 3 | Implement premium services billing (captcha, JS render, etc.) | `control-api/internal/billing/`, `edge-gateway` | 3d | ☐ TODO |
| **P-01** | 4 | Wire ML router into traffic path with A/B test | `edge-gateway/src/routing/ml_router.rs`, `ab_test.rs` | 2d | ☐ TODO |
| **P-02** | 4 | Wire predictive connection warmup | `edge-gateway/src/routing/prewarm.rs` | 1d | ☐ TODO |
| **P-03** | 4 | Wire adaptive DDoS protection | `edge-gateway/src/security/ddos.rs`, `main.rs` | 1d | ☐ TODO |
| **P-04** | 4 | Wire TLS fingerprinting + bot detection | `edge-gateway/src/security/fingerprint.rs` | 1d | ☐ TODO |
| **P-05** | 4 | Wire multi-region routing with failover | `edge-gateway/src/multiregion/routing.rs` | 2d | ☐ TODO |
| **P-06** | 4 | Replace O(n) provider selection with priority queue | `edge-gateway/src/state.rs` | 4h | ☐ TODO |
| **P-07** | 4 | Add Redis connection pooling (bb8-redis) | `edge-gateway/src/auth.rs`, `registry/` | 4h | ☐ TODO |

**Total tasks: 47** | Phase 0: 10 | Phase 1: 10 | Phase 2: 7 | Phase 3: 8 | Phase 4: 7 | Remaining: 5

---

## Phase 0 — Emergency Security Fixes
**Timeline: 2–3 days**
**Goal: Seal all critical security vulnerabilities before any production traffic**

---

### S-01 — Fix Auth Bypass on Redis Failure
**File:** [services/edge-gateway/src/main.rs](services/edge-gateway/src/main.rs) — line 208
**Priority:** CRITICAL — authentication fully bypassed during Redis outages

**Current behavior:**
```rust
let (user_id, session_data) = match auth_result {
    Ok(data) => data,
    Err(_) => ("anonymous".to_string(), None),  // ← anyone gets through
};
```

**Fix:** Fail-closed — return `407 Proxy Authentication Required` on any Redis error:
```rust
let (user_id, session_data) = match auth_result {
    Ok(data) => data,
    Err(e) => {
        metrics::auth_failure("redis_error");
        return Ok(Response::builder()
            .status(407)
            .header("Proxy-Authenticate", "Basic realm=\"ProxyHubb\"")
            .body(Body::from("Authentication service unavailable"))
            .unwrap());
    }
};
```

**Also handle:** If `user_id == "anonymous"` somehow reaches routing, add a guard to reject immediately.

**Dependencies:** None
**Effort:** 2 hours

---

### S-02 — Remove JWT Dead Code in Tunnel
**File:** [services/edge-gateway/src/tunnel.rs](services/edge-gateway/src/tunnel.rs) — line 111
**Priority:** HIGH — confusing dead code that disables JWT validation if accidental edit occurs

**Current code:**
```rust
validation.insecure_disable_signature_validation(); // line 111 ← DELETE THIS
validation.set_audience(&["proxyhubb-gateway"]);    // line 113
```

**Fix:** Delete line 111 entirely. Add a comment explaining the validation config:
```rust
// Require valid Ed25519 signature from Control API oracle keypair
validation.set_audience(&["proxyhubb-gateway"]);
validation.set_issuer(&["proxyhubb-control"]);
```

**Dependencies:** None
**Effort:** 1 hour

---

### S-03 — Move Admin Credentials Out of docker-compose
**File:** [docker-compose.yml](docker-compose.yml) lines 48–54
**Priority:** HIGH — plaintext credentials with predictable pattern `PHub@Role2026!`

**Fix — create `.env.secrets` (gitignored):**
```env
ADMIN_ACCOUNT_1_USERNAME=<generate-random>
ADMIN_ACCOUNT_1_PASSWORD=<generate-strong-password>
ADMIN_ACCOUNT_1_ROLE=superadmin
ADMIN_ACCOUNT_2_USERNAME=<generate-random>
ADMIN_ACCOUNT_2_PASSWORD=<generate-strong-password>
ADMIN_ACCOUNT_2_ROLE=sysops
ADMIN_ACCOUNT_3_USERNAME=<generate-random>
ADMIN_ACCOUNT_3_PASSWORD=<generate-strong-password>
ADMIN_ACCOUNT_3_ROLE=support
```

**Update docker-compose.yml:**
```yaml
env_file:
  - .env
  - .env.secrets  # ← add this line
```

**Add to .gitignore:**
```
.env.secrets
```

**Long term:** Move to Docker Secrets (`/run/secrets/`) following the oracle-keypair pattern already in place.

**Dependencies:** None
**Effort:** 2 hours

---

### S-04 — Validate Solana Address on Withdrawal
**File:** [services/control-api/internal/api/wallet.go](services/control-api/internal/api/wallet.go)
**Priority:** MEDIUM-HIGH — invalid addresses cause failed transactions with no feedback

**Fix:** Add validation before queueing the withdrawal:
```go
func isValidSolanaAddress(addr string) bool {
    // Solana addresses are base58-encoded 32-byte public keys
    // Length: 32-44 characters, base58 charset
    if len(addr) < 32 || len(addr) > 44 {
        return false
    }
    const base58Chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    for _, c := range addr {
        if !strings.ContainsRune(base58Chars, c) {
            return false
        }
    }
    return true
}

// In withdraw handler:
if !isValidSolanaAddress(req.WalletAddress) {
    c.JSON(400, gin.H{"error": "invalid Solana wallet address"})
    return
}
```

**Dependencies:** None
**Effort:** 2 hours

---

### S-05 — Fix Billing Race Condition
**File:** [services/control-api/internal/billing/worker.go](services/control-api/internal/billing/worker.go) — line 96
**Priority:** HIGH — double-spend possible without row lock

**Current (broken):**
```go
wallet := getWallet(userID)          // read
if wallet.Balance < cost { ... }     // check
debitWallet(wallet, cost)            // write ← gap between check and write
```

**Fix — wrap in DB transaction with row lock:**
```go
tx := db.Begin()
defer func() { if r := recover(); r != nil { tx.Rollback() } }()

// Lock the row for the duration of the transaction
var wallet models.Wallet
if err := tx.Set("gorm:query_option", "FOR UPDATE").
    Where("user_id = ?", userID).
    First(&wallet).Error; err != nil {
    tx.Rollback()
    return err
}

if wallet.Balance < cost {
    tx.Rollback()
    return ErrInsufficientBalance
}

wallet.Balance -= cost
if err := tx.Save(&wallet).Error; err != nil {
    tx.Rollback()
    return err
}
// ... create ledger entry inside tx
tx.Commit()
```

**Dependencies:** None
**Effort:** 2 hours

---

### S-06 — Fix Wallet Creation Race Condition
**File:** [services/control-api/internal/api/wallet.go](services/control-api/internal/api/wallet.go) — line 92
**Priority:** MEDIUM — duplicate wallet rows possible under concurrent requests

**Current (broken):**
```go
if wallet == nil {
    createWallet(userID)  // two goroutines can both pass this check
}
```

**Fix — use UPSERT:**
```go
result := db.Exec(`
    INSERT INTO wallets (id, user_id, balance, currency, created_at, updated_at)
    VALUES (gen_random_uuid(), ?, 0, 'USDC', NOW(), NOW())
    ON CONFLICT (user_id) DO NOTHING
`, userID)

if result.Error != nil {
    c.JSON(500, gin.H{"error": "failed to initialize wallet"})
    return
}

// Fetch the wallet (now guaranteed to exist)
db.Where("user_id = ?", userID).First(&wallet)
```

**Dependencies:** None
**Effort:** 2 hours

---

### S-07 — Add DNS Rebinding Protection
**File:** [services/edge-gateway/src/policy.rs](services/edge-gateway/src/policy.rs)
**Priority:** MEDIUM — attacker can resolve to public IP then rebind to internal IP

**Fix:** Resolve the hostname ONCE at policy check time, store the resolved IP, and re-verify the IP at tunnel establishment:
```rust
// In policy check:
pub async fn check_destination(host: &str, port: u16) -> PolicyResult {
    let resolved_ip = resolve_once(host).await?;

    // Validate resolved IP is not private
    if is_private_ip(&resolved_ip) {
        return PolicyResult::Denied("SSRF: resolved to private IP");
    }

    // Pass resolved IP to tunnel — do not re-resolve
    PolicyResult::Allowed { resolved_ip, port }
}

// Tunnel uses the pre-resolved IP directly — no second DNS lookup
```

**Dependencies:** None
**Effort:** 3 hours

---

### S-08 — Cap Session Auth Cache with Bounded LRU
**File:** [services/edge-gateway/src/auth.rs](services/edge-gateway/src/auth.rs)
**Priority:** MEDIUM — unbounded HashMap grows indefinitely → OOM

**Fix:** Replace `HashMap` with `lru::LruCache`:

Add to `Cargo.toml`:
```toml
lru = "0.12"
```

In `auth.rs`:
```rust
use lru::LruCache;
use std::num::NonZeroUsize;

// Replace:
// cache: HashMap<String, SessionData>
// With:
cache: LruCache<String, (SessionData, Instant)>,

// Initialize with cap:
let cache = LruCache::new(NonZeroUsize::new(100_000).unwrap());

// On lookup — also check TTL:
if let Some((data, cached_at)) = cache.get(key) {
    if cached_at.elapsed() < Duration::from_secs(300) {
        return Ok(data.clone());
    }
    cache.pop(key); // expired
}
```

**Dependencies:** None
**Effort:** 3 hours

---

### S-09 — Consolidate Duplicate RLS Migrations
**File:** [services/control-api/migrations/20260121_row_level_security.sql](services/control-api/migrations/20260121_row_level_security.sql), [20260121_complete_rls.sql](services/control-api/migrations/20260121_complete_rls.sql), [20260121_safe_rls.sql](services/control-api/migrations/20260121_safe_rls.sql)
**Priority:** MEDIUM — unclear which policies are active; potential gaps

**Steps:**
1. Run this query against the production/staging DB to see actual active policies:
   ```sql
   SELECT tablename, policyname, cmd, qual
   FROM pg_policies
   ORDER BY tablename, policyname;
   ```
2. Compare with policies in the three migration files
3. Identify missing policies and duplicate policies
4. Create a single new migration `000011_consolidate_rls.sql` that:
   - Uses `DROP POLICY IF EXISTS` before `CREATE POLICY` for all policies
   - Is fully idempotent
   - Covers all 60+ tables
5. Retire the three overlapping migration files (keep as reference with `.bak` extension)

**Dependencies:** None
**Effort:** 3 hours

---

### S-10 — Fix Prometheus High-Cardinality Labels
**File:** [services/edge-gateway/src/metrics.rs](services/edge-gateway/src/metrics.rs)
**Priority:** MEDIUM — `user_id` and `node_id` labels create millions of time series → Prometheus OOM

**Fix:** Remove `user_id` from per-request metrics. Aggregate at a higher level:
```rust
// BEFORE (bad — one time series per user):
counter!("edge_gateway_bandwidth_bytes_total", bytes,
    "direction" => direction,
    "user_id" => user_id,    // ← DELETE
    "node_id" => node_id,    // ← DELETE
);

// AFTER (good — fixed cardinality):
counter!("edge_gateway_bandwidth_bytes_total", bytes,
    "direction" => direction,
    "session_type" => session_type,  // rotating/sticky — only 2 values
    "provider_tier" => provider_tier, // basic/standard/premium — only 3 values
);
```

For per-user/per-node analytics, use the PostgreSQL `wallet_ledger_entries` and `usage_records` tables instead of Prometheus.

**Dependencies:** None
**Effort:** 2 hours

---

## Phase 1 — Core System Repairs
**Timeline: 1–2 weeks**
**Goal: Fix all broken core functionality — payout reliability, metering durability, health monitoring**

---

### B-01 — Add Payout Retry Queue
**Files:** [services/control-api/internal/billing/worker.go](services/control-api/internal/billing/worker.go), new migration
**Priority:** HIGH — failed Solana payouts silently lost; providers underpaid

**New migration `000011_payout_retry_queue.up.sql`:**
```sql
CREATE TABLE IF NOT EXISTS payout_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES profiles(id),
    wallet_address VARCHAR(64) NOT NULL,
    amount_sol DECIMAL(20,8) NOT NULL,
    attempt_count INT DEFAULT 0,
    last_attempted_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'pending', -- pending/succeeded/failed_permanent
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON payout_retry_queue(status, next_retry_at) WHERE status = 'pending';
```

**Update billing/worker.go:**
```go
// On payout failure — queue for retry instead of logging and dropping:
if err := solana.SettleProvider(addr, amount); err != nil {
    db.Create(&models.PayoutRetryQueue{
        ProviderID:    providerID,
        WalletAddress: addr,
        AmountSOL:     amount,
        NextRetryAt:   time.Now().Add(5 * time.Minute),
    })
    return // will be retried
}

// Add separate retry worker (runs every 5 minutes):
func StartPayoutRetryWorker(db *gorm.DB, solana *solana.Client) {
    for {
        var pending []models.PayoutRetryQueue
        db.Where("status = 'pending' AND next_retry_at <= ?", time.Now()).
            Order("next_retry_at").Limit(50).Find(&pending)

        for _, p := range pending {
            if err := solana.SettleProvider(p.WalletAddress, p.AmountSOL); err != nil {
                backoff := time.Duration(math.Pow(2, float64(p.AttemptCount))) * time.Minute
                p.NextRetryAt = time.Now().Add(backoff) // exponential backoff
                p.AttemptCount++
                if p.AttemptCount >= 10 {
                    p.Status = "failed_permanent"
                    // alert operations team
                }
                db.Save(&p)
            } else {
                p.Status = "succeeded"
                db.Save(&p)
            }
        }
        time.Sleep(5 * time.Minute)
    }
}
```

**Register in main.go:**
```go
go billing.StartPayoutRetryWorker(db, solanaClient)
```

**Dependencies:** S-05 (billing transaction fix)
**Effort:** 1 day

---

### B-02 — Add Redis WAL for Metering Data
**File:** [services/edge-gateway/src/metering.rs](services/edge-gateway/src/metering.rs)
**Priority:** HIGH — up to 30s of usage lost on crash

**Fix — write to Redis before accumulating in memory:**
```rust
// On every bandwidth update (every 64KB read):
async fn record_usage(&self, session_id: &str, bytes_in: u64, bytes_out: u64) {
    // 1. Write to Redis WAL immediately (durable)
    let key = format!("metering:wal:{}", session_id);
    let _ = redis::cmd("HINCRBY")
        .arg(&key).arg("bytes_in").arg(bytes_in)
        .query_async(&mut self.redis).await;
    let _ = redis::cmd("HINCRBY")
        .arg(&key).arg("bytes_out").arg(bytes_out)
        .query_async(&mut self.redis).await;
    let _ = redis::cmd("EXPIRE").arg(&key).arg(3600)
        .query_async(&mut self.redis).await;

    // 2. Also accumulate in memory for batch flush
    self.accumulator.fetch_add(bytes_in + bytes_out, Ordering::Relaxed);
}

// On flush — read from Redis WAL, clear after successful report:
async fn flush(&self) {
    let keys = self.scan_wal_keys().await;
    for (session_id, data) in keys {
        if self.report_to_control_api(&session_id, data).await.is_ok() {
            redis::cmd("DEL").arg(format!("metering:wal:{}", session_id))
                .query_async(&mut self.redis).await;
        }
        // If report fails, WAL entry stays and will be retried next flush
    }
}
```

**On gateway startup — recover from WAL:**
```rust
async fn recover_from_wal(&self) {
    // Scan all metering:wal:* keys and report any data not yet flushed
    let keys: Vec<String> = redis::cmd("SCAN")...;
    for key in keys {
        self.flush_wal_entry(key).await;
    }
}
```

**Dependencies:** None
**Effort:** 1 day

---

### B-03 — Wire Heartbeat Monitor into Tunnel
**Files:** [services/edge-gateway/src/tunnel.rs](services/edge-gateway/src/tunnel.rs), [heartbeat.rs](services/edge-gateway/src/heartbeat.rs)
**Priority:** HIGH — unhealthy nodes continue receiving traffic

**Fix — connect tunnel lifecycle events to heartbeat monitor:**

In `tunnel.rs`, on connection established:
```rust
// After successful JWT auth and node registration:
state.heartbeat_monitor.node_connected(node_id.clone()).await;
```

In the heartbeat loop in `tunnel.rs`:
```rust
// On each heartbeat received from provider:
state.heartbeat_monitor.record_heartbeat(node_id.clone()).await;
state.heartbeat_store.record(node_id.clone()).await; // Redis persistence
```

On disconnect:
```rust
// In cleanup section:
state.heartbeat_monitor.node_disconnected(node_id.clone()).await;
```

In `heartbeat.rs`, when evicting unhealthy nodes — actually remove from registry:
```rust
// Currently: marks unhealthy but doesn't remove
// Fix: on eviction after 3 missed heartbeats:
state.registry.remove_node(&node_id).await;
metrics::provider_evicted(reason: "heartbeat_timeout");
```

**Dependencies:** None
**Effort:** 4 hours

---

### B-04 — Fix Circuit Breaker Success Threshold
**File:** [services/edge-gateway/src/circuitbreaker.rs](services/edge-gateway/src/circuitbreaker.rs)
**Priority:** MEDIUM — flapping providers re-enter pool too quickly

**Fix — implement the `success_threshold` counter:**
```rust
HalfOpen => {
    self.success_count += 1;
    if self.success_count >= self.success_threshold {
        // Only close after N consecutive successes
        self.state = BreakerState::Closed;
        self.failure_count = 0;
        self.success_count = 0;
    }
}
```

Also add exponential backoff to the Open → HalfOpen timeout:
```rust
let backoff = Duration::from_secs(
    self.base_timeout_secs * 2_u64.pow(self.open_count.min(6))
);
```

**Dependencies:** None
**Effort:** 2 hours

---

### B-05 — Make QoS Bandwidth Tier-Aware
**Files:** [services/edge-gateway/src/qos.rs](services/edge-gateway/src/qos.rs), [auth.rs](services/edge-gateway/src/auth.rs)
**Priority:** MEDIUM — all users get flat 10MB/s regardless of subscription

**Step 1 — Pass trust_tier through session data (auth.rs):**
Session data already carries `trust_tier` — verify it flows into the QoS call.

**Step 2 — Update QoS to use tier (qos.rs):**
```rust
pub fn bandwidth_cap_for_tier(tier: &str) -> u64 {
    match tier {
        "basic"      =>  2 * 1024 * 1024,  //  2 MB/s
        "standard"   => 10 * 1024 * 1024,  // 10 MB/s
        "premium"    => 50 * 1024 * 1024,  // 50 MB/s
        "enterprise" =>        u64::MAX,   // unlimited
        _            =>  2 * 1024 * 1024,  // default: basic
    }
}
```

**Step 3 — Update call site (main.rs):**
```rust
let cap = qos::bandwidth_cap_for_tier(&session.trust_tier);
qos::throttle_if_needed(bytes_read, cap).await;
```

**Dependencies:** S-01 (session data must be reliable)
**Effort:** 4 hours

---

### B-06 — Expand Port Policy Whitelist
**File:** [services/edge-gateway/src/policy.rs](services/edge-gateway/src/policy.rs)
**Priority:** MEDIUM — legitimate ports blocked, causing consumer friction

**Fix:**
```rust
const ALLOWED_PORTS: &[u16] = &[
    80,    // HTTP
    443,   // HTTPS
    8080,  // HTTP alt
    8443,  // HTTPS alt
    3000,  // Node.js / dev
    3001,  // Dev alternate
    8000,  // Python dev
    8888,  // Jupyter / misc
];

// Allow providers to configure additional allowed/blocked ports
// via service_configurations.allowed_ports (Phase 3 - N-01)
```

**Also add domain blocklist skeleton:**
```rust
const BLOCKED_DOMAINS: &[&str] = &[
    // Populated from config/environment
    // e.g. government sites requiring geo-compliance
];
```

**Dependencies:** None
**Effort:** 2 hours

---

### B-07 — Fix GeoIP — Replace Hardcoded Country Fallback
**File:** [services/edge-gateway/src/tunnel.rs](services/edge-gateway/src/tunnel.rs) — line 191
**Priority:** MEDIUM — only 3 countries get correct geo metadata

**Current:**
```rust
// Hardcoded fallback: Ghana, Nigeria, Kenya only
let country = match ip.to_string().as_str() { ... }
```

**Fix:** Ensure MaxMind DB is always loaded and used, with a generic "UNKNOWN" fallback:
```rust
let geo = state.geoip_db
    .lookup::<geoip2::City>(provider_ip)
    .ok()
    .and_then(|c| c.country)
    .and_then(|c| c.iso_code)
    .unwrap_or("UNKNOWN");
```

**In config.rs — make MaxMind DB path a required config:**
```rust
pub geoip_db_path: PathBuf, // Required — fail startup if missing
```

**Provide GeoLite2-City.mmdb in docker-compose volumes:**
```yaml
volumes:
  - ./infra/geoip/GeoLite2-City.mmdb:/etc/geoip/GeoLite2-City.mmdb:ro
```

**Dependencies:** None
**Effort:** 3 hours

---

### B-08 — Enable Audit Log Partitioning Cron
**File:** [services/control-api/migrations/20260121_soft_deletes_partitioning.sql](services/control-api/migrations/20260121_soft_deletes_partitioning.sql)
**Priority:** LOW-MEDIUM — audit logs will become slow at scale without partitioning

**Fix — activate the pg_cron job:**
```sql
-- Run in Supabase SQL Editor / production DB:
SELECT cron.schedule(
    'create_audit_partition',
    '0 0 25 * *',  -- 25th of each month at midnight
    'SELECT create_audit_partition_if_not_exists()'
);

-- Verify cron is scheduled:
SELECT * FROM cron.job;
```

**Also create partitions for upcoming months immediately:**
```sql
SELECT create_audit_partition_if_not_exists(); -- creates next month
-- Manually create for months already started:
CREATE TABLE IF NOT EXISTS audit_logs_2026_03 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

**Dependencies:** S-09 (RLS consolidation done first)
**Effort:** 2 hours

---

### B-09 — Add Graceful Shutdown with Tunnel Draining
**File:** [services/edge-gateway/src/main.rs](services/edge-gateway/src/main.rs) — line 685
**Priority:** MEDIUM — active tunnels dropped instantly on shutdown

**Fix — implement drain period before hard stop:**
```rust
// On SIGTERM/SIGINT:
async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.expect("signal handler");

    // 1. Stop accepting new connections
    state.accepting.store(false, Ordering::SeqCst);

    // 2. Wait for active tunnels to drain (max 30 seconds)
    let deadline = Instant::now() + Duration::from_secs(30);
    while state.active_connections.load(Ordering::SeqCst) > 0 {
        if Instant::now() > deadline {
            log::warn!("Drain timeout — forcing shutdown with {} active connections",
                state.active_connections.load(Ordering::SeqCst));
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // 3. Flush metering WAL before exit
    state.metering.flush_all().await;
}
```

**Dependencies:** B-02 (WAL flush on shutdown)
**Effort:** 4 hours

---

### B-10 — Add Metering Retry on Flush Failure
**File:** [services/edge-gateway/src/metering.rs](services/edge-gateway/src/metering.rs)
**Priority:** HIGH — if Control API is down, usage data is silently lost

**Fix — exponential backoff retry on flush:**
```rust
async fn flush_with_retry(&self, session_id: &str, data: UsageData) -> Result<()> {
    let mut attempt = 0;
    loop {
        match self.send_to_control_api(session_id, &data).await {
            Ok(_) => return Ok(()),
            Err(e) if attempt < 5 => {
                let backoff = Duration::from_secs(2_u64.pow(attempt));
                log::warn!("Metering flush failed (attempt {}): {}", attempt + 1, e);
                tokio::time::sleep(backoff).await;
                attempt += 1;
            }
            Err(e) => {
                // After 5 retries — data stays in Redis WAL (B-02)
                log::error!("Metering flush permanently failed: {}", e);
                return Err(e);
            }
        }
    }
}
```

**Dependencies:** B-02 (WAL keeps data safe during retries)
**Effort:** 2 hours

---

## Phase 2 — Wiring Disconnected Features
**Timeline: 1–2 weeks**
**Goal: Activate all fully-built modules that are currently dead code**

---

### W-01 — Wire IP Rotation into Provider Selection
**Files:** [services/edge-gateway/src/rotation.rs](services/edge-gateway/src/rotation.rs), [main.rs](services/edge-gateway/src/main.rs)
**Priority:** HIGH — rotation.rs has 4 strategies built; consumers cannot rotate IPs

**Fix — integrate into the provider selection path:**
```rust
// In main.rs, inside request handler:
let provider = match session.rotation_type.as_str() {
    "rotating" => {
        state.rotator.select_next(
            &session.user_id,
            &state.registry,
            RotationStrategy::Smart,
        ).await?
    },
    "sticky" => {
        state.rotator.get_sticky(
            &session.user_id,
            &session.sticky_target,
            &state.registry,
        ).await?
    },
    _ => state.registry.get_best().await?,
};
```

**Add rotation state to AppState:**
```rust
pub rotator: Arc<IpRotator>,  // from rotation.rs
```

**Dependencies:** W-02 (lock-free registry should be in place first)
**Effort:** 4 hours

---

### W-02 — Swap Mutex Registry → Lock-Free DashMap
**Files:** [services/edge-gateway/src/registry/lockfree.rs](services/edge-gateway/src/registry/lockfree.rs), [state.rs](services/edge-gateway/src/state.rs)
**Priority:** HIGH — Mutex contention serializes all routing at ~5K concurrent connections

**Fix — the lock-free registry is already built in `registry/lockfree.rs`. Wire it in:**

In `state.rs`:
```rust
// Replace:
// pub registry: Arc<Mutex<NodeRegistry>>,
// With:
pub registry: Arc<LockFreeNodeRegistry>,  // from registry/lockfree.rs
```

In `main.rs`:
```rust
// Replace all registry.lock().unwrap() calls with direct registry calls
// LockFreeNodeRegistry uses DashMap internally — no locking required
```

**Dependencies:** None (lockfree.rs is self-contained)
**Effort:** 4 hours

---

### W-03 — Wire Connection Pool into Stream Routing
**File:** [services/edge-gateway/src/pool/mod.rs](services/edge-gateway/src/pool/mod.rs), [main.rs](services/edge-gateway/src/main.rs)
**Priority:** HIGH — currently creates new yamux stream per session (high overhead)

**Fix — route sessions through per-provider connection pool:**
```rust
// In main.rs, instead of opening raw connection to provider:
// OLD: let stream = open_new_yamux_stream(provider_addr).await?
// NEW:
let stream = state.pool
    .get_stream(&provider_node_id)
    .await
    .map_err(|e| {
        metrics::pool_exhausted(&provider_node_id);
        e
    })?;
```

**Pool configuration (pool/mod.rs):**
- Min idle connections per provider: 2
- Max connections per provider: 50
- Idle timeout: 5 minutes
- Health check interval: 30 seconds

**Dependencies:** W-02 (lock-free registry must be in place)
**Effort:** 1 day

---

### W-04 — Wire Leader Election to Cluster Tasks
**File:** [services/edge-gateway/src/leader.rs](services/edge-gateway/src/leader.rs), [main.rs](services/edge-gateway/src/main.rs)
**Priority:** MEDIUM — without leader election, all gateway instances do redundant work

**Fix — gate cluster-wide tasks on leader status:**
```rust
// In main.rs background workers:
tokio::spawn(async move {
    loop {
        if state.leader.is_leader().await {
            // Only leader runs these tasks:
            registry_sync_with_control_api(&state).await;
            evict_stale_nodes(&state).await;
            report_cluster_metrics(&state).await;
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
});
```

**Dependencies:** None
**Effort:** 3 hours

---

### W-05 — Wire HTTP/2 CONNECT
**File:** [services/edge-gateway/src/proxy/http2.rs](services/edge-gateway/src/proxy/http2.rs), [main.rs](services/edge-gateway/src/main.rs)
**Priority:** MEDIUM — HTTP/2 multiplexing reduces connection overhead for consumers

**Fix — auto-negotiate in request handler:**
```rust
// In main.rs request handler — detect HTTP version:
let protocol = detect_protocol(&req);
match protocol {
    Protocol::Http2 => {
        proxy::http2::handle_connect(req, state, session).await
    },
    Protocol::Http1 => {
        handle_http1_connect(req, state, session).await  // existing path
    }
}
```

**Dependencies:** W-03 (connection pool should be in place)
**Effort:** 4 hours

---

### W-06 — Wire WebSocket Tunnel Upgrade
**File:** [services/edge-gateway/src/proxy/websocket.rs](services/edge-gateway/src/proxy/websocket.rs), [main.rs](services/edge-gateway/src/main.rs)
**Priority:** MEDIUM — allows TCP-over-WebSocket for clients behind WebSocket-only proxies

**Fix — detect Upgrade: websocket header:**
```rust
if req.headers().get("Upgrade").map(|v| v == "websocket").unwrap_or(false) {
    return proxy::websocket::handle_upgrade(req, state, session).await;
}
```

**Dependencies:** W-02, W-03
**Effort:** 4 hours

---

### W-07 — Wire Zero-Copy Splice on Linux
**File:** [services/edge-gateway/src/proxy/zerocopy.rs](services/edge-gateway/src/proxy/zerocopy.rs), [main.rs](services/edge-gateway/src/main.rs)
**Priority:** MEDIUM — reduces CPU usage for high-bandwidth sessions by ~40%

**Fix — use zero-copy splice as default bridge on Linux:**
```rust
// In tunnel bridge:
#[cfg(target_os = "linux")]
let result = proxy::zerocopy::splice_bidirectional(client, provider).await;

#[cfg(not(target_os = "linux"))]
let result = tokio::io::copy_bidirectional(client, provider).await;
```

**Dependencies:** None
**Effort:** 3 hours

---

## Phase 3 — New Schema Integration
**Timeline: 2–3 weeks**
**Goal: Wire the database schema (proxy engine config, session config, routing profiles) into actual runtime behavior**

---

### N-01 — Read service_configurations in Gateway Routing
**Files:** `control-api/internal/api/channel.go`, `edge-gateway/src/main.rs`
**Priority:** HIGH — provider config exists in DB but never used in routing

**Step 1 — Control API: Expose service config via session data endpoint:**
```go
// When creating session / returning session credentials:
// Fetch the matched provider's service_configurations
// Include relevant fields in the session Redis payload:
sessionData := map[string]interface{}{
    "user_id":           userID,
    "session_id":        sessionID,
    "trust_tier":        user.TrustTier,
    "max_bandwidth_mbps": svcConfig.MaxBandwidthMbps,
    "allowed_ports":      svcConfig.AllowedPorts,
    "blocked_ports":      svcConfig.BlockedPorts,
    "allowed_countries":  svcConfig.AllowedCountries,
    "blocked_countries":  svcConfig.BlockedCountries,
    "captcha_enabled":    svcConfig.CaptchaSolvingEnabled,
    "js_render_enabled":  svcConfig.JavascriptRenderEnabled,
}
```

**Step 2 — Edge Gateway: Read and enforce the config:**
```rust
// In policy check:
if !session.allowed_ports.is_empty() {
    if !session.allowed_ports.contains(&dest_port) {
        return PolicyResult::Denied("port not allowed by provider config");
    }
}
// Check geo restrictions against consumer IP
// Apply per-provider bandwidth cap (not just tier-based)
```

**Dependencies:** Phase 1 complete (session data reliable)
**Effort:** 1 day

---

### N-02 — Enforce session_configurations at Gateway
**Files:** `control-api/internal/api/session.go`, `edge-gateway/src/main.rs`
**Priority:** HIGH — consumer session config (domain filters, rotation, limits) stored but not enforced

**Step 1 — Control API: Include session config in Redis session payload:**
```go
// On session creation, after creating session_configurations record:
sessionPayload["allowed_domains"] = sessionConfig.AllowedDomains
sessionPayload["blocked_domains"] = sessionConfig.BlockedDomains
sessionPayload["bandwidth_limit_gb"] = sessionConfig.BandwidthLimitGB
sessionPayload["time_limit_minutes"] = sessionConfig.TimeLimitMinutes
sessionPayload["rotation_type"] = sessionConfig.RotationType
sessionPayload["rotation_interval_sec"] = sessionConfig.RotationIntervalSeconds
```

**Step 2 — Edge Gateway: Enforce at request time:**
```rust
// Domain filtering:
if session.blocked_domains.iter().any(|d| dest_host.ends_with(d)) {
    return PolicyResult::Denied("domain blocked by session config");
}

// Bandwidth limit enforcement:
if session.bandwidth_limit_gb > 0.0 {
    let used_gb = session.bytes_used as f64 / 1e9;
    if used_gb >= session.bandwidth_limit_gb {
        return Err(SessionError::BandwidthLimitReached);
    }
}

// Time limit enforcement:
if session.time_limit_minutes > 0 {
    let elapsed = session.created_at.elapsed().as_secs() / 60;
    if elapsed >= session.time_limit_minutes as u64 {
        return Err(SessionError::TimeLimitReached);
    }
}
```

**Dependencies:** N-01 (provider config wired first)
**Effort:** 1 day

---

### N-03 — Connect routing_profiles to Matching Engine
**File:** [services/control-api/internal/api/session.go](services/control-api/internal/api/session.go)
**Priority:** MEDIUM — 6 presets seeded in DB (web-scraping, gaming, etc.) but not used

**Fix — accept `routing_profile` slug in session creation request:**
```go
type CreateSessionRequest struct {
    Type           string `json:"type"`
    RoutingProfile string `json:"routing_profile"` // e.g. "web-scraping"
    // ... other fields
}

// In createSession handler:
if req.RoutingProfile != "" {
    var profile models.RoutingProfile
    db.Where("slug = ? AND is_active = true", req.RoutingProfile).First(&profile)

    // Apply profile defaults if not overridden:
    if req.RotationType == "" {
        req.RotationType = profile.AutoRotation ? "rotating" : "sticky"
    }
    if req.RotationInterval == 0 {
        req.RotationInterval = profile.RotationIntervalSeconds
    }
    // Apply speed/stability/price weights to provider matching score
}
```

**Dependencies:** N-01, N-02
**Effort:** 4 hours

---

### N-04 — Verify blockchain_state_cache Population
**File:** [services/control-api/internal/solana/settlement.go](services/control-api/internal/solana/settlement.go)
**Priority:** HIGH — blockchain state cache exists but may not be populated by indexer

**Steps:**
1. Read the blockchain indexer code (in `main.go` worker registration)
2. Verify it upserts into `blockchain_state_cache` after each Solana poll
3. If missing — add upsert:
```go
// In blockchain indexer, after fetching account data:
db.Clauses(clause.OnConflict{
    Columns: []clause.Column{{Name: "pda"}},
    DoUpdates: clause.AssignmentColumns([]string{"data", "slot", "signature", "status", "last_synced_at"}),
}).Create(&models.BlockchainStateCache{
    PDA:        account.PublicKey.String(),
    ProgramID:  programID,
    AccountType: accountType,
    Data:        accountDataJSON,
    Slot:        currentSlot,
    Signature:   txSignature,
})
```

**Dependencies:** None
**Effort:** 3 hours

---

### N-05 — Verify encrypted_credentials Written on Session Create
**File:** [services/control-api/internal/api/session.go](services/control-api/internal/api/session.go)
**Priority:** HIGH — encrypted credential backup may not be written

**Steps:**
1. Check `createSession` handler for `encrypted_credentials` insert
2. If missing — add AES-256-GCM encryption and insert:
```go
import "crypto/aes"
import "crypto/cipher"

key := []byte(os.Getenv("ENCRYPTION_KEY")) // 32 bytes for AES-256

func encryptCredential(plaintext, key []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    gcm, err := cipher.NewGCM(block)
    nonce := make([]byte, gcm.NonceSize())
    io.ReadFull(rand.Reader, nonce)
    return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// After session created:
userEnc, _ := encryptCredential([]byte(credentials.Username), key)
passEnc, _ := encryptCredential([]byte(credentials.Password), key)
db.Create(&models.EncryptedCredentials{
    SessionID:   session.ID,
    UsernameEnc: base64.StdEncoding.EncodeToString(userEnc),
    PasswordEnc: base64.StdEncoding.EncodeToString(passEnc),
})
```

**Dependencies:** None
**Effort:** 2 hours

---

### N-06 — Enforce Soft-Delete Filters on All API Queries
**File:** [services/control-api/internal/api/*.go](services/control-api/internal/api/)
**Priority:** HIGH — soft-deleted records may be returned in API responses

**Fix — add GORM global scope or explicit filter:**

Option A — GORM soft-delete plugin (preferred):
```go
// If using GORM v2 — add DeletedAt field to all models:
type BaseModel struct {
    ID        uuid.UUID      `gorm:"primaryKey"`
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt gorm.DeletedAt `gorm:"index"` // ← GORM handles WHERE deleted_at IS NULL automatically
}
```

Option B — explicit scopes where BaseModel can't be used:
```go
db.Where("deleted_at IS NULL").Find(&results)
```

**Audit:** Review every `db.Find()`, `db.First()`, `db.Where().Find()` call in `internal/api/` to ensure soft-delete filter is applied.

**Dependencies:** None
**Effort:** 1 day

---

### N-07 — Payout Respects linked_wallets is_primary Flag
**File:** [services/control-api/internal/billing/worker.go](services/control-api/internal/billing/worker.go)
**Priority:** HIGH — payouts may go to wrong wallet if user has multiple linked

**Fix:**
```go
// When triggering payout for a provider:
var primaryWallet models.LinkedWallet
result := db.Where(
    "user_id = ? AND chain = 'solana' AND is_primary = true AND verified = true AND deleted_at IS NULL",
    providerID,
).First(&primaryWallet)

if result.Error != nil {
    // Fall back to profile.solana_wallet if no linked wallet found
    primaryWallet.Address = provider.Profile.SolanaWallet
}

solana.SettleProvider(primaryWallet.Address, amount)
```

**Dependencies:** B-01 (payout retry queue), S-04 (address validation)
**Effort:** 3 hours

---

### N-08 — Implement Premium Services Billing
**Files:** `control-api/internal/billing/`, edge-gateway proxy modules
**Priority:** MEDIUM — schema defines captcha solving ($0.002), JS render ($0.005), fingerprinting ($0.01), screenshots ($0.005)

**Steps:**
1. Add premium service request tracking to session data
2. Count premium service usages per session in Redis
3. Add to billing worker — calculate premium service costs separately from bandwidth:
```go
// In settleSession:
captchaCost := float64(session.CaptchaSolves) * svcConfig.CaptchaPricePerSolve
jsCost := float64(session.JSRenders) * svcConfig.JSRenderPricePerPage
totalCost := bandwidthCost + captchaCost + jsCost
```
4. Add ledger entry type `premium_service_charge`
5. Gateway must track and report premium service usage per session

**Dependencies:** N-01, N-02
**Effort:** 3 days

---

## Phase 4 — Performance & Scale
**Timeline: 4–6 weeks**
**Goal: Activate ML routing, DDoS protection, multi-region; replace O(n) selection**

---

### P-01 — Wire ML Router with A/B Testing
**Files:** `edge-gateway/src/routing/ml_router.rs`, `ab_test.rs`, `analytics.rs`
**Priority:** HIGH — ML-based routing exists but all traffic uses heuristics

**Steps:**
1. Configure A/B split (start at 5% ML, 95% heuristic per `rollout.rs`)
2. Wire A/B decision into provider selection:
```rust
let provider = if state.ab_test.use_ml_routing(&session.user_id) {
    state.ml_router.select_provider(&features).await?
} else {
    state.registry.get_best().await?
};
state.analytics.record_routing_decision(provider.id, used_ml).await;
```
3. Monitor via analytics — increase ML % as confidence grows
4. Full ML rollout when ML win rate > heuristic win rate for 2 weeks

**Dependencies:** Phase 1 & 2 complete
**Effort:** 2 days

---

### P-02 — Wire Predictive Connection Warmup
**File:** `edge-gateway/src/routing/prewarm.rs`
**Priority:** MEDIUM — reduces cold connection latency for new sessions

**Fix:**
```rust
// Background task — pre-open connections to top N providers:
tokio::spawn(async move {
    loop {
        let top_providers = state.registry.top_n(20).await;
        for provider in top_providers {
            state.pool.prewarm(&provider.id, min_idle: 2).await;
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
});
```

**Dependencies:** W-03 (connection pool)
**Effort:** 1 day

---

### P-03 — Wire Adaptive DDoS Protection
**File:** `edge-gateway/src/security/ddos.rs`, `main.rs`
**Priority:** HIGH — gateway is DDoS-vulnerable without this

**Fix — activate in request pre-flight:**
```rust
// Before session auth (main.rs):
let ddos_result = state.ddos.check_request(&client_ip, &req).await;
match ddos_result {
    DDoSResult::Allow => {},
    DDoSResult::Challenge => return serve_challenge(req).await,
    DDoSResult::Block => return Ok(Response::builder().status(429).body(Body::empty()).unwrap()),
}
```

**Dependencies:** Phase 1 complete
**Effort:** 1 day

---

### P-04 — Wire TLS Fingerprinting + Bot Detection
**File:** `edge-gateway/src/security/fingerprint.rs`
**Priority:** MEDIUM — bots can abuse the proxy network

**Fix:**
```rust
// On new TLS connection:
let fingerprint = state.fingerprint_db.classify(&tls_hello).await;
if fingerprint.is_known_bot {
    metrics::bot_detected(&fingerprint.signature);
    // Serve with increased rate limits or challenge
}
```

**Dependencies:** P-03 (DDoS framework active)
**Effort:** 1 day

---

### P-05 — Wire Multi-Region Routing
**File:** `edge-gateway/src/multiregion/routing.rs`
**Priority:** MEDIUM — currently single-region; no geographic failover

**Fix:**
```rust
// In provider selection:
let preferred_region = state.geo_block.region_for_consumer(&consumer_ip).await;
let provider = state.multiregion.select_provider(
    &state.registry,
    preferred_region,
    &session,
).await?;
```

**Dependencies:** B-07 (GeoIP working), P-03 (DDoS active)
**Effort:** 2 days

---

### P-06 — Replace O(n) Provider Selection with Priority Queue
**File:** [services/edge-gateway/src/state.rs](services/edge-gateway/src/state.rs)
**Priority:** HIGH — linear scan per request is O(n); breaks at 1,000+ providers

**Fix — maintain a sorted priority queue alongside the DashMap:**
```rust
use std::collections::BinaryHeap;

// On score update — update heap position:
pub async fn update_score(&self, node_id: &str, new_score: i64) {
    // Update in DashMap
    self.nodes.alter(node_id, |_, mut node| {
        node.score = new_score;
        node
    });
    // Rebuild heap (or use indexed priority queue crate)
    self.rebuild_heap().await;
}

// get_best() becomes O(1):
pub async fn get_best(&self) -> Option<NodeInfo> {
    self.heap.peek().map(|n| n.clone())
}
```

**Dependencies:** W-02 (lock-free registry in place)
**Effort:** 4 hours

---

### P-07 — Add Redis Connection Pooling
**Files:** `edge-gateway/src/auth.rs`, `registry/`
**Priority:** HIGH — creates new Redis connection per operation; expensive under load

**Add to Cargo.toml:**
```toml
bb8-redis = "0.15"
```

**In auth.rs:**
```rust
// Replace: let mut conn = redis::Client::open(url)?.get_async_connection().await?;
// With:
let conn = state.redis_pool.get().await?;
```

**In AppState:**
```rust
pub redis_pool: Arc<bb8::Pool<bb8_redis::RedisConnectionManager>>,
```

**Initialize in main.rs:**
```rust
let manager = bb8_redis::RedisConnectionManager::new(redis_url)?;
let redis_pool = bb8::Pool::builder().max_size(50).build(manager).await?;
```

**Dependencies:** Phase 1 complete
**Effort:** 4 hours

---

## Phase 5 — Ongoing Hardening
**Timeline: Continuous**

| Task | Description |
|------|-------------|
| Penetration test | External pen test after Phase 0 fixes land |
| Load test | Verify 10K concurrent connections after Phase 2 |
| ML model training | Train initial ONNX model on routing analytics data |
| Chaos engineering | Simulate Redis/Solana failures to verify fallbacks |
| pg_cron audit | Verify partition creation runs monthly |
| Provider CLI testing | E2E test the provider-cli onboarding flow |
| Go SDK testing | Validate the Go SDK against the API |
| Kubernetes migration | Move from docker-compose to k8s using existing `infra/k8s/` tests |

---

## Implementation Order Summary

```
Week 1:  S-01 → S-02 → S-03 → S-04 → S-05 → S-06 → S-07 → S-08 → S-09 → S-10
         (All Phase 0 security fixes — 2-3 days of focused work)

Week 2:  B-01 → B-02 → B-03 → B-04 → B-10
         (Payout reliability, metering durability, heartbeat, circuit breaker)

Week 3:  B-05 → B-06 → B-07 → B-08 → B-09
         (QoS tiers, port policy, GeoIP, audit partitioning, graceful shutdown)

Week 4:  W-02 → W-01 → W-03 → W-04
         (Lock-free registry → IP rotation → connection pool → leader election)

Week 5:  W-05 → W-06 → W-07
         (HTTP/2, WebSocket, zero-copy)

Week 6-7: N-04 → N-05 → N-06 → N-07 → N-03 → N-01 → N-02 → N-08
          (New schema verification, then enforcement, then premium services)

Week 8-12: P-06 → P-07 → P-01 → P-02 → P-03 → P-04 → P-05
           (Performance, DDoS, ML routing, multi-region)
```

---

## Definition of Done (Per Phase)

| Phase | Done When |
|-------|-----------|
| Phase 0 | All 10 security tasks pass code review + pen test shows no critical vulns |
| Phase 1 | Payout failures retried + metering survives gateway restart + all tests green |
| Phase 2 | IP rotation working in E2E test + lock-free registry under load test |
| Phase 3 | session_configurations enforced at gateway + billing charges premium services |
| Phase 4 | p99 latency < 5ms + 10K concurrent connections sustained + DDoS test passed |

---

*Implementation plan authored 2026-03-13. Tasks should be worked in phase order. Each task should have a feature branch, PR, and passing tests before merge.*
