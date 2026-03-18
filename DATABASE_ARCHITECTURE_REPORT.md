# ProxyHubb Database Architecture & Design Report

**Generated:** March 14, 2026  
**System:** ProxyHubb - Decentralized Proxy Marketplace  
**Database:** PostgreSQL 16 with Supabase (Auth & Realtime)  
**ORM:** GORM (Go)  

---

## Executive Summary

The ProxyHubb system employs a **hybrid database architecture** that combines PostgreSQL as the primary relational database with Redis for caching and session management, and NATS JetStream for event streaming. The database is designed to support a decentralized proxy marketplace with blockchain integration (Solana), real-time messaging, and complex marketplace operations.

### Key Characteristics:
- **Primary DB:** PostgreSQL 16 (with plans for read replicas)
- **Cache Layer:** Redis 7 (cluster-ready)
- **Message Bus:** NATS JetStream
- **Auth Provider:** Supabase Auth (with `auth.users` integration)
- **Security:** Row Level Security (RLS) enabled on all tables
- **Partitioning:** Time-based partitioning for audit logs
- **Soft Deletes:** GORM-compatible soft delete support across all mutable tables

---

## 1. Database Infrastructure Architecture

### 1.1 System Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PROXYHUBB SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Web App    │    │  Admin Panel │    │   Provider   │                  │
│  │   (Next.js)  │    │   (Next.js)  │    │     CLI      │                  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                  │
│         │                   │                   │                           │
│         └───────────────────┼───────────────────┘                           │
│                             │                                               │
│                    ┌────────┴────────┐                                      │
│                    │  Control API    │                                      │
│                    │    (Go/Gin)     │                                      │
│                    └────────┬────────┘                                      │
│                             │                                               │
│         ┌───────────────────┼───────────────────┐                          │
│         │                   │                   │                           │
│    ┌────┴────┐        ┌────┴────┐       ┌────┴────┐                        │
│    │   NATS  │        │  Redis  │       │PostgreSQL│                        │
│    │JetStream│        │  (Cache)│       │(Primary) │                        │
│    └─────────┘        └─────────┘       └────┬────┘                        │
│                                              │                              │
│                          ┌───────────────────┘                              │
│                          │                                                  │
│                   ┌──────┴──────┐                                           │
│                   │  Supabase   │                                           │
│                   │  (Auth/RLS) │                                           │
│                   └─────────────┘                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            DATA FLOW DIAGRAM                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  USER ACTIONS          CONTROL API              DATABASE              CACHE   │
│       │                    │                       │                  │       │
│       ▼                    ▼                       ▼                  ▼       │
│  ┌─────────┐         ┌──────────┐          ┌─────────────┐      ┌─────────┐  │
│  │ Register│────────▶│  Create  │─────────▶│   profiles  │      │  Cache  │  │
│  │  Login  │         │  User    │          │   (RLS)     │      │  User   │  │
│  └─────────┘         └──────────┘          └─────────────┘      └─────────┘  │
│       │                    │                       │                  │       │
│       ▼                    ▼                       ▼                  ▼       │
│  ┌─────────┐         ┌──────────┐          ┌─────────────┐      ┌─────────┐  │
│  │ Create  │────────▶│  Create  │─────────▶│    nodes    │      │  Node   │  │
│  │  Node   │         │  Node    │          │   (RLS)     │      │ Status  │  │
│  └─────────┘         └──────────┘          └─────────────┘      └─────────┘  │
│       │                    │                       │                  │       │
│       ▼                    ▼                       ▼                  ▼       │
│  ┌─────────┐         ┌──────────┐          ┌─────────────┐      ┌─────────┐  │
│  │  Place  │────────▶│  Create  │─────────▶│    orders   │◀────▶│ Listing │  │
│  │  Order  │         │  Order   │          │   (RLS)     │      │  Cache  │  │
│  └─────────┘         └──────────┘          └─────────────┘      └─────────┘  │
│       │                    │                       │                  │       │
│       ▼                    ▼                       ▼                  ▼       │
│  ┌─────────┐         ┌──────────┐          ┌─────────────┐      ┌─────────┐  │
│  │  Start  │────────▶│  Create  │─────────▶│   sessions  │◀────▶│ Session │  │
│  │ Session │         │  Session │          │   (RLS)     │      │  Store  │  │
│  └─────────┘         └──────────┘          └─────────────┘      └─────────┘  │
│       │                    │                       │                          │
│       ▼                    ▼                       ▼                          │
│  ┌─────────┐         ┌──────────┐          ┌─────────────┐                   │
│  │  Usage  │────────▶│  Update  │─────────▶│   wallet_   │                   │
│  │  Track  │         │  Ledger  │          │   ledger_   │                   │
│  └─────────┘         └──────────┘          │   entries   │                   │
│                                            └─────────────┘                   │
│                                                                               │
│  EVENT FLOW:                                                                  │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                    │
│  │  NATS   │───▶│ Workers │───▶│ Billing │───▶│ Payout  │                    │
│  │ Events  │    │ Process │    │  Calc   │    │  Queue  │                    │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘                    │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema Design

