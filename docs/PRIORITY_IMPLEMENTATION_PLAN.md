# ProxyHubb — Priority Implementation Plan
## Fix & Improvement Roadmap (Based on SYSTEM_ARCHITECTURE_ANALYSIS.md)

**Created:** 2026-03-16
**Derived from:** SYSTEM_ARCHITECTURE_ANALYSIS.md
**Total Phases:** P0 (Security) → P1 (Financial) → P2 (Architecture) → P3 (Ops) → P4 (Product)

---

## How to Read This Plan

Each item has:
- **What** — the exact problem being fixed
- **Why** — business or security impact
- **Where** — exact files and functions to touch
- **How** — concrete step-by-step implementation
- **Done when** — acceptance criteria checklist

Complete phases in order. P2–P4 can run as parallel tracks once P0 and P1 are done.

---

# PHASE 0 — Security Critical
> Block mainnet launch until ALL P0 items are complete.

---

## P0.1 — Fix Provider Token Hashing

**What:** CLI auth tokens stored with fake "hashing" (`[HASHED]` string suffix), not real one-way cryptographic hashing.

**Why:** DB breach = all provider CLI tokens are recoverable. Any provider's node can be hijacked. Any attacker can impersonate providers.

**Where:**
- `services/control-api/internal/api/provider_token.go` — `CreateProviderToken`, `ValidateProviderToken` functions
- `services/control-api/go.mod` — add `golang.org/x/crypto`
- New migration: `migrations/000038_invalidate_provider_tokens.up.sql`

**How:**

Step 1 — Add Argon2id dependency:
```bash
cd services/control-api
go get golang.org/x/crypto
```

Step 2 — Replace token hashing in `provider_token.go`:
```go
import (
    "crypto/subtle"
    "encoding/base64"
    "golang.org/x/crypto/argon2"
)

// hashProviderToken produces a non-reversible Argon2id hash
func hashProviderToken(token string) string {
    salt := make([]byte, 16)
    rand.Read(salt)
    hash := argon2.IDKey([]byte(token), salt, 1, 64*1024, 4, 32)
    return fmt.Sprintf("$argon2id$%s$%s",
        base64.RawStdEncoding.EncodeToString(salt),
        base64.RawStdEncoding.EncodeToString(hash))
}

// verifyProviderToken compares a raw token against a stored Argon2id hash
func verifyProviderToken(rawToken, storedHash string) bool {
    if !strings.HasPrefix(storedHash, "$argon2id$") {
        return false // reject old-format hashes
    }
    parts := strings.Split(storedHash, "$")
    if len(parts) != 4 {
        return false
    }
    salt, err := base64.RawStdEncoding.DecodeString(parts[2])
    if err != nil {
        return false
    }
    expected, err := base64.RawStdEncoding.DecodeString(parts[3])
    if err != nil {
        return false
    }
    derived := argon2.IDKey([]byte(rawToken), salt, 1, 64*1024, 4, 32)
    return subtle.ConstantTimeCompare(expected, derived) == 1
}
```

Step 3 — Update `ValidateProviderToken` to call `verifyProviderToken()` instead of string comparison.

Step 4 — Create migration to invalidate all old tokens:
```sql
-- migrations/000038_invalidate_provider_tokens.up.sql
-- All existing tokens used the old non-hash format and cannot be re-hashed.
-- Revoke them all. Providers must generate new tokens.
UPDATE provider_tokens
SET revoked = true,
    revoked_at = NOW(),
    updated_at = NOW()
WHERE revoked = false;

-- migrations/000038_invalidate_provider_tokens.down.sql
-- Cannot undo — tokens were using insecure format
```

Step 5 — Notify all providers via the notifications system that their CLI token has been revoked and they must generate a new one from the dashboard.

**Done when:**
- [ ] New tokens produce Argon2id hash (verify format in DB: starts with `$argon2id$`)
- [ ] `ValidateProviderToken` uses constant-time comparison
- [ ] All existing tokens revoked via migration
- [ ] Test: create token → validate with correct value → returns true
- [ ] Test: validate with wrong value → returns false (no timing leak)
- [ ] Test: old `[HASHED]` format → rejected

---

## P0.2 — Enforce Session Credential Encryption at Startup

**What:** Session credentials may be stored in plaintext if the one-time `MIGRATE_CREDENTIALS=true` flag was never executed.

**Why:** Plaintext proxy credentials in DB = anyone with DB read access can use any active proxy session. Direct privacy and security breach.

**Where:**
- `services/control-api/main.go` — startup check
- `services/control-api/internal/models/session.go` — Session model
- New migration: `migrations/000039_enforce_encrypted_credentials.up.sql`

**How:**

Step 1 — Add a startup guard in `main.go` (runs before server accepts traffic):
```go
func validateCredentialEncryption(db *gorm.DB) error {
    if os.Getenv("SKIP_CREDENTIAL_CHECK") == "true" {
        log.Warn("SKIP_CREDENTIAL_CHECK=true — skipping encryption validation")
        return nil
    }

    var count int64
    // AES-GCM base64 output for 8-char input is always >20 chars
    // Plaintext usernames are exactly 8 chars (session generation code)
    result := db.Raw(`
        SELECT COUNT(*) FROM sessions
        WHERE deleted_at IS NULL
          AND credentials_username IS NOT NULL
          AND length(credentials_username) <= 12
    `).Scan(&count)

    if result.Error != nil {
        return fmt.Errorf("credential check query failed: %w", result.Error)
    }
    if count > 0 {
        return fmt.Errorf(
            "SECURITY BLOCK: %d active sessions have unencrypted credentials. "+
                "Run with MIGRATE_CREDENTIALS=true to encrypt them before starting.", count)
    }
    return nil
}
```

Step 2 — Call the guard in `main.go` before `r.Run()`:
```go
if err := validateCredentialEncryption(db); err != nil {
    log.Fatalf(err.Error())
}
```

Step 3 — Migration to document the enforcement:
```sql
-- migrations/000039_enforce_encrypted_credentials.up.sql
-- This migration validates that no plaintext credentials remain.
-- If this fails, run the service with MIGRATE_CREDENTIALS=true first.
DO $$
DECLARE unencrypted INT;
BEGIN
    SELECT COUNT(*) INTO unencrypted
    FROM sessions
    WHERE deleted_at IS NULL
      AND credentials_username IS NOT NULL
      AND length(credentials_username) <= 12;

    IF unencrypted > 0 THEN
        RAISE EXCEPTION
            'Cannot apply migration: % sessions have unencrypted credentials', unencrypted;
    END IF;
END $$;
```

