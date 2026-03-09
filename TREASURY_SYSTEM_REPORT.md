# ProxyHubb Treasury System - Comprehensive Report

**Date:** March 9, 2026  
**Classification:** Internal Technical Documentation  
**Network:** Solana DevNet  

---

## 1. Executive Summary

The ProxyHubb Treasury System is a multi-layered financial infrastructure designed to manage platform funds securely. It handles user deposits, provider payouts, escrow settlements, and serves as the central financial hub for the decentralized proxy marketplace.

### Key Metrics
| Metric | Value |
|--------|-------|
| Treasury Address | `8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4` |
| Network | Solana DevNet |
| Minimum SOL Balance | 5 SOL |
| Target SOL Balance | 10 SOL |
| Minimum Stablecoin Balance | $100 USDC/USDT |
| Max Hourly Outflow | 100 SOL/hour |

---

## 2. Treasury Wallet Address

### Primary Treasury Address
```
8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4
```

### Keypair Storage
- **File:** `treasury-keypair.json` (Project Root)
- **Format:** Solana standard keypair (64-byte secret key)
- **Security:** Never commit to version control (in `.gitignore`)

### Environment Variables
```bash
# Required
SOLANA_TREASURY_ADDRESS=8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4
NEXT_PUBLIC_SOLANA_TREASURY=8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4

# For verification
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_NETWORK=devnet
```

### DevNet Funding
To fund the treasury on DevNet:
```bash
solana airdrop 2 8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4 --url devnet
```

Or use the faucet: https://faucet.solana.com

---

## 3. Treasury System Architecture

### 3.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER DEPOSITS                                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │    SOL      │    │    USDT     │    │    USDC     │                  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      TREASURY WALLET                                     │
│           8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4                  │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   SOL Balance   │  │  USDT Balance   │  │  USDC Balance   │         │
│  │   (Minimum 5)   │  │  (Minimum $100) │  │  (Minimum $100) │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
└───────────┼────────────────────┼────────────────────┼──────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    TREASURY MANAGEMENT MODULE                            │
│                                                                          │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │
│  │   Liquidity   │  │   Watchtower  │  │    Ghost      │               │
│  │    Manager    │  │   Monitoring  │  │    Prober     │               │
│  └───────────────┘  └───────────────┘  └───────────────┘               │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      OUTFLOW OPERATIONS                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │   Escrow    │    │   Provider  │    │   Refunds   │                  │
│  │  Settlements│    │   Payouts   │    │   (Disputes)│                  │
│  └─────────────┘    └─────────────┘    └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Core Components

#### 3.2.1 Liquidity Manager
**Location:** `services/control-api/internal/treasury/liquidity_manager.go`

**Responsibilities:**
- Monitor SOL and stablecoin balances
- Alert on low liquidity conditions
- Automated balance threshold checking
- Future: Automated yield generation integration

**Key Thresholds:**
```go
const (
    MinSOLLamports    uint64 = 5 * 1_000_000_000   // 5 SOL
    TargetSOLLamports uint64 = 10 * 1_000_000_000  // 10 SOL
    MinStableBalance  uint64 = 100 * 1_000_000     // $100
)
```

**Supported Tokens:**
| Token | Mint Address | Decimals | Status |
|-------|--------------|----------|--------|
| SOL (Native) | - | 9 | ✅ Active |
| WSOL | `So11111111111111111111111111111111111111112` | 9 | ✅ Active |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 | ✅ Active |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 | ✅ Active |

**Operations:**
```go
// CheckBalances verifies SOL liquidity
func (lm *LiquidityManager) CheckBalances(ctx context.Context) error

// CheckTokenLiquidity verifies stablecoin balances
func (lm *LiquidityManager) CheckTokenLiquidity(ctx context.Context) error

// YieldGenerationHook placeholder for future DeFi integration
func (lm *LiquidityManager) YieldGenerationHook(ctx context.Context)
```

#### 3.2.2 Watchtower
**Location:** `services/control-api/internal/treasury/watchtower.go`

**Purpose:** Security monitoring and anomaly detection for treasury outflows.

**Features:**
- **Velocity Monitoring:** Tracks hourly outflow rates
- **Emergency Pause:** Automatic circuit breaker on suspicious activity
- **Alert System:** Real-time notifications via NATS

**Velocity Thresholds:**
```go
const (
    MaxHourlySOLOutflow = 100.0  // SOL per hour
    LargeOutflowWarning = 50.0   // SOL single transaction
)
```

**Alert Types:**
| Alert | Trigger | Severity | Action |
|-------|---------|----------|--------|
| Velocity Spike | >100 SOL/hour | CRITICAL | Auto-pause |
| Large Outflow | >50 SOL/tx | WARNING | Alert only |
| Node Offline | Provider disconnect | WARNING | Alert only |
| Economic Risk | High-value operation | CRITICAL | Alert only |
| Security Anomaly | Unauthorized action | CRITICAL | Alert only |