### 2.1 Core Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              ENTITY RELATIONSHIP DIAGRAM                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐       │
│   │   auth.users     │◀────────│     profiles     │────────▶│     wallets      │       │
│   │   (Supabase)     │   1:1   │    (User Core)   │   1:1   │  (SOL Balance)   │       │
│   └──────────────────┘         └────────┬─────────┘         └────────┬─────────┘       │
│                                         │                          │                   │
│                      ┌──────────────────┼──────────────────┐      │                   │
│                      │                  │                  │      │                   │
│                      ▼                  ▼                  ▼      │                   │
│               ┌───────────┐      ┌───────────┐      ┌───────────┐ │                   │
│               │   nodes   │      │   orders  │      │  circles  │ │                   │
│               │(Provider) │      │(Purchase) │      │  (Clans)  │ │                   │
│               └─────┬─────┘      └─────┬─────┘      └─────┬─────┘ │                   │
│                     │                  │                  │       │                   │
│                     │    ┌─────────────┘                  │       │                   │
│                     │    │                                │       │                   │
│                     ▼    ▼                                ▼       ▼                   │
│               ┌──────────────────────────────────────────────────────────┐            │
│               │              wallet_ledger_entries                        │            │
│               │              (Transaction History)                        │            │
│               └──────────────────────────────────────────────────────────┘            │
│                                                                                          │
│   ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐       │
│   │  proxy_listings  │◀────────│    sessions      │────────▶│  conversations   │       │
│   │  (Marketplace)   │   1:N   │ (Proxy Access)   │   1:N   │   (Messaging)    │       │
│   └────────┬─────────┘         └──────────────────┘         └────────┬─────────┘       │
│            │                                                         │                  │
│            │    ┌────────────────────────────────────────────────────┘                  │
│            │    │                                                                       │
│            ▼    ▼                                                                       │
│   ┌──────────────────┐         ┌──────────────────┐                                     │
│   │  escrow_transac- │◀────────│     disputes     │                                     │
│   │      tions       │   1:N   │  (Resolution)    │                                     │
│   └──────────────────┘         └──────────────────┘                                     │
│                                                                                          │
│   ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐       │
│   │ forum_categories │◀────────│  forum_threads   │◀────────│   forum_posts    │       │
│   │   (Community)    │   1:N   │   (Discussions)  │   1:N   │    (Replies)     │       │
│   └──────────────────┘         └──────────────────┘         └──────────────────┘       │
│                                                                                          │
│   ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐       │
│   │    validators    │◀────────│quality_attestat- │◀────────│ consensus_rounds │       │
│   │   (Bittensor)    │   1:N   │      ions        │   1:N   │   (Validation)   │       │
│   └──────────────────┘         └──────────────────┘         └──────────────────┘       │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Table Categories

The database consists of **50+ tables** organized into the following functional categories:

| Category | Table Count | Description |
|----------|-------------|-------------|
| **Core User** | 5 | User profiles, wallets, authentication |
| **Marketplace** | 6 | Listings, orders, saved items, reviews |
| **Session Management** | 4 | Proxy sessions, credentials, configurations |
| **Provider Infrastructure** | 5 | Nodes, service configs, provider nodes |
| **Circles (Clans)** | 7 | Circle management, memberships, leases, SLAs |
| **Social Features** | 8 | Follows, friendships, feed events, testimonials |
| **Messaging** | 4 | Conversations, messages, reactions |
| **Forum/Community** | 5 | Categories, threads, posts, votes, reports |
| **Escrow & Disputes** | 3 | Escrow transactions, milestones, disputes |
| **Blockchain** | 4 | Linked wallets, blockchain cache, pending txns |
| **Billing & Payouts** | 6 | Ledger, spending records, batch payouts, retry queue |
| **Governance** | 2 | Proposals, votes |
| **Agents** | 5 | Agent registry, instances, jobs, outputs |
| **Audit & Security** | 7 | Audit logs, anomalies, login attempts, lockouts |
| **Notifications** | 2 | Notifications, preferences |
| **System** | 3 | API keys, refresh tokens, routing profiles |

---

## 3. Detailed Table Schema

### 3.1 Core User Tables

#### `profiles` - User Identity & Social
```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'buyer' CHECK (role IN ('buyer', 'provider', 'admin')),
    trust_tier VARCHAR(50) DEFAULT 'new',
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'banned')),
    
    -- Social Profile
    username VARCHAR(50) UNIQUE,
    display_name VARCHAR(100),
    bio TEXT,
    avatar_url TEXT,
    cover_image_url TEXT,
    location VARCHAR(100),
    website VARCHAR(255),
    social_links JSONB,
    skills TEXT[],
    
    -- Professional Identity
    professional_title VARCHAR(100),
    experience_years INT DEFAULT 0,
    languages TEXT[],
    primary_specialization VARCHAR(100),
    
    -- Business Profile
    business_name VARCHAR(100),
    tax_id VARCHAR(50),
    
    -- Social Stats
    followers_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    reviews_count INT DEFAULT 0,
    avg_rating NUMERIC(3, 2) DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    
    -- Provider Stats
    kyc_status VARCHAR(50) DEFAULT 'not_started',
    provider_since TIMESTAMP WITH TIME ZONE,
    total_bandwidth_sold NUMERIC(20, 2) DEFAULT 0,
    wallet_address VARCHAR(64),
    paystack_recipient_code VARCHAR(50),
    
    -- Auth
    verification_token VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

**Key Features:**
- Links to Supabase `auth.users` for authentication
- Row Level Security: Users can view all profiles, update only their own
- Supports soft deletes via `deleted_at`
- JSONB for flexible social links storage

#### `wallets` - SOL-Only Balance Storage
```sql
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    balance_sol NUMERIC(20, 9) NOT NULL DEFAULT 0,
    
    -- Spending Limits (Security)
    daily_limit NUMERIC(20,9) DEFAULT 0,
    weekly_limit NUMERIC(20,9) DEFAULT 0,
    monthly_limit NUMERIC(20,9) DEFAULT 0,
    limit_window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

**Key Features:**
- SOL-only currency (migrated from multi-currency GHS/USDT/SOL)
- Spending limits for fraud prevention
- Direct link to user profile