**Done when:**
- [ ] Startup blocks if unencrypted credentials detected
- [ ] `MIGRATE_CREDENTIALS=true` flow encrypts all sessions
- [ ] After migration, startup proceeds normally
- [ ] Test: insert plaintext session → start server → server refuses to start
- [ ] Test: run with `MIGRATE_CREDENTIALS=true` → start server → starts normally

---

## P0.3 — Oracle Key Protection (Interim + Full Multi-Sig)

### Interim (1–2 days): Velocity Limits + Key Rotation Runbook

**What:** Single oracle keypair controls all treasury operations with no rate limiting.

**Why:** Compromised oracle key with no velocity limit = entire treasury drained in one transaction.

**Where:**
- `services/control-api/internal/solana/client.go` — `SendSOL`, `BatchTransferSOL`
- `services/control-api/internal/treasury/treasury_manager.go`
- New: `services/control-api/internal/solana/keypair_monitor.go`
- New: `services/control-api/ORACLE_KEY_ROTATION.md`

**How (Interim):**

Step 1 — Add hard velocity limits in `client.go` before every transfer:
```go
const (
    MaxSingleTransferSOL  = 50.0   // Hard cap per tx
    MaxHourlyOutflowSOL   = 500.0  // Rolling 1h window
)

func (c *OracleClient) checkTransferLimits(amountSOL float64) error {
    if amountSOL > MaxSingleTransferSOL {
        c.alerts.Send(AlertCritical, "Oracle: Single transfer exceeds limit",
            fmt.Sprintf("%.4f SOL requested, max %.4f SOL", amountSOL, MaxSingleTransferSOL))
        return fmt.Errorf("transfer amount %.4f SOL exceeds max %.4f SOL per tx",
            amountSOL, MaxSingleTransferSOL)
    }

    // Rolling hourly window via Redis
    key := "oracle:outflow:hourly"
    newTotal, _ := c.redis.IncrByFloat(ctx, key, amountSOL).Result()
    c.redis.Expire(ctx, key, time.Hour)

    if newTotal > MaxHourlyOutflowSOL {
        c.alerts.Send(AlertCritical, "Oracle: Hourly velocity limit hit",
            fmt.Sprintf("%.4f SOL in last hour, limit %.4f SOL", newTotal, MaxHourlyOutflowSOL))
        return fmt.Errorf("hourly transfer limit exceeded: %.4f / %.4f SOL", newTotal, MaxHourlyOutflowSOL)
    }
    return nil
}
```

Step 2 — Call `checkTransferLimits` at the top of `SendSOL` and `BatchTransferSOL`.

Step 3 — Create `keypair_monitor.go`:
```go
// Runs every 10 minutes
// 1. Fetch on-chain treasury balance
// 2. Compare against DB ledger expected balance
// 3. If discrepancy > 0.01 SOL → CRITICAL alert
// 4. If oracle key used for unrecognized tx → CRITICAL alert + freeze transfers

type KeypairMonitor struct {
    solana   *OracleClient
    db       *gorm.DB
    alerts   *alerts.AlertChannels
    freezeMu sync.RWMutex
    frozen   bool
}

func (m *KeypairMonitor) Run(ctx context.Context) {
    ticker := time.NewTicker(10 * time.Minute)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            m.checkKeypairHealth()
        }
    }
}
```

Step 4 — Add transfer freeze check to `SendSOL` / `BatchTransferSOL`:
```go
if m.frozen {
    return errors.New("oracle transfers frozen — manual review required")
}
```

Step 5 — Create `ORACLE_KEY_ROTATION.md`:
```markdown
# Oracle Keypair Rotation Procedure

## When to rotate
- Any suspected key compromise
- Quarterly rotation (best practice)
- After any staff departure with key access

## Steps
1. Generate new keypair:
   solana-keygen new --no-passphrase -o /tmp/new-oracle.json
2. Fund new keypair: transfer 0.1 SOL for rent
3. Drain old keypair: transfer remaining SOL to treasury
4. Update env: SOLANA_ORACLE_KEYPAIR_PATH=/run/secrets/new-oracle.json
5. Zero-downtime deploy (blue/green)
6. Verify: next batch payout uses new key (check tx signers on explorer)
7. Archive old keypair to offline cold storage
8. Revoke access to old keypair location

## Emergency (compromise suspected)
1. IMMEDIATELY set ORACLE_TRANSFER_FREEZE=true in env
2. Restart control-api (freeze takes effect)
3. Follow standard rotation steps above
4. Audit all transactions from old key in the last 24h
```

### Full Fix (2–3 weeks): Multi-Sig Oracle

**Where:** `services/control-api/internal/solana/client.go` — `MultiSigConfig` already loaded, needs coordination logic.

**How:**

Step 6 — Wire up multi-sig coordination via NATS:
```go
// For transfers > 1 SOL:
// 1. Publish sign request to NATS: "oracle.sign.request"
// 2. Each oracle instance receives request, signs with own key, publishes to "oracle.sign.response"
// 3. Coordinator collects signatures (30s timeout)
// 4. When M-of-N received, assemble multisig tx and broadcast
// 5. Fall back to single-sig only if explicitly configured (devnet only)
```

**Done when (interim):**
- [ ] Velocity limits block oversized transfers
- [ ] Hourly outflow limit enforced via Redis
- [ ] Alerts fire on limit hit
- [ ] `KeypairMonitor` running as background goroutine
- [ ] Transfer freeze mechanism works
- [ ] Key rotation runbook documented and tested on devnet

**Done when (full):**
- [ ] Multi-sig coordination via NATS working
- [ ] Transfers >1 SOL require M-of-N signatures
- [ ] Single-sig path completely removed from mainnet config

---

# PHASE 1 — Financial Integrity
> Complete before handling real money at scale.

---

## P1.1 — Enable Redis AOF Persistence

**What:** Redis holds real-time bandwidth metering in `billing:session:*:pending` keys with no persistence. A crash loses all in-flight billing.

**Why:** Providers lose earnings. Consumers get free bandwidth. At scale (1000 sessions/hour) this is material revenue loss on every Redis restart.

**Where:**
- `docker-compose.yml` — Redis service command
- `docker-compose.prod.yml` — production Redis config
- `services/control-api/internal/billing/worker.go` — add startup reconciliation

**How:**

Step 1 — Update Redis service in `docker-compose.yml`:
```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --appendonly yes
    --appendfsync everysec
    --auto-aof-rewrite-percentage 100
    --auto-aof-rewrite-min-size 64mb
    --maxmemory 512mb
    --maxmemory-policy allkeys-lru
  volumes:
    - redis_data:/data
  # ... rest of config unchanged
```

