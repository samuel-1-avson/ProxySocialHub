# ProxyHub Financial Engine - Deep Dive System Analysis Report

**Document Version:** 1.0  
**Date:** March 14, 2026  
**Classification:** Internal Technical Documentation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Financial Architecture Overview](#2-financial-architecture-overview)
3. [Core Financial Subsystems](#3-core-financial-subsystems)
4. [Money Flow Analysis](#4-money-flow-analysis)
5. [Data Models](#5-data-models)
6. [Security & Risk Management](#6-security--risk-management)
7. [Recommendations](#7-recommendations)

---

## 1. Executive Summary

The ProxyHub Financial Engine is a sophisticated, multi-layered monetary system designed to facilitate peer-to-peer proxy bandwidth trading using cryptocurrency (SOL) as the primary medium of exchange.

### Key Metrics

| Metric | Value |
|--------|-------|
| Primary Currency | SOL (Solana) |
| Secondary Currencies | USDC, USDT, GHS |
| Platform Fee | 2% per transaction |
| Payout Threshold | 0.05 SOL (~$10) |
| Settlement Frequency | Hourly |
| Treasury Address | `8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4` |

---

## 2. Financial Architecture Overview

### High-Level Architecture

```
User Interface Layer
        |
        v
API Gateway (Go/Gin)
        |
        +-- Wallet API
        +-- Order API
        +-- Billing API
        +-- Crypto API
        |
        v
Financial Core Services
        |
        +-- Wallet Manager (Multi-currency, Ledger)
        +-- Billing Worker (Settlement, Auto-payouts)
        +-- Payment Processor (Crypto, Fiat)
        +-- Escrow Engine (On-chain, Disputes)
        +-- Treasury Management (Security, Monitoring)
        |
        v
Data Persistence
        |
        +-- PostgreSQL (Wallets, Transactions, Ledger)
        +-- Redis (Session cache, Pending usage)
        +-- Solana Blockchain (Escrow, Treasury)
```

### Financial Subsystems

| Subsystem | Purpose |
|-----------|---------|
| Wallet System | User balance management across multiple currencies |
| Payment Processing | Deposit & withdrawal handling |
| Billing Engine | Usage-based charging and settlements |
| Escrow System | Trustless fund holding during transactions |
| Treasury Management | Platform fund security and monitoring |
| Governance Finance | DAO-controlled treasury operations |

---

## 3. Core Financial Subsystems

### 3.1 Wallet System

**Models:**
```go
type Wallet struct {
    ID          uuid.UUID
    UserID      uuid.UUID
    BalanceGHS  float64    // Ghana Cedi (fiat)
    BalanceSOL  float64    // Solana (primary)
    BalanceUSDT float64    // Tether stablecoin
    Currency    string     // "MULTI"
}

type WalletLedgerEntry struct {
    ID           uuid.UUID
    WalletID     uuid.UUID
    Amount       float64    // Positive = credit, Negative = debit
    BalanceAfter float64    // Snapshot post-transaction
    Type         string     // topup, usage, payout, refund, earning
    ReferenceID  string     // External reference
    TxHash       string     // Blockchain signature
}
```

**Transaction Types:**
| Type | Direction | Description |
|------|-----------|-------------|
| topup | Credit (+) | Deposit into wallet |
| usage | Debit (-) | Bandwidth consumption |
| payout | Debit (-) | Withdrawal |
| refund | Credit (+) | Return of unused funds |
| earning | Credit (+) | Provider revenue |
| p2p_sent | Debit (-) | Peer transfer sent |
| p2p_received | Credit (+) | Peer transfer received |

**P2P Transfers:** Users can transfer funds between internal wallets without blockchain fees.

---

### 3.2 Payment Processing

#### Crypto Deposit Flow

```
1. User sends SOL to Treasury Address
2. System verifies transaction on-chain:
   - Transaction exists
   - Transaction successful
   - Amount matches
   - Double-spend check
3. Credit internal wallet
4. Create ledger entry
```

#### Fiat Payments (Mobile Money - Ghana)

**Status:** Deprecated for users (decentralization). Maintained for provider payouts.

**Supported:** MTN Mobile Money, Vodafone Cash, AirtelTigo Money

---

### 3.3 Billing & Settlement Engine

**Location:** `services/control-api/internal/billing/worker.go`

**Settlement Cycle (Hourly):**
```
1. Scan Redis for pending sessions
   Key pattern: billing:session:*:pending

2. Calculate cost:
   costUSDT = bytes / 1GB * pricePerGB
   costSOL = costUSDT / SOLPriceUSD

3. Atomic database transaction:
   - Lock buyer wallet (FOR UPDATE)
   - Deduct costSOL from buyer
   - Create usage ledger entry
   - Lock provider wallet (FOR UPDATE)
   - Add costSOL to provider
   - Create earning ledger entry
   - If provider_balance >= 0.05 SOL:
       Trigger async payout
   - Clear Redis counter
   - COMMIT
```

**Cost Calculation Example:**
```
bytesUsed = 6,442,450,944 (6 GB)
pricePerGB = $0.50
SOLPriceUSD = $200

costUSDT = (6 GB) * $0.50 = $3.00
costSOL = $3.00 / $200 = 0.015 SOL
```

---

### 3.4 Provider Payout System

**Automatic Payout Trigger:**
```
Provider Balance: 0.058 SOL
Threshold: 0.05 SOL
Action: TRIGGER PAYOUT

Process:
1. Lock provider wallet
2. Capture balance (0.058 SOL)
3. Set balance to 0
4. Create payout ledger entry
5. COMMIT
6. Initiate on-chain transfer (async)
7. If fails: Queue for retry
```

**Retry Logic:**
- Max attempts: 8
- Backoff: Exponential (2^n minutes, max 128 min)
- Permanent failure: Manual intervention required

---

### 3.5 Escrow System

**Location:** `services/control-api/internal/models/escrow.go`

**Escrow States:**
```
PENDING -> HELD -> RELEASED
              -> REFUNDED (dispute)
              -> DISPUTED -> RESOLVED
```

**On-Chain Escrow (Solana):**
```rust
pub struct Escrow {
    buyer: Pubkey,
    seller: Pubkey,
    amount: u64,
    bandwidth_limit_gb: u64,
    bandwidth_used_gb: u64,
    status: EscrowStatus,
    created_at: i64,
    expires_at: i64,
}
```

---

### 3.6 Treasury Management

**Components:**

| Component | Purpose |
|-----------|---------|
| Treasury Manager | Auto-topup, balance monitoring |
| Watchtower | Security monitoring, velocity tracking |
| Liquidity Manager | Balance thresholds, yield optimization |
| Reconciliation | Daily ledger vs on-chain verification |

**Watchtower Security:**
```go
MaxHourlySOLOutflow = 100.0  // SOL per hour
LargeOutflowWarning = 50.0   // SOL single transaction
```

**Auto-Topup Thresholds:**
| Environment | Minimum | Warning | Target |
|-------------|---------|---------|--------|
| DevNet | 5 SOL | 10 SOL | 20 SOL |
| MainNet | 100 SOL | 250 SOL | 500 SOL |

---

## 4. Money Flow Analysis

### Complete Financial Lifecycle

```
PHASE 1: DEPOSIT
User (External) -> Solana Network -> Treasury -> User Internal Wallet

PHASE 2: PURCHASE
User Wallet -> Escrow (funds locked) -> Provider (service ready)

PHASE 3: USAGE
User Traffic -> Provider Node -> Redis Counter (tracks bytes)

PHASE 4: SETTLEMENT (Hourly)
Redis Data -> Calculate Cost -> Deduct User -> Credit Provider (minus 2% fee)

PHASE 5: PAYOUT
Provider Wallet (>=0.05 SOL) -> Auto-Payout -> Provider External Wallet
```

### Revenue Distribution Example (1 SOL for 10 GB)

| Usage | Seller Gets | Platform Fee | Buyer Refund |
|-------|-------------|--------------|--------------|
| 100% (10 GB) | 0.98 SOL | 0.02 SOL | 0 SOL |
| 60% (6 GB) | 0.588 SOL | 0.02 SOL | 0.392 SOL |
| 30% (3 GB) | 0.294 SOL | 0.02 SOL | 0.686 SOL |

**Formula:**
```
sellerPayout = (totalAmount * bandwidthUsed) / bandwidthLimit
platformFee = totalAmount * 0.02
buyerRefund = totalAmount - sellerPayout - platformFee
```

---

## 5. Data Models

### Entity Relationships

```
users ||--|| wallets : has
wallets ||--o{ wallet_ledger_entries : records
users ||--o{ orders : creates
orders ||--|| escrow_transactions : secures
escrow_transactions ||--o{ disputes : may_have
users ||--o{ pending_transactions : tracks
users ||--o{ payout_retry_queue : retries
```

### Key Tables

| Table | Purpose |
|-------|---------|
| wallets | User balance storage |
| wallet_ledger_entries | Transaction history |
| orders | Purchase records |
| escrow_transactions | Escrow state |
| payout_retry_queue | Failed payout tracking |
| pending_transactions | In-flight deposits |
| usage_records | Bandwidth consumption |

---

## 6. Security & Risk Management

### Security Layers

```
LAYER 5: Smart Contract
- Multi-sig oracle (3-of-5)
- Emergency pause
- Replay protection

LAYER 4: Application
- Row-level locking (FOR UPDATE)
- Idempotency keys
- Rate limiting

LAYER 3: Treasury
- Velocity monitoring (>100 SOL/hour = pause)
- Large transfer alerts (>50 SOL)
- Daily reconciliation

LAYER 2: API
- JWT authentication
- Role-based access
- Input validation

LAYER 1: Infrastructure
- Keypair encryption
- Environment protection
- Network isolation
```

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Oracle key theft | Low | Critical | Multi-sig required |
| Smart contract bug | Low | Critical | Audits + insurance |
| Database corruption | Low | High | Daily reconciliation |
| Treasury drain | Low | Critical | Velocity limits |
| Price manipulation | Medium | High | Multiple sources |

---

## 7. Recommendations

### Critical Issues

1. **Single Price Feed Source**
   - Risk: CoinGecko downtime
   - Solution: Add Chainlink/Binance as backup
   - Priority: High

2. **No User Spending Limits**
   - Risk: Unlimited drain if compromised
   - Solution: Add daily/weekly limits
   - Priority: High

### High Priority

3. **Batch Payout Processing**
   - Current: Sequential (wastes gas)
   - Solution: Aggregate small payouts
   - Savings: ~30% on transaction fees

4. **Insurance Pool Activation**
   - Contract exists but not integrated
   - Provides provider protection
   - Increases platform trust

### Roadmap

| Phase | Item | Timeline |
|-------|------|----------|
| 1 | Multi-source price feeds | 2 weeks |
| 1 | Spending limits | 2 weeks |
| 2 | Batch payouts | 4 weeks |
| 2 | Insurance pool | 4 weeks |
| 3 | DeFi yield integration | 8 weeks |

---

## Appendix: API Endpoints

### Wallet
```
GET    /v1/wallet                    # Get wallet info
POST   /v1/wallet/transfer           # P2P transfer
POST   /v1/wallet/deposit/crypto     # Crypto deposit
POST   /v1/wallet/withdraw/sol       # SOL withdrawal
```

### Treasury (Admin)
```
GET    /v1/monitoring/treasury       # Treasury stats
POST   /v1/admin/treasury/topup      # Manual topup
GET    /v1/admin/treasury/thresholds # View thresholds
```

### Orders
```
POST   /v1/orders                    # Create order
GET    /v1/orders/:id/escrow         # Escrow status
POST   /v1/orders/:id/dispute        # Raise dispute
```

---

**Document Version:** 1.0  
**Last Updated:** March 14, 2026