#### `wallet_ledger_entries` - Transaction History
```sql
CREATE TABLE wallet_ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(20, 9) NOT NULL,  -- Positive = credit, Negative = debit
    balance_after NUMERIC(20, 9) NOT NULL,
    type VARCHAR(50) NOT NULL,  -- 'topup', 'usage', 'payout', 'refund', 'earning', 'swap'
    reference_id VARCHAR(128),  -- Solana tx signature (88 chars)
    tx_hash VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Key Features:**
- Immutable transaction log
- Reference to on-chain transaction signatures
- Denormalized `balance_after` for quick historical queries

### 3.2 Marketplace Tables

#### `proxy_listings` - Provider Offerings
```sql
CREATE TABLE proxy_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Listing Details
    title VARCHAR(200) NOT NULL,
    description TEXT,
    proxy_type VARCHAR(50) DEFAULT 'residential',  -- residential, mobile, datacenter
    protocol VARCHAR(20) DEFAULT 'HTTP',
    rotation_type VARCHAR(20) DEFAULT 'static',    -- static, rotating, sticky
    circle_id UUID REFERENCES circles(id),
    
    -- Targeting & Location
    country VARCHAR(50),
    isp VARCHAR(100),
    
    -- Pricing
    price_per_gb NUMERIC NOT NULL,
    min_purchase_gb NUMERIC DEFAULT 1,
    bulk_discounts JSONB DEFAULT '[]',
    
    -- Availability
    available_bandwidth_gb NUMERIC NOT NULL,
    max_concurrency INT DEFAULT 5,
    
    -- Performance Metrics (auto-calculated)
    avg_latency_ms INT DEFAULT 0,
    uptime_percent NUMERIC DEFAULT 100,
    success_rate NUMERIC DEFAULT 100,
    quality_score NUMERIC DEFAULT 100,
    
    -- Social Metrics
    views_count INT DEFAULT 0,
    saves_count INT DEFAULT 0,
    orders_count INT DEFAULT 0,
    
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

**Indexes:**
- `idx_listing_seller` - Seller's listings
- `idx_listing_search` - Status, proxy_type, country (filtered search)
- `idx_listing_price` - Price range queries
- `idx_listing_quality` - Quality score sorting

#### `orders` - Purchase Records
```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id UUID NOT NULL REFERENCES profiles(id),
    seller_id UUID NOT NULL REFERENCES profiles(id),
    listing_id UUID NOT NULL REFERENCES proxy_listings(id),
    
    -- Purchase Details
    bandwidth_gb NUMERIC NOT NULL,
    price_per_gb NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    
    status VARCHAR(50) DEFAULT 'pending',  -- pending, active, completed, disputed, refunded, cancelled
    
    -- Solana Escrow Fields
    escrow_pda VARCHAR(64),
    buyer_wallet VARCHAR(64),
    seller_wallet VARCHAR(64),
    amount_locked_sol NUMERIC,
    bandwidth_limit_gb BIGINT,
    payment_method VARCHAR(50),  -- "fiat", "solana_escrow"
    tx_signature VARCHAR(128),
    
    session_id UUID REFERENCES sessions(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

### 3.3 Session Management Tables

#### `sessions` - Active Proxy Sessions
```sql
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
    listing_id UUID REFERENCES proxy_listings(id),
    
    type VARCHAR(50) NOT NULL,  -- rotating, sticky
    status VARCHAR(50) DEFAULT 'active',  -- active, disabled, terminated
    
    -- Credentials (encrypted at application level)
    credentials_user VARCHAR(255),
    credentials_pass VARCHAR(255),
    config JSONB,
    
    -- Usage Tracking
    bandwidth_limit BIGINT DEFAULT 0,  -- bytes, 0 = unlimited
    bytes_used BIGINT DEFAULT 0,
    
    -- Timing
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Universal Session Fields
    strategy VARCHAR(50),  -- fastest, cheapest, random
    max_price NUMERIC,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

**Key Features:**
- Soft delete support (GORM `DeletedAt`)
- Links to node (nullable for universal sessions)
- JSONB config for flexible session parameters

### 3.4 Provider Infrastructure Tables