Step 2 — Add `redis_data` volume in `docker-compose.yml`:
```yaml
volumes:
  postgres_data:
  redis_data:
```

Step 3 — Add startup reconciliation in `billing/worker.go`:
```go
// Call this before starting the hourly settlement loop
func (w *SettlementWorker) ReconcileOnStartup(ctx context.Context) {
    log.Info("BillingWorker: scanning for unsettled Redis keys from before restart...")
    iter := w.redis.Scan(ctx, 0, "billing:session:*:pending", 100).Iterator()
    count := 0
    for iter.Next(ctx) {
        key := iter.Val()
        // Extract session username from key
        // Check DB: when was this session last settled?
        // If key exists in Redis but session has no recent settlement → settle now
        w.settleSession(ctx, key)
        count++
    }
    log.Infof("BillingWorker: startup reconciliation settled %d pending sessions", count)
}
```

**Done when:**
- [ ] `appendonly yes` confirmed in Redis config
- [ ] `redis_data` volume persists across `docker-compose restart redis`
- [ ] Test: start session → add bytes in Redis → stop Redis → restart Redis → bytes still present
- [ ] Test: startup reconciliation runs and settles any recovered keys
- [ ] Verify AOF file created: `docker exec proxyhubb-redis-1 ls /data/appendonly.aof`

---

## P1.2 — Fix SOL Price Feed Fallback

**What:** Hardcoded fallback `$150/SOL` in `billing/price.go`. If price feeds fail and SOL is at $200, all sessions during the outage are undercharged by 25%.

**Why:** Direct, immediate revenue loss during any price feed outage. As the platform scales, even a 1-hour outage at $150 vs $200/SOL is significant.

**Where:**
- `services/control-api/internal/billing/price.go` — `GetSOLPriceUSD` and fallback constant
- `.env.example` — add `EMERGENCY_SOL_PRICE_USD`

**How:**

Step 1 — Replace hardcoded fallback with layered fallback in `price.go`:
```go
type PriceFeed struct {
    redis           *redis.Client
    sources         []PriceSource // CoinGecko, CoinMarketCap
    lastKnownGoodMu sync.RWMutex
    lastKnownGoodAt time.Time
}

const (
    lastKnownGoodKey    = "pricing:sol:last_known_good"
    lastKnownGoodTTL    = 25 * time.Hour
    sanityDeviationMax  = 0.30 // Reject prices deviating >30% from last known
)

func (p *PriceFeed) GetSOLPriceUSD() float64 {
    // Tier 1: Live price from API sources
    for _, src := range p.sources {
        if price, ok := src.Fetch(); ok {
            if p.passesSanityCheck(price) {
                p.cacheLastKnownGood(price)
                return price
            }
            log.Warnf("Price from %s failed sanity check: %.2f", src.Name(), price)
        }
    }

    // Tier 2: Last known good price from Redis (up to 24h old)
    if cached, err := p.redis.Get(ctx, lastKnownGoodKey).Float64(); err == nil {
        log.Warnf("All price feeds down — using cached price: $%.2f/SOL", cached)
        return cached
    }

    // Tier 3: Emergency fallback from env (manually maintained)
    emergency := p.getEmergencyFallback()
    log.Errorf("CRITICAL: All price feeds down AND no cached price — "+
        "using emergency fallback $%.2f/SOL. Check EMERGENCY_SOL_PRICE_USD env.", emergency)
    p.alerts.Send(AlertCritical, "All price feeds down", fmt.Sprintf("Using emergency fallback $%.2f", emergency))
    return emergency
}

func (p *PriceFeed) passesSanityCheck(newPrice float64) bool {
    cached, err := p.redis.Get(ctx, lastKnownGoodKey).Float64()
    if err != nil {
        return true // No baseline yet — accept
    }
    deviation := math.Abs(newPrice-cached) / cached
    return deviation <= sanityDeviationMax
}

func (p *PriceFeed) getEmergencyFallback() float64 {
    if v := os.Getenv("EMERGENCY_SOL_PRICE_USD"); v != "" {
        if price, err := strconv.ParseFloat(v, 64); err == nil {
            return price
        }
    }
    return 150.0 // Absolute last resort
}

func (p *PriceFeed) cacheLastKnownGood(price float64) {
    p.redis.Set(ctx, lastKnownGoodKey, price, lastKnownGoodTTL)
}
```

Step 2 — Add to `.env.example`:
```env
# Emergency SOL price fallback (USD). Update this manually when feeds are down.
# Check current price: https://coinmarketcap.com/currencies/solana/
EMERGENCY_SOL_PRICE_USD=200
```

**Done when:**
- [ ] Live price cached to Redis on every successful fetch
- [ ] Fallback uses Redis cached price (up to 24h old) before env var
- [ ] Env var fallback reads `EMERGENCY_SOL_PRICE_USD` (not hardcoded 150)
- [ ] Sanity check rejects prices with >30% swing
- [ ] Alert fires when falling back to cached price
- [ ] Alert fires (critical) when using emergency fallback
- [ ] Test: mock both API sources to fail → cached price used → no alert yet
- [ ] Test: mock cache miss too → env var used → critical alert fires

---

## P1.3 — NATS JetStream Dead Letter Queue for Billing Events

**What:** NATS messages silently dropped on consumer failure. Lost billing and payout events = lost money.

**Why:** In a financial system, every event is money. Silent drops are unacceptable.

**Where:**
- `services/control-api/main.go` — NATS JetStream setup
- `services/control-api/internal/ws/hub.go` — event publishing
- New: `services/control-api/internal/events/dlq.go`

**How:**

Step 1 — Enable JetStream streams in NATS setup (NATS in docker-compose already has `--jetstream`):
```go
// In NATS connection initialization:
js, err := nc.JetStream()
if err != nil {
    log.Fatalf("JetStream init failed: %v", err)
}

// Billing stream (usage events)
js.AddStream(&nats.StreamConfig{
    Name:       "BILLING",
    Subjects:   []string{"billing.>"},
    Retention:  nats.WorkQueuePolicy,
    MaxAge:     7 * 24 * time.Hour,
    Storage:    nats.FileStorage,
    Replicas:   1,
})

// Payout stream (provider earnings events)
js.AddStream(&nats.StreamConfig{
    Name:       "PAYOUTS",
    Subjects:   []string{"payout.>"},
    Retention:  nats.WorkQueuePolicy,
    MaxAge:     30 * 24 * time.Hour,
    Storage:    nats.FileStorage,
    Replicas:   1,
})

// Dead Letter Queue stream
js.AddStream(&nats.StreamConfig{
    Name:       "DLQ",
    Subjects:   []string{"dlq.>"},
    MaxAge:     30 * 24 * time.Hour,
    Storage:    nats.FileStorage,
})
```