**Redis Keys:**
```
system:emergency_pause_active    # Boolean - system pause state
treasury:outflow:hourly:{hour}   # Counter - hourly outflow tracking
```

#### 3.2.3 Ghost Prober
**Location:** `services/control-api/internal/treasury/probe.go`

**Purpose:** Passive monitoring of provider node health by attempting proxy connections.

**Operation:**
- Selects 5 random online nodes every interval
- Attempts HTTP health check to `:8080/health`
- Records latency and success/failure
- Triggers alerts on probe failures

---

## 4. Financial Flows

### 4.1 Deposit Flow

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  User   │────▶│   Create    │────▶│   Sign &    │────▶│   Submit    │
│         │     │   Deposit   │     │   Broadcast │     │   to Chain  │
└─────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                               │
                                                               ▼
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Credit │◀────│   Update    │◀────│   Verify    │◀────│   Treasury  │
│  Wallet │     │   Ledger    │     │   On-Chain  │     │   Receives  │
└─────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

**API Endpoint:**
```http
POST /crypto/deposit/verify
{
  "tx_hash": "5UfgJ6...",
  "chain": "solana",
  "amount": 1.5
}
```

**Verification Steps:**
1. Transaction exists on-chain
2. Transaction successful (no errors)
3. Amount credited to treasury address
4. Double-spend check (tx_hash uniqueness)
5. Credit user's internal wallet

### 4.2 Settlement Flow

```
┌──────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Escrow  │────▶│   Calculate │────▶│  Collect    │────▶│   Execute   │
│  Closed  │     │   Payout    │     │  Multi-Sig  │     │   Transfer  │
└──────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                │
                    ┌─────────────┐     ┌─────────────┐         │
                    │   Buyer     │◀────│  Proportional│◀────────┘
                    │   Refund    │     │   Split      │
                    └─────────────┘     └─────────────┘
                                                                │
                    ┌─────────────┐     ┌─────────────┐         │
                    │   Seller    │◀────│   Platform   │◀────────┘
                    │   Payout    │     │   Fee (2%)   │
                    └─────────────┘     └─────────────┘
```

**Proportional Settlement Formula:**
```go
sellerPayout = (totalAmount * bandwidthUsed) / bandwidthLimit
buyerRefund  = totalAmount - sellerPayout - platformFee
platformFee  = totalAmount * 0.02  // 2% platform fee
```

**Example:**
- Escrow: 1 SOL for 10 GB
- Actual usage: 6 GB
- Seller receives: 0.6 SOL
- Buyer refund: 0.4 SOL
- Platform fee (2%): 0.02 SOL

### 4.3 Payout Flow

```
┌──────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Provider │────▶│   Request   │────▶│   Verify    │────▶│   Check     │
│          │     │  Withdrawal │     │   Staking   │     │   Treasury  │
└──────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                │
┌──────────┐     ┌─────────────┐     ┌─────────────┐            │
│  Earnings│◀────│   Update    │◀────│   Submit    │◀───────────┘
│  Sent    │     │   Ledger    │     │   On-Chain  │
└──────────┘     └─────────────┘     └─────────────┘
```

---

## 5. API Endpoints

### 5.1 Treasury Information

```http
GET /crypto/treasury
```

**Response:**
```json
{
  "treasury_address": "8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4",
  "chain": "solana",
  "network": "devnet"
}
```

### 5.2 Deposit Verification

```http
POST /crypto/deposit/verify
Content-Type: application/json

{
  "tx_hash": "5UfgJ6zPXK...",
  "chain": "solana",
  "amount": 1.5
}
```

**Response:**
```json
{
  "success": true,
  "amount": 1.5,
  "currency": "SOL",
  "new_balance": 5.5
}
```

### 5.3 Emergency Operations

```http
POST /crypto/emergency-pause
Authorization: Bearer {admin_token}

{
  "reason": "Suspicious activity detected"
}
```

```http
POST /crypto/emergency-resume
Authorization: Bearer {admin_token}

{
  "reason": "Issue resolved"
}
```

---

## 6. Security Measures

### 6.1 Multi-Signature Requirements

**Current:** Single oracle key (DevNet)  
**Planned:** 3-of-5 threshold signatures (MainNet)

```go
type MultiSigOracle struct {
    Signers      []sol.PublicKey  // 5 oracle operators
    Threshold    uint8            // 3 signatures required
    ExecutedTxs  map[string]bool  // Replay protection
}
```

### 6.2 Emergency Circuit Breaker

**Activation Conditions:**
- Hourly outflow exceeds 100 SOL
- Unauthorized settlement attempt
- Admin manual trigger

**Effect:**
- All escrow settlements paused
- Only admin can resume
- Multi-sig required for resumption on MainNet

### 6.3 Access Control

| Operation | Required Role | Additional Requirements |
|-----------|---------------|------------------------|
| View Treasury | Public | None |
| Deposit Verify | Authenticated | Valid transaction |
| Settlement | Oracle | Multi-sig (planned) |
| Emergency Pause | Admin | Authenticated |
| Emergency Resume | Admin | Multi-sig (planned) |
| Withdraw | System | Sufficient treasury balance |