#### `nodes` - Provider Proxy Nodes
```sql
CREATE TABLE nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_user_id UUID NOT NULL REFERENCES profiles(id),
    
    -- Network Identity
    ip_address VARCHAR(45),
    port INT,
    protocol VARCHAR(10) DEFAULT 'http',
    
    -- Geolocation
    country_code VARCHAR(10),
    region VARCHAR(100),
    city VARCHAR(100),
    isp VARCHAR(100),
    connection_type VARCHAR(50),  -- residential, mobile, datacenter
    
    -- Health Metrics
    is_healthy BOOLEAN DEFAULT TRUE,
    active_connections INT DEFAULT 0,
    max_connections INT DEFAULT 100,
    latency_ms INT,
    
    -- Usage Stats
    total_bytes_up BIGINT DEFAULT 0,
    total_bytes_down BIGINT DEFAULT 0,
    uptime_percent NUMERIC DEFAULT 100,
    success_rate NUMERIC DEFAULT 1.0,
    quality_score NUMERIC DEFAULT 100,
    
    -- On-Chain Registry (Bittensor/Solana)
    is_registered_on_chain BOOLEAN DEFAULT FALSE,
    net_uid INT,
    hotkey VARCHAR(64),
    
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

### 3.5 Circle (Clan) Tables

#### `circles` - Provider Groups
```sql
CREATE TABLE circles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES profiles(id),
    visibility VARCHAR(20) DEFAULT 'private',  -- public, private
    member_count INT DEFAULT 0,
    
    -- Enterprise Features
    is_enterprise BOOLEAN DEFAULT FALSE,
    price_per_gb NUMERIC DEFAULT 0.50,
    priority_level INT DEFAULT 0,  -- 0=normal, 1-5=priority
    bandwidth_pool_gb NUMERIC DEFAULT 0,
    bandwidth_used_gb NUMERIC DEFAULT 0,
    revenue_share_percent NUMERIC DEFAULT 0.0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
```

#### `circle_members` - Membership Records
```sql
CREATE TABLE circle_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id UUID NOT NULL REFERENCES circles(id),
    user_id UUID NOT NULL REFERENCES profiles(id),
    role VARCHAR(20) DEFAULT 'member',  -- owner, admin, member
    status VARCHAR(20) DEFAULT 'active',  -- active, pending, banned
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.6 Billing & Payout Tables

#### `batch_payouts` - Batch Transaction Records
```sql
CREATE TABLE batch_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, processing, completed, partial, failed
    total_amount NUMERIC(20,9) NOT NULL,
    total_count INT NOT NULL,
    success_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    tx_hash VARCHAR(128),
    gas_fee_lamports BIGINT DEFAULT 0,
    processed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `pending_payouts` - Payout Queue
```sql
CREATE TABLE pending_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES profiles(id),
    wallet_address VARCHAR(64) NOT NULL,
    amount_sol NUMERIC(20,9) NOT NULL,
    priority INT DEFAULT 0,  -- Higher = process first
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scheduled_for TIMESTAMP,
    attempts INT DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.7 Audit & Security Tables

#### `audit_logs` - Security Event Log (Partitioned)
```sql
CREATE TABLE audit_logs_partitioned (
    id UUID NOT NULL,
    
    -- Event Classification
    event_type VARCHAR(50) NOT NULL,  -- auth.login, order.created, etc.
    severity VARCHAR(20) DEFAULT 'info',  -- info, warning, critical
    
    -- Actor (who performed action)
    actor_id UUID,
    actor_type VARCHAR(20),  -- user, admin, system
    actor_email VARCHAR(255),
    
    -- Target (what was affected)
    target_type VARCHAR(50),  -- user, order, node, etc.
    target_id VARCHAR(64),
    
    -- Context
    ip_address VARCHAR(45),
    user_agent TEXT,
    country VARCHAR(2),
    session_id UUID,
    
    -- Details
    description TEXT,
    metadata JSONB,
    
    -- Outcome
    success BOOLEAN DEFAULT TRUE,
    error_code VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
```

**Partitioning Strategy:**
- Monthly partitions (e.g., `audit_logs_2026_03`)
- Auto-creation via pg_cron scheduled function
- Default partition for overflow protection

#### `account_lockouts` - Security Lockouts
```sql
CREATE TABLE account_lockouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL,  -- email, IP, or wallet
    identifier_type VARCHAR(20) NOT NULL,  -- email, ip, wallet
    
    failed_attempts INT DEFAULT 0,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_until TIMESTAMP WITH TIME ZONE,
    unlocked_at TIMESTAMP WITH TIME ZONE,
    lock_reason VARCHAR(100),
    
    auto_unlock_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 4. Security Architecture

### 4.1 Row Level Security (RLS) Implementation

All tables have RLS enabled with policies based on user roles:

```sql
-- Example: Profiles RLS
CREATE POLICY "profiles_select_all" ON profiles
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Example: Wallets RLS (strict ownership)
CREATE POLICY "wallets_select_own" ON wallets
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Example: Admin Bypass
CREATE POLICY "admin_bypass_profiles" ON profiles
    FOR ALL TO authenticated
    USING (is_admin());