Step 2 — Create `events/dlq.go`:
```go
package events

type DLQMessage struct {
    OriginalSubject string    `json:"original_subject"`
    Payload         []byte    `json:"payload"`
    FailureReason   string    `json:"failure_reason"`
    Attempts        int       `json:"attempts"`
    FirstFailedAt   time.Time `json:"first_failed_at"`
    LastFailedAt    time.Time `json:"last_failed_at"`
}

type DLQHandler struct {
    js     nats.JetStreamContext
    alerts *alerts.AlertChannels
}

func (h *DLQHandler) SendToDLQ(originalSubject string, data []byte, reason error) {
    msg := DLQMessage{
        OriginalSubject: originalSubject,
        Payload:         data,
        FailureReason:   reason.Error(),
        Attempts:        3,
        FirstFailedAt:   time.Now(),
        LastFailedAt:    time.Now(),
    }
    payload, _ := json.Marshal(msg)
    h.js.Publish("dlq."+originalSubject, payload)
    h.alerts.Send(AlertWarning, "DLQ: Message failed processing",
        fmt.Sprintf("Subject: %s | Reason: %s", originalSubject, reason))
}
```

Step 3 — Add admin DLQ endpoints:
```go
// GET  /v1/admin/dlq           — list DLQ messages
// POST /v1/admin/dlq/:id/replay — replay a failed message
// DELETE /v1/admin/dlq/:id     — acknowledge and discard
```

Step 4 — Configure JetStream consumers with `MaxDeliver: 3` so messages are auto-sent to DLQ after 3 failed attempts.

**Done when:**
- [ ] JetStream streams created for BILLING and PAYOUTS
- [ ] DLQ stream created
- [ ] Failed messages (after 3 attempts) routed to DLQ
- [ ] Alert fires when DLQ receives a message
- [ ] Admin DLQ replay endpoint working
- [ ] Test: publish billing event → kill consumer mid-process → restart → message redelivered exactly once

---

## P1.4 — Reconciliation Alert Escalation

**What:** `treasury/reconciliation.go` detects financial discrepancies but only writes to logs. No human is alerted.

**Why:** A financial discrepancy (on-chain balance ≠ DB ledger) that goes unnoticed could indicate theft, a bug, or accounting error. Logs are not monitored 24/7.

**Where:**
- `services/control-api/internal/treasury/reconciliation.go`
- New: `services/control-api/internal/alerts/channels.go`
- `.env.example`

**How:**

Step 1 — Create `alerts/channels.go`:
```go
package alerts

type Level string
const (
    Info     Level = "info"
    Warning  Level = "warning"
    Critical Level = "critical"
)

type AlertChannels struct {
    SlackWebhookURL string
    AdminEmails     []string
    logger          *log.Logger
}

func NewAlertChannels() *AlertChannels {
    return &AlertChannels{
        SlackWebhookURL: os.Getenv("SLACK_ALERT_WEBHOOK_URL"),
        AdminEmails:     strings.Split(os.Getenv("ALERT_ADMIN_EMAILS"), ","),
    }
}

func (a *AlertChannels) Send(level Level, title, message string) {
    // 1. Always log
    log.Printf("[ALERT:%s] %s: %s", level, title, message)

    // 2. Slack (if configured)
    if a.SlackWebhookURL != "" {
        go a.sendSlack(level, title, message)
    }

    // 3. Email for Critical
    if level == Critical && len(a.AdminEmails) > 0 {
        go a.sendEmail(title, message)
    }
}

func (a *AlertChannels) sendSlack(level Level, title, message string) {
    emoji := map[Level]string{Info: "ℹ️", Warning: "⚠️", Critical: "🚨"}[level]
    payload := map[string]string{
        "text": fmt.Sprintf("%s *[%s] %s*\n%s", emoji, level, title, message),
    }
    body, _ := json.Marshal(payload)
    http.Post(a.SlackWebhookURL, "application/json", bytes.NewReader(body))
}
```

Step 2 — Wire into `reconciliation.go`:
```go
// Replace all log.Printf("discrepancy...") with:
if math.Abs(discrepancy) > 0.001 { // > 0.001 SOL threshold
    a.alerts.Send(alerts.Critical,
        "Treasury Reconciliation Discrepancy",
        fmt.Sprintf("On-chain: %.9f SOL | DB ledger: %.9f SOL | Diff: %.9f SOL | Time: %s",
            onChainBalance, dbBalance, discrepancy, time.Now().UTC()))
}
```

Step 3 — Add to `.env.example`:
```env
# Alert channels (optional but strongly recommended for production)
SLACK_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
ALERT_ADMIN_EMAILS=ops@proxyhubb.com,cto@proxyhubb.com
```

**Done when:**
- [ ] `AlertChannels` struct created, reads from env
- [ ] Reconciliation sends Slack message on any discrepancy >0.001 SOL
- [ ] Critical alert sends email for discrepancies >0.01 SOL
- [ ] Wire `AlertChannels` into treasury_manager, keypair_monitor, price feed
- [ ] Test: manually create DB/chain discrepancy in dev → Slack message received

---

# PHASE 2 — Architecture Cleanup
> Reduces technical debt and developer confusion.

---

## P2.1 — Clarify Session vs Order Billing Model

**What:** Two overlapping financial paths — wallet balance (sessions) and on-chain escrow (orders) — with no documented rule for when each is used. Causes billing inconsistencies.

**Design decision to enforce:**
- `POST /sessions` and `POST /sessions/instant` → **prepaid** (deduct from wallet balance)
- `POST /sessions/from-listing` → **escrow** (on-chain, tied to a specific order)

**Where:**
- `services/control-api/internal/api/session.go`
- `services/control-api/internal/api/orders.go`
- `services/control-api/internal/billing/worker.go`
- New migration: `migrations/000040_session_billing_model.up.sql`

**How:**

Step 1 — New migration:
```sql
-- migrations/000040_session_billing_model.up.sql
ALTER TABLE sessions
    ADD COLUMN billing_model VARCHAR(20) NOT NULL DEFAULT 'prepaid'
        CHECK (billing_model IN ('prepaid', 'escrow')),
    ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_order_id ON sessions(order_id) WHERE order_id IS NOT NULL;
```

Step 2 — Set billing_model in session creation handlers (`session.go`):
```go
// POST /sessions and /sessions/instant:
session.BillingModel = "prepaid"
session.OrderID = nil

// POST /sessions/from-listing:
session.BillingModel = "escrow"
session.OrderID = &order.ID  // Must create/reference order first
```