---

## 7. Monitoring & Alerts

### 7.1 Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| SOL Balance | ≥10 SOL | <5 SOL (Critical) |
| USDC Balance | ≥$500 | <$100 (Warning) |
| USDT Balance | ≥$500 | <$100 (Warning) |
| Hourly Outflow | <50 SOL | >100 SOL (Critical) |
| Failed Settlements | 0% | >1% (Warning) |

### 7.2 Alert Channels

- **NATS:** `proxy.telemetry.v1.alerts`
- **Severity Levels:** INFO, WARNING, CRITICAL
- **Slack/Email:** Via external integrations

### 7.3 Dashboard

Access treasury metrics at:
```
GET /monitoring/treasury
```

Displays:
- Current balances
- 24-hour inflow/outflow
- Pending settlements
- Alert history

---

## 8. Code References

### 8.1 Core Files

| Component | Path | Purpose |
|-----------|------|---------|
| Liquidity Manager | `services/control-api/internal/treasury/liquidity_manager.go` | Balance monitoring |
| Watchtower | `services/control-api/internal/treasury/watchtower.go` | Security monitoring |
| Ghost Prober | `services/control-api/internal/treasury/probe.go` | Node health checks |
| Treasury API | `services/control-api/internal/api/crypto.go` | HTTP endpoints |
| Solana Client | `services/control-api/internal/solana/client.go` | Blockchain interaction |
| Verification | `services/control-api/internal/solana/verify.go` | Transaction verification |

### 8.2 Key Functions

```go
// Get treasury address
solana.GetTreasuryAddress() string

// Verify deposit transaction
solana.VerifyTransaction(ctx, txHash) (*TransactionResult, error)

// Verify transfer amount
solana.VerifyTransferAmount(tx, recipient, expectedLamports) (bool, float64, error)

// Record outflow (for velocity tracking)
watchtower.RecordOutflow(ctx, amountSOL) error

// Check system pause status
watchtower.IsPaused(ctx) (bool, error)
```

---

## 9. Testing

### 9.1 Test Deposit Script

**File:** `apps/web/create-deposit-tx.js`

Creates a test deposit transaction for verification:
```bash
node apps/web/create-deposit-tx.js
```

### 9.2 Treasury Generation

**File:** `apps/web/generate-treasury.js`

Generates a new treasury keypair:
```bash
node apps/web/generate-treasury.js
```

### 9.3 Load Testing

**File:** `testing/load_test.js`

Tests treasury operations under load:
```bash
node testing/load_test.js
```

---

## 10. Future Enhancements

### 10.1 Planned Features

| Feature | Status | ETA |
|---------|--------|-----|
| Multi-sig Oracle | In Progress | Week 2 |
| Automated Yield | Planned | Month 2 |
| Insurance Pool | Planned | Month 2 |
| Cross-chain Bridge | Planned | Month 4 |
| DAO Governance | Planned | Month 3 |

### 10.2 Yield Generation

Future integration with Solana DeFi protocols:
- **Kamino:** Automated vault strategies
- **Solend:** Lending/borrowing
- **Marinade:** Liquid staking

---

## 11. Troubleshooting

### 11.1 Common Issues

**Issue:** Treasury not configured error
```
Solution: Set SOLANA_TREASURY_ADDRESS environment variable
```

**Issue:** Low balance warnings
```
Solution: Fund treasury via faucet (DevNet) or transfer (MainNet)
```

**Issue:** Transaction verification fails
```
Solution: Check RPC endpoint, confirm transaction is confirmed
```

**Issue:** Emergency pause triggered
```
Solution: Investigate cause, resolve, then call emergency-resume endpoint
```

### 11.2 Emergency Contacts

| Role | Contact | Purpose |
|------|---------|---------|
| Security Lead | security@proxyhubb.com | Security incidents |
| Treasury Admin | treasury@proxyhubb.com | Balance issues |
| On-call | oncall@proxyhubb.com | Critical outages |

---

## 12. Appendix

### 12.1 Glossary

| Term | Definition |
|------|------------|
| Treasury | Central wallet holding platform funds |
| Lamport | Smallest SOL unit (1 SOL = 10⁹ lamports) |
| PDA | Program Derived Address |
| ATA | Associated Token Account |
| Escrow | Third-party fund holding |
| Multi-sig | Multiple signature requirement |
| Velocity | Rate of fund outflow |

### 12.2 Related Documents

- `PROXYHUBB_BLOCKCHAIN_FINANCIAL_ANALYSIS_REPORT.md`
- `PROXYHUBB_IMPROVEMENTS_SUMMARY.md`
- `SECURITY_AUDIT_BUG_BOUNTY_PLAN.md`

---

**Document Version:** 1.0  
**Last Updated:** March 9, 2026  
**Author:** ProxyHubb Technical Team