```

### 4.2 Admin Check Function
```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 4.3 Security Tables Summary

| Table | Purpose | Retention |
|-------|---------|-----------|
| `audit_logs` | All security events | 2 years (partitioned) |
| `login_attempts` | Failed login tracking | 90 days |
| `account_lockouts` | Active lockouts | Until unlocked + 30 days |
| `security_anomalies` | Detected threats | 1 year |
| `user_sessions` | Active session tracking | Session expiry + 7 days |

---

## 5. Data Partitioning Strategy

### 5.1 Time-Based Partitioning

**Audit Logs Partitioning:**
```
audit_logs_partitioned (parent)
├── audit_logs_2026_01
├── audit_logs_2026_02
├── audit_logs_2026_03
└── ... (auto-created monthly)
```

**Benefits:**
- Fast queries on recent data (hot partitions)
- Easy archival of old data (detach old partitions)
- Vacuum and index maintenance on smaller tables

### 5.2 Partition Management

```sql
-- Auto-create next month's partition (runs via pg_cron)
CREATE OR REPLACE FUNCTION create_audit_partition_if_not_exists()
RETURNS void AS $$
DECLARE
    partition_date DATE := DATE_TRUNC('month', NOW()) + INTERVAL '1 month';
    partition_name TEXT := 'audit_logs_' || TO_CHAR(partition_date, 'YYYY_MM');
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_partitioned 
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, partition_date, partition_date + INTERVAL '1 month'
    );
END;
$$ LANGUAGE plpgsql;
```

---

## 6. Indexing Strategy

### 6.1 High-Frequency Query Indexes

```sql
-- User lookups
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_wallet ON profiles(wallet_address);

-- Session management
CREATE INDEX idx_sessions_user_status ON sessions(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_node_status ON sessions(node_id, status) WHERE node_id IS NOT NULL;

-- Marketplace queries
CREATE INDEX idx_listings_search ON proxy_listings(status, proxy_type, country);
CREATE INDEX idx_listings_price ON proxy_listings(price_per_gb, status);
CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- Blockchain lookups
CREATE INDEX idx_order_escrow_pda ON orders(escrow_pda) WHERE escrow_pda IS NOT NULL;
CREATE INDEX idx_cache_pda ON blockchain_state_cache(pda);

-- Audit queries
CREATE INDEX idx_audit_actor_time ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
```

### 6.2 Partial Indexes (Performance Optimization)

```sql
-- Active sessions only (excludes soft-deleted)
CREATE INDEX idx_sessions_active ON sessions (user_id, status) WHERE deleted_at IS NULL;

-- Active nodes only
CREATE INDEX idx_nodes_healthy ON nodes (status) WHERE deleted_at IS NULL;

-- Pending payouts only
CREATE INDEX idx_payout_retry_pending ON payout_retry_queue (next_retry_at) 
    WHERE status = 'pending';
```

---

## 7. Data Flow Patterns

### 7.1 User Registration Flow

```
1. User signs up via Supabase Auth
   ↓
2. Supabase triggers `handle_new_user()`
   ↓
3. Profile auto-created in `profiles` table
   ↓
4. Wallet auto-created with 0 balance
   ↓
5. Notification preferences initialized
   ↓
6. Welcome notification queued
```

### 7.2 Order Processing Flow

```
1. Buyer places order
   ↓
2. Order record created (status: pending)
   ↓
3. SOL escrow account created on-chain
   ↓
4. Escrow PDA stored in order record
   ↓
5. Session created with credentials
   ↓
6. Usage tracked in real-time
   ↓
7. Bandwidth consumed → Ledger entry created
   ↓
8. Order completes → Payout queued
   ↓
9. Batch payout processed
```

### 7.3 Payout Processing Flow