Step 3 — Settlement routes in `billing/worker.go`:
```go
func (w *SettlementWorker) settleSessionUsage(session *models.Session, bytes int64) error {
    switch session.BillingModel {
    case "prepaid":
        return w.deductFromWallet(session, bytes)
    case "escrow":
        return w.releaseFromEscrow(session, bytes)
    default:
        return fmt.Errorf("unknown billing_model: %s", session.BillingModel)
    }
}
```

Step 4 — Document in new file `services/control-api/BILLING_MODEL.md`:
```markdown
# Billing Model

## Prepaid (wallet balance)
Used for: POST /sessions, POST /sessions/instant
- Consumer must have SOL balance before session starts
- Bandwidth cost deducted hourly from wallet.balance_sol
- No blockchain transaction per session (faster, lower overhead)
- Best for: exploratory use, low-volume consumers

## Escrow (on-chain)
Used for: POST /sessions/from-listing
- Consumer initiates Solana escrow tx before session starts
- Funds locked in on-chain PDA for the order amount
- Released to provider after session confirms delivery
- Best for: large orders, high-value transactions, dispute protection
```

**Done when:**
- [ ] `billing_model` column in sessions table
- [ ] Session creation sets correct billing_model
- [ ] Settlement worker routes correctly based on billing_model
- [ ] `BILLING_MODEL.md` committed
- [ ] Test: prepaid session → wallet debited → escrow untouched
- [ ] Test: escrow session → escrow released → wallet untouched

---

## P2.2 — Provider Pending Earnings Visible in Wallet

**What:** Provider's `wallet.balance_sol` doesn't include pending earnings (only paid amounts). Dashboard shows $0 even with significant pending SOL.

**Why:** Providers lose trust in the platform when they see no balance despite active earnings.

**Where:**
- `services/control-api/internal/api/wallet.go` — GET /wallet response
- `apps/web/src/lib/api/wallet.ts` — wallet type
- `apps/web/src/app/dashboard/wallet/page.tsx` — wallet display

**How:**

Step 1 — Add `pending_earnings_sol` to wallet GET response in `wallet.go`:
```go
type WalletResponse struct {
    ID                  string                `json:"id"`
    BalanceSOL          float64               `json:"balance_sol"`
    PendingEarningsSOL  float64               `json:"pending_earnings_sol"`
    TotalAvailableSOL   float64               `json:"total_available_sol"`
    SpendingLimits      SpendingLimitsInfo    `json:"spending_limits"`
    RecentTransactions  []LedgerEntryResponse `json:"recent_transactions"`
}

// In handler:
var pendingSOL float64
db.Model(&models.ProviderEarning{}).
    Where("provider_user_id = ? AND status = 'pending'", userID).
    Select("COALESCE(SUM(net_amount_sol), 0)").
    Scan(&pendingSOL)

resp.PendingEarningsSOL = pendingSOL
resp.TotalAvailableSOL = wallet.BalanceSOL + pendingSOL
```

Step 2 — Update `apps/web/src/lib/api/wallet.ts`:
```typescript
export interface Wallet {
    id: string;
    balance_sol: number;
    pending_earnings_sol: number;
    total_available_sol: number;
    spending_limits?: SpendingLimits;
    recent_transactions?: WalletTransaction[];
    created_at: string;
}
```

Step 3 — Update wallet dashboard to show a breakdown:
```
Balance:          0.125 SOL  (available now)
Pending Earnings: 0.047 SOL  (processing, paid out in next batch)
─────────────────────────────
Total:            0.172 SOL
```

**Done when:**
- [ ] GET /wallet returns `pending_earnings_sol` and `total_available_sol`
- [ ] Frontend wallet page shows the breakdown
- [ ] Test: record provider earning (status: pending) → GET /wallet → pending_earnings_sol increases
- [ ] Test: after payout runs → pending_earnings_sol = 0, balance_sol increases by payout amount

---

## P2.3 — Remove Dead Code

**What:** `swap.go` is functionally empty. KYC files deleted without removing all references. Dead code creates confusion.

**Where:**
- `services/control-api/internal/api/swap.go` — delete
- Any remaining KYC references in other .go files

**How:**

Step 1 — Delete swap.go:
```bash
rm services/control-api/internal/api/swap.go
```

Step 2 — Scan for KYC references:
```bash
grep -r --include="*.go" -i "kyc\|KycHandler\|KycModel" services/control-api/
```

Step 3 — Remove any remaining KYC imports, route registrations, or type references.

Step 4 — Verify build:
```bash
cd services/control-api && go build ./...
```

Step 5 — Remove swap route registration from `main.go` if it exists.

**Done when:**
- [ ] `swap.go` deleted
- [ ] All KYC references removed
- [ ] `go build ./...` passes with zero errors
- [ ] `go vet ./...` passes

---

## P2.4 — Document DB Split Architecture

**What:** No documentation on PostgreSQL vs Supabase boundary. Developers write cross-DB JOINs that silently fail.

**Where:**
- New: `services/control-api/DATABASE_ARCHITECTURE.md`

**How:**

Create `DATABASE_ARCHITECTURE.md` with:
1. What lives in Primary PostgreSQL (financial, operational)
2. What lives in Supabase (auth, social)
3. Why the split exists
4. How to handle cross-DB data needs (application-layer merge pattern)
5. Rules: "new financial data → Postgres | new social data → Supabase"
6. Examples of correct and incorrect query patterns

**Done when:**
- [ ] `DATABASE_ARCHITECTURE.md` exists and is accurate
- [ ] Referenced from main README
- [ ] Peer-reviewed by at least one other developer

---

## P2.5 — Fix Governance Worker Goroutine Leak

**What:** `ScheduleProposalWorker()` runs a goroutine with no context, no shutdown mechanism, and no ticker cleanup.

**Where:**
- `services/control-api/internal/api/governance.go`
- `services/control-api/main.go`

**How:**

Step 1 — Update `ScheduleProposalWorker` signature:
```go
func ScheduleProposalWorker(ctx context.Context, db *gorm.DB) {
    go func() {
        ticker := time.NewTicker(1 * time.Hour) // or whatever interval
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                log.Info("GovernanceWorker: shutting down cleanly")
                return
            case <-ticker.C:
                processExpiredProposals(db)
            }
        }
    }()
}
```

Step 2 — In `main.go`, pass shutdown context and handle SIGTERM:
```go
ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
defer cancel()

api.ScheduleProposalWorker(ctx, db)

// Server runs until SIGTERM
srv.ListenAndServe()
cancel() // trigger graceful shutdown of all workers
```

**Done when:**
- [ ] Worker accepts and respects context cancellation
- [ ] Ticker properly stopped on shutdown
- [ ] `main.go` passes shutdown context
- [ ] Test: send SIGINT → worker goroutine exits within 5s → no goroutine leak

---

# PHASE 3 — Observability & Operations

---

## P3.1 — Improve Admin Account Security

**What:** 3 hardcoded admin accounts in env vars. No per-account audit trail, no MFA, shared JWT secret.

**Where:**
- `services/control-api/internal/api/admin_auth.go`
- New migration: `migrations/000041_admin_accounts.up.sql`
- `services/control-api/go.mod` — add TOTP library

**How:**

Step 1 — New migration:
```sql
-- migrations/000041_admin_accounts.up.sql
CREATE TABLE admin_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'admin'
        CHECK (role IN ('admin', 'super_admin', 'support', 'finance')),
    mfa_secret_encrypted VARCHAR(512),
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES admin_accounts(id),
    admin_username VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    target_type VARCHAR(64),
    target_id VARCHAR(255),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_admin_id ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_created_at ON admin_audit_log(created_at);
```

Step 2 — Add TOTP support:
```bash
go get github.com/pquerna/otp
```

Step 3 — Update admin login flow in `admin_auth.go`:
```go
// POST /v1/admin/auth/login:
// 1. Find admin account by username
// 2. Verify password with Argon2id
// 3. If mfa_enabled: require totp_code field, verify with pquerna/otp
// 4. Issue JWT signed with ADMIN_JWT_SECRET (8h expiry)
// 5. Log to admin_audit_log: action="login", ip=clientIP
```

Step 4 — Every admin action writes to `admin_audit_log`:
```go
func logAdminAction(adminID, action, targetType, targetID string, details map[string]interface{}, c *gin.Context) {
    db.Create(&AdminAuditEntry{
        AdminID:      adminID,
        AdminUsername: getAdminUsername(adminID),
        Action:       action,
        TargetType:   targetType,
        TargetID:     targetID,
        Details:      details,
        IPAddress:    c.ClientIP(),
        UserAgent:    c.GetHeader("User-Agent"),
    })
}
```

Step 5 — Seed from env vars on first deploy (migration), then env-var auth becomes fallback-only.

**Done when:**
- [ ] Admin accounts stored in DB with Argon2id hashes
- [ ] TOTP MFA works (generate QR code via `POST /v1/admin/accounts/:id/mfa/setup`)
- [ ] Every admin action creates `admin_audit_log` entry
- [ ] Per-account audit log visible at `GET /v1/admin/audit?admin_id=xxx`
- [ ] Test: login without MFA when mfa_enabled=true → 401
- [ ] Test: login with correct TOTP → 200 + JWT
- [ ] Test: perform admin action → admin_audit_log entry created with correct admin_id and IP

---

## P3.2 — Verify and Expose OpenAPI Spec

**What:** `docs/docs.go` exists (swaggo-generated) but Swagger UI may not be accessible. Need to confirm spec is current and exposed.

**Where:**
- `services/control-api/main.go`
- `services/control-api/docs/`

**How:**

Step 1 — Regenerate docs to ensure current:
```bash
cd services/control-api
go install github.com/swaggo/swag/cmd/swag@latest
swag init -g main.go --output docs --parseInternal
```

Step 2 — Ensure Swagger route in `main.go`:
```go
import (
    swaggerFiles "github.com/swaggo/files"
    ginSwagger    "github.com/swaggo/gin-swagger"
    _ "github.com/proxyhubb/control-api/docs" // import generated docs
)

// In route setup:
if os.Getenv("ENABLE_SWAGGER") == "true" || os.Getenv("APP_ENV") == "development" {
    r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
    log.Info("Swagger UI enabled at /swagger/index.html")
}

// Always expose raw spec (safe - no sensitive data in spec):
r.GET("/v1/openapi.json", func(c *gin.Context) {
    c.File("./docs/swagger.json")
})
```

Step 3 — Set `ENABLE_SWAGGER=true` in `docker-compose.dev.yml`.

Step 4 — Add `@Summary`, `@Description`, `@Router`, `@Param`, `@Success`, `@Failure` annotations to any endpoints missing them. Focus on: session, wallet, orders, provider endpoints.

**Done when:**
- [ ] `swag init` runs without errors
- [ ] Swagger UI at `http://localhost:8080/swagger/index.html` shows all endpoints in dev
- [ ] `GET /v1/openapi.json` returns valid OpenAPI 3.0 JSON
- [ ] All 60+ endpoints have at minimum `@Summary` and `@Router`
- [ ] Add `swag init` step to CI pipeline to catch annotation gaps

---

## P3.3 — Real-Time Provider Earnings WebSocket

**What:** Providers have no real-time feedback when they earn SOL from active sessions.

**Why:** Real-time earnings display increases provider engagement and reduces support tickets ("am I earning?").

**Where:**
- `services/control-api/internal/billing/worker.go` — publish earning event after settlement
- `services/control-api/internal/ws/hub.go` — user-targeted broadcast
- `apps/web/src/lib/hooks/` — new `useProviderEarnings.ts` hook
- `apps/web/src/app/dashboard/provider/earnings/page.tsx` — earnings display

**How:**

Step 1 — After recording provider earning in `billing/worker.go`, push to WS:
```go
// After successful earning creation:
hub.BroadcastToUser(earning.ProviderUserID, ws.Message{
    Type: "earning",
    Data: map[string]interface{}{
        "session_id":    earning.SessionID,
        "net_sol":       earning.NetAmountSOL,
        "gross_sol":     earning.GrossAmountSOL,
        "bandwidth_gb":  earning.BandwidthGB,
        "node_id":       earning.NodeID,
        "earned_at":     time.Now().UTC(),
    },
})
```

Step 2 — Verify `hub.BroadcastToUser` routes to the correct user's WS connection.

Step 3 — Create `apps/web/src/lib/hooks/useProviderEarnings.ts`:
```typescript
export function useProviderEarnings() {
    const [todayEarnings, setTodayEarnings] = useState(0);
    const [recentEarnings, setRecentEarnings] = useState<EarningEvent[]>([]);

    useEffect(() => {
        const ws = new WebSocket(`${WS_URL}/v1/ws`);
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'earning') {
                setTodayEarnings(prev => prev + msg.data.net_sol);
                setRecentEarnings(prev => [msg.data, ...prev].slice(0, 20));
            }
        };
        return () => ws.close();
    }, []);

    return { todayEarnings, recentEarnings };
}
```

Step 4 — Add live earnings counter to provider earnings page using the hook.

**Done when:**
- [ ] Earning events published to WS hub after each settlement
- [ ] WS hub routes events to the specific provider's connection
- [ ] Frontend hook receives earning events
- [ ] Dashboard "Today's Earnings" counter updates live without page refresh
- [ ] Test: create session → consume 1GB → terminate → provider dashboard updates within settlement cycle