```
1. Order completion triggers payout
   ↓
2. Payout added to `pending_payouts` queue
   ↓
3. Batch worker evaluates queue
   ↓
4. Sufficient payouts? Create batch
   ↓
5. `batch_payouts` record created
   ↓
6. Individual `batch_payout_items` created
   ↓
7. Solana transaction submitted
   ↓
8. On success: Update statuses, record tx hash
   ↓
9. On failure: Retry with exponential backoff
```

---

## 8. Blockchain Integration

### 8.1 On-Chain State Caching

The `blockchain_state_cache` table mirrors on-chain Solana accounts:

```sql
CREATE TABLE blockchain_state_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pda VARCHAR(64) NOT NULL UNIQUE,  -- Program Derived Address
    program_id VARCHAR(64) NOT NULL,
    account_type VARCHAR(50) NOT NULL,  -- escrow, dispute, vault
    data JSONB NOT NULL,  -- Serialized account data
    slot BIGINT NOT NULL,  -- Solana slot when fetched
    signature VARCHAR(128),
    last_synced_at TIMESTAMP DEFAULT NOW(),
    
    -- Denormalized for quick queries
    buyer_address VARCHAR(64),
    seller_address VARCHAR(64),
    status VARCHAR(50)
);
```

### 8.2 Linked Wallets

Multi-chain wallet support:

```sql
CREATE TABLE linked_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id),
    chain VARCHAR(20) NOT NULL,  -- solana, ethereum
    address VARCHAR(64) NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    verification_signature TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    label VARCHAR(50),
    UNIQUE(chain, address)
);
```

---

## 9. Performance Optimizations

### 9.1 Connection Pooling

- **Max Open Connections:** 25 (per Control API instance)
- **Max Idle Connections:** 10
- **Conn Max Lifetime:** 1 hour

### 9.2 Caching Strategy

| Data Type | Cache Layer | TTL |
|-----------|-------------|-----|
| User sessions | Redis | 24 hours |
| Active listings | Redis | 5 minutes |
| Node health | Redis | 30 seconds |
| Price feeds | Redis | 60 seconds |
| Wallet balances | Database + Redis | Immediate consistency |

### 9.3 Read Replica Strategy

Future architecture supports read replicas:

```go
// GORM supports read replica configuration
db.Use(dbresolver.Register(dbresolver.Config{
    Replicas: []gorm.Dialector{postgres.Open("replica_dsn")},
}).SetMaxOpenConns(25))
```

---

## 10. Backup & Disaster Recovery

### 10.1 Backup Strategy

| Component | Frequency | Retention |
|-----------|-----------|-----------|
| PostgreSQL | Daily snapshots | 30 days |
| WAL Archives | Continuous | 7 days |
| Redis | RDB snapshots | 24 hours |

### 10.2 Point-in-Time Recovery

WAL archiving enabled for PostgreSQL:
- Base backup: Daily at 02:00 UTC
- WAL retention: 7 days
- Recovery time objective (RTO): 1 hour
- Recovery point objective (RPO): 5 minutes

---

## 11. Schema Migration History

| Version | Date | Description |
|---------|------|-------------|
| 000001 | Jan 2026 | Initial Supabase schema (profiles, wallets, nodes, sessions) |
| 000002 | Jan 2026 | Consensus tables (validators, attestations, consensus rounds) |
| 000003 | Jan 2026 | Multi-currency wallet support (SOL, USDT, GHS) |
| 000004 | Jan 2026 | Performance indexes for high-frequency queries |
| 000005 | Jan 2026 | Provider tier system (unverified → enterprise) |
| 000006 | Feb 2026 | Social features (notifications, showcases, testimonials) |
| 000007 | Feb 2026 | Forum seed categories |
| 000008 | Feb 2026 | Forum reports system |
| 000009 | Feb 2026 | Admin notes table |
| 000010 | Feb 2026 | Fix admin columns, add account_lockouts |
| 000011 | Feb 2026 | Audit log partitioning |
| 000012 | Feb 2026 | Payout retry queue |
| 000013 | Feb 2026 | Soft delete support for sessions/nodes |
| 000028 | Mar 2026 | Spending limits feature |
| 000029 | Mar 2026 | Batch payout processing |