---

# PHASE 4 — Product Enhancements

---

## P4.1 — Consumer Billing Cost Preview

**What:** Consumers create sessions without knowing the SOL cost upfront.

**Why:** Surprise billing reduces trust and increases wallet top-up friction.

**Where:**
- New endpoint in `services/control-api/internal/api/session.go`
- `apps/web/src/app/dashboard/` — session creation flow

**How:**

Step 1 — Add cost estimate endpoint:
```go
// GET /v1/sessions/cost-estimate?bandwidth_gb=10&listing_id=xxx&session_type=rotating
type CostEstimateResponse struct {
    BandwidthGB      float64 `json:"bandwidth_gb"`
    PricePerGBSOL    float64 `json:"price_per_gb_sol"`
    EstimatedSOL     float64 `json:"estimated_sol"`
    EstimatedUSD     float64 `json:"estimated_usd"`
    CurrentSOLPrice  float64 `json:"current_sol_price_usd"`
    WalletBalanceSOL float64 `json:"wallet_balance_sol"`
    CanAfford        bool    `json:"can_afford"`
    ShortfallSOL     float64 `json:"shortfall_sol,omitempty"` // > 0 if can't afford
}
```

Step 2 — In session creation modal/form, call this endpoint on bandwidth input change (debounced 500ms), show the cost estimate before the user clicks "Create Session".

**Done when:**
- [ ] `GET /v1/sessions/cost-estimate` returns accurate calculation
- [ ] Frontend shows estimate in session creation flow
- [ ] "Insufficient balance" warning shown with shortfall amount
- [ ] Test: 10 GB at $0.05/GB at $200/SOL → estimate = 0.0025 SOL

---

## P4.2 — Trust Tier Auto-Promotion

**What:** Users stuck on `new` tier indefinitely unless manually promoted by admin.

**Where:**
- `services/control-api/internal/worker/tier_evaluator.go` — already exists, check current state
- `services/control-api/internal/models/user.go` — TrustTier constants

**How:**

Step 1 — Read current `tier_evaluator.go` to understand what's already implemented.

Step 2 — Implement or complete promotion rules:
```go
// new → verified criteria:
// - Account age >= 7 days
// - >= 1 GB total bandwidth successfully used
// - Wallet linked (Solana address)
// - No active fraud flags or account suspensions
//
// verified → premium criteria:
// - Account age >= 30 days
// - >= 50 GB total bandwidth used
// - No disputes raised as buyer in the last 90 days
// - Payment success rate >= 95%

func (e *TierEvaluator) EvaluateUser(userID string) {
    profile := getProfile(userID)
    currentTier := profile.TrustTier

    newTier := e.calculateEligibleTier(profile, usage)
    if newTier != currentTier {
        db.Model(&profile).Update("trust_tier", newTier)
        notifyUser(userID, "Your trust tier has been upgraded to: " + newTier)
        logTierChange(userID, currentTier, newTier)
    }
}
```

Step 3 — Schedule via pg_cron (already enabled via migration 000037):
```sql
SELECT cron.schedule('tier-evaluation', '0 2 * * *', -- daily at 2am UTC
    $$SELECT evaluate_user_tiers()$$);
```

**Done when:**
- [ ] Promotion criteria implemented and tested
- [ ] Tier evaluator runs daily
- [ ] Users notified on tier change via notifications system
- [ ] Test: simulate 7-day account + 1GB usage + linked wallet → tier promoted to verified

---

## P4.3 — Node Auto-Suspend on Low Quality

**What:** Nodes with quality_score < 40 for 24h remain active and degrade consumer experience.

**Where:**
- `services/control-api/internal/worker/heartbeat_monitor.go` — already exists
- New migration: `migrations/000042_node_quality_tracking.up.sql`

**How:**

Step 1 — Migration:
```sql
-- migrations/000042_node_quality_tracking.up.sql
ALTER TABLE provider_nodes
    ADD COLUMN low_quality_since TIMESTAMPTZ,
    ADD COLUMN auto_suspended BOOLEAN NOT NULL DEFAULT false;
```

Step 2 — In `heartbeat_monitor.go`, after quality score recalculation:
```go
const (
    LowQualityThreshold = 40.0
    LowQualityDuration  = 24 * time.Hour
    RecoveryThreshold   = 60.0
)

func (m *HeartbeatMonitor) evaluateNodeQuality(node *models.ProviderNode) {
    if node.QualityScore < LowQualityThreshold {
        if node.LowQualitySince == nil {
            // First time below threshold — start timer
            now := time.Now()
            db.Model(node).Update("low_quality_since", now)
        } else if time.Since(*node.LowQualitySince) > LowQualityDuration {
            // Below threshold for too long — auto-suspend
            db.Model(node).Updates(map[string]interface{}{
                "status":         "suspended",
                "auto_suspended": true,
            })
            // Deactivate associated listing
            db.Model(&models.ProxyListing{}).
                Where("node_id = ?", node.ID).
                Update("is_active", false)
            // Notify provider with specific reason
            notifyProvider(node.ProviderUserID,
                fmt.Sprintf("Node %s auto-suspended: quality score %.1f below minimum for 24h. "+
                    "Improve latency/uptime and contact support to reactivate.", node.Name, node.QualityScore))
        }
    } else if node.QualityScore >= RecoveryThreshold && node.LowQualitySince != nil {
        // Recovered — clear low quality timer
        db.Model(node).Updates(map[string]interface{}{
            "low_quality_since": nil,
        })
        // Note: don't auto-reactivate suspended nodes — require manual provider action
    }
}
```

Step 3 — Add reactivation endpoint:
```go
// POST /provider/nodes/:id/reactivate
// - Check node quality score >= 60
// - If auto_suspended and quality recovered → allow reactivation
// - Clear auto_suspended flag, set status=offline (not online — needs new heartbeat)
```

**Done when:**
- [ ] `low_quality_since` tracks when score first dropped below 40
- [ ] Node auto-suspended after 24h below threshold
- [ ] Provider notified with reason
- [ ] Provider can request reactivation once quality improves
- [ ] Test: node quality_score = 35 → 24h passes → node status = suspended, listing deactivated

---

## P4.4 — Document Agent System

**What:** `agents.go`, `agent_registry.go` exist but the system is undocumented. Other developers don't know what agents are or how to use the API.

**Where:**
- `services/control-api/internal/api/agents.go` — read fully, extract design
- New: `services/control-api/AGENTS_SYSTEM.md`

**How:**

Step 1 — Read `agents.go` and `agent_registry.go` fully to understand:
- What is an "agent" in this context?
- How are agents registered, listed, and rented?
- How does job execution work?
- How does billing for agent usage work?

Step 2 — Write `AGENTS_SYSTEM.md` documenting the full lifecycle.

Step 3 — Add Swagger `@Summary` / `@Router` annotations to all agent endpoints.

Step 4 — Ensure `apps/web/src/app/agents/page.tsx` matches the documented API.

**Done when:**
- [ ] `AGENTS_SYSTEM.md` documents agent creation, rental, job execution, and billing
- [ ] All agent endpoints have Swagger annotations
- [ ] Frontend agents page is consistent with the documented API

---

# Implementation Schedule

```
Week 1 (Security)
  Mon–Tue:  P0.1 — Provider token hashing (Argon2id)
  Wed:      P0.2 — Session credential startup enforcement
  Thu–Fri:  P0.3 interim — Oracle velocity limits + freeze + key rotation runbook

Week 2 (Financial Integrity — Part 1)
  Mon:      P1.1 — Redis AOF persistence (config change + startup reconciliation)
  Tue:      P1.2 — SOL price feed fix (layered fallback + sanity check)
  Wed–Thu:  P1.4 — Alert channels (Slack/email) + reconciliation wiring
  Fri:      P2.3 — Dead code removal (swap.go, KYC remnants)
            P2.4 — Database architecture documentation

Week 3 (Financial Integrity — Part 2)
  Mon–Tue:  P1.3 — NATS JetStream DLQ setup
  Wed–Thu:  P2.1 — Session billing_model clarification + migration
  Fri:      P2.5 — Governance worker context fix

Week 4 (Architecture + Visibility)
  Mon:      P2.2 — Provider pending earnings in wallet dashboard
  Tue:      P3.2 — Swagger/OpenAPI verify + expose
  Wed–Thu:  P3.3 — Real-time earnings WebSocket
  Fri:      P4.4 — Agent system documentation

Week 5 (Operations)
  Mon–Wed:  P3.1 — Admin accounts (DB-backed, Argon2id, TOTP MFA, per-account audit)
  Thu:      P4.1 — Consumer billing cost preview
  Fri:      P4.3 — Node auto-suspend on low quality

Week 6 (Product)
  Mon–Tue:  P4.2 — Trust tier auto-promotion
  Wed–Thu:  P0.3 full — Multi-sig oracle coordination via NATS
  Fri:      Regression testing + QA pass

Week 7–8 (Buffer + Mainnet Prep)
  - Full P0 audit (all security items re-verified)
  - Load testing with AOF Redis
  - Oracle key rotation dry run on devnet
  - Final P1 reconciliation test with real SOL on devnet
```

---

# Acceptance Tests Summary

## P0 (Security Gate — must pass before mainnet)
- [ ] `curl POST /v1/provider/tokens` → token_hash in DB starts with `$argon2id$`
- [ ] Start server with 1 plaintext session credential → server refuses to start with clear error
- [ ] Transfer 60 SOL via oracle → blocked by velocity limit, alert in Slack
- [ ] Stop all transfers via ORACLE_TRANSFER_FREEZE=true → all `SendSOL` return error immediately

## P1 (Financial Gate — must pass before scale)
- [ ] Stop Redis → restart → billing keys present (AOF worked)
- [ ] Kill CoinGecko + CoinMarketCap mocks → cached price used → no billing error
- [ ] Kill CoinGecko + CMC + clear Redis price cache → EMERGENCY_SOL_PRICE_USD used → critical alert fires
- [ ] Publish billing NATS event → kill consumer → restart → event processed once (not twice, not zero)

## P2 (Architecture)
- [ ] `go build ./...` passes after dead code removal
- [ ] Prepaid session → inspect wallet_ledger_entries → usage entry exists, escrow untouched
- [ ] GET /wallet as provider with pending earnings → `pending_earnings_sol > 0`

## P3 (Operations)
- [ ] Admin login with MFA enabled but no TOTP code → 401
- [ ] Admin login with valid TOTP → 200, JWT returned
- [ ] Any admin action → `admin_audit_log` row created with correct `admin_id` and `ip_address`
- [ ] GET /v1/openapi.json → valid OpenAPI 3.0 document with all major endpoint groups

## P4 (Product)
- [ ] GET /v1/sessions/cost-estimate?bandwidth_gb=10 → returns estimated_sol matching manual math
- [ ] User with 7-day-old account + 1GB usage + linked wallet → tier_evaluator promotes to `verified`
- [ ] Node quality_score = 30 for 25 hours → status = suspended, provider notification created

---

# Files Reference Map

| Item | Files to Modify / Create |
|---|---|
| P0.1 Token hashing | `api/provider_token.go`, `go.mod`, `migrations/000038_*` |
| P0.2 Credential check | `main.go`, `migrations/000039_*` |
| P0.3 Oracle interim | `solana/client.go`, new `solana/keypair_monitor.go`, `ORACLE_KEY_ROTATION.md` |
| P0.3 Oracle multi-sig | `solana/client.go`, NATS coordination |
| P1.1 Redis AOF | `docker-compose.yml`, `docker-compose.prod.yml`, `billing/worker.go` |
| P1.2 Price fallback | `billing/price.go`, `.env.example` |
| P1.3 NATS DLQ | `main.go` (JetStream setup), new `events/dlq.go`, admin routes |
| P1.4 Alert escalation | new `alerts/channels.go`, `treasury/reconciliation.go`, `.env.example` |
| P2.1 Billing model | `api/session.go`, `billing/worker.go`, `migrations/000040_*`, `BILLING_MODEL.md` |
| P2.2 Pending earnings | `api/wallet.go`, `apps/web/src/lib/api/wallet.ts`, wallet page |
| P2.3 Dead code | delete `api/swap.go`, remove KYC refs |
| P2.4 DB docs | new `DATABASE_ARCHITECTURE.md` |
| P2.5 Governance worker | `api/governance.go`, `main.go` |
| P3.1 Admin security | `api/admin_auth.go`, new `migrations/000041_*` |
| P3.2 Swagger | `main.go`, `docs/` refresh, annotation pass |
| P3.3 RT earnings | `billing/worker.go`, `ws/hub.go`, new `hooks/useProviderEarnings.ts` |
| P4.1 Cost estimate | `api/session.go` (new endpoint), frontend session form |
| P4.2 Tier promotion | `worker/tier_evaluator.go` |
| P4.3 Node auto-suspend | `worker/heartbeat_monitor.go`, `migrations/000042_*` |
| P4.4 Agent docs | read `api/agents.go`, new `AGENTS_SYSTEM.md` |