---

## 12. Database Statistics

### 12.1 Table Count by Category

```
Total Tables: 50+
├─ Core User:           5 tables
├─ Marketplace:         6 tables
├─ Session Mgmt:        4 tables
├─ Provider Infra:      5 tables
├─ Circles:             7 tables
├─ Social:              8 tables
├─ Messaging:           4 tables
├─ Forum:               5 tables
├─ Escrow/Disputes:     3 tables
├─ Blockchain:          4 tables
├─ Billing:             6 tables
├─ Governance:          2 tables
├─ Agents:              5 tables
├─ Audit/Security:      7 tables
└─ System:              3 tables
```

### 12.2 Index Statistics

- **Total Indexes:** 100+
- **Unique Indexes:** 25+
- **Partial Indexes:** 15+ (soft-delete optimized)
- **Composite Indexes:** 30+
- **Foreign Key Indexes:** 40+

---

## 13. Future Enhancements

### 13.1 Planned Improvements

1. **Read Replicas:** Scale read-heavy workloads
2. **Connection Pooling:** PgBouncer integration
3. **Columnar Storage:** TimescaleDB for metrics
4. **Full-Text Search:** PostgreSQL FTS for marketplace
5. **Graph Database:** Neo4j for social graph analysis

### 13.2 Sharding Strategy

Under consideration for future scaling:
- **Shard Key:** User ID (consistent hashing)
- **Cross-Shard Queries:** Minimized via data locality
- **Global Tables:** Small reference tables replicated

---

## 14. Conclusion

The ProxyHubb database architecture is designed for:

1. **Scalability:** Partitioning, indexing, and caching strategies support growth
2. **Security:** RLS, audit logging, and encryption at multiple levels
3. **Performance:** Optimized queries, partial indexes, and Redis caching
4. **Reliability:** Soft deletes, transaction safety, and backup strategies
5. **Compliance:** Audit trails, data retention policies, and privacy controls

The hybrid architecture (PostgreSQL + Redis + NATS) provides a solid foundation for a decentralized proxy marketplace with real-time capabilities and blockchain integration.

---

## Appendix A: Complete Table List

### Core Tables
- `profiles`
- `wallets`
- `wallet_ledger_entries`
- `user_settings`
- `linked_wallets`

### Session Tables
- `sessions`
- `session_configurations`
- `encrypted_credentials`
- `api_keys`

### Provider Tables
- `nodes`
- `provider_nodes`
- `service_configurations`
- `provider_stats`
- `speed_tests`

### Marketplace Tables
- `proxy_listings`
- `orders`
- `saved_listings`
- `reviews`
- `testimonials`
- `provider_showcases`

### Circle Tables
- `circles`
- `circle_members`
- `circle_invites`
- `circle_leases`
- `circle_posts`
- `circle_slas`
- `circle_stats`

### Billing Tables
- `spending_records`
- `batch_payouts`
- `batch_payout_items`
- `pending_payouts`
- `payout_retry_queue`
- `escrow_transactions`
- `escrow_milestones`

### Blockchain Tables
- `blockchain_state_cache`
- `pending_transactions`
- `validators`
- `quality_attestations`
- `consensus_rounds`

### Social Tables
- `follows`
- `friendships`
- `friend_requests`
- `feed_events`
- `badges`
- `user_badges`

### Messaging Tables
- `conversations`
- `messages`
- `message_reactions`
- `notifications`
- `notification_preferences`

### Forum Tables
- `forum_categories`
- `forum_threads`
- `forum_posts`
- `forum_votes`
- `forum_reports`

### Security Tables
- `audit_logs` / `audit_logs_partitioned`
- `security_anomalies`
- `user_sessions`
- `login_attempts`
- `account_lockouts`
- `admin_notes`
- `webauthn_credentials`
- `totp_backup_codes`

### System Tables
- `routing_profiles`
- `use_cases`
- `user_preferences`
- `refresh_token_families`
- `kyc_verifications`

---

*Report generated by automated database analysis tool*
*Last updated: March 14, 2026*
